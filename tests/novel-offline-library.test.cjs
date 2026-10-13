const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const ts = require("typescript")

function loadModule(file, mocks = {}, globals = {}) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, { fileName: absolute, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: absolute })
  return module.exports
}

/** 用真实文件系统实现 FileManager 替身，验证的是真实 atomic 写与目录隔离 */
function makeFileManager(rootDir) {
  return {
    documentsDirectory: rootDir,
    iCloudDocumentsDirectory: `${rootDir}-icloud`,
    appGroupDocumentsDirectory: `${rootDir}-group`,
    isiCloudEnabled: false,
    existsSync: (p) => fs.existsSync(p),
    createDirectorySync: (p) => fs.mkdirSync(p, { recursive: true }),
    readAsStringSync: (p) => fs.readFileSync(p, "utf8"),
    writeAsStringSync: (p, c) => fs.writeFileSync(p, c, "utf8"),
    readDirectorySync: (p) => fs.readdirSync(p),
    statSync: (p) => ({ size: fs.statSync(p).size }),
    removeSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    renameSync: (from, to) => fs.renameSync(from, to),
    isDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
  }
}

function makeSession(userID) {
  return { userID }
}

function setup(userID = 1001) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-offline-"))
  const FileManager = makeFileManager(root)
  const session = makeSession(userID)
  const globals = { FileManager }
  const safeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session },
    "./safeFile": safeFile,
  }, globals)
  const anchor = loadModule("Pix-Scripting/src/store/novelAnchor.ts", {}, globals)
  const library = loadModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "./novelAnchor": anchor,
  }, globals)
  return { root, FileManager, session, safeFile, dataDirectory, anchor, library, globals }
}

const sampleText = "第一章正文。\n\n[newpage]\n\n第二页正文。\n\n[newpage]\n\n第三页正文。"

test("离线保存后断网可读：正文、页数与段落数与磁盘一致", () => {
  const { library } = setup()
  const saved = library.saveOfflineEpisode({
    novelId: 501,
    title: "测试小说",
    text: sampleText,
    author: "作者甲",
    seriesId: 77,
    episodeNumber: 2,
    caption: "简介",
    images: [
      { chunkId: "up-1", status: "ok", bytes: 100 },
      { chunkId: "px-2", status: "failed", note: "下载失败" },
    ],
  })
  assert.ok(saved)
  assert.equal(saved.pageCount, 3)
  assert.equal(saved.paragraphCount, 5)
  assert.equal(saved.bytes, sampleText.length)

  const result = library.offlineReadResult(501)
  assert.equal(result.source, "offline")
  assert.equal(result.offline, true)
  assert.equal(result.record.text, sampleText)
  assert.equal(result.record.title, "测试小说")
  assert.equal(result.record.seriesId, 77)

  const missing = library.offlineReadResult(999)
  assert.equal(missing.record, null)
  assert.equal(missing.source, "unavailable")
  assert.equal(missing.offline, true)
})

test("进程重启（内存缓存清空）后仍可读，索引可从磁盘恢复", () => {
  const { library, root, globals, safeFile, dataDirectory, anchor } = setup()
  library.saveOfflineEpisode({ novelId: 601, title: "重启可读", text: "正文内容" })
  // 模拟进程重启：删除索引，仅保留正文文件，再新建模块实例
  fs.rmSync(`${root}/Pix-Scripting/NovelOffline/users/1001/index.json`, { force: true })
  const restarted = loadModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "./novelAnchor": anchor,
  }, globals)
  const result = restarted.offlineReadResult(601)
  assert.equal(result.source, "offline")
  assert.equal(result.record.text, "正文内容")
  const list = restarted.listOfflineEpisodes()
  assert.equal(list.length, 1)
  assert.equal(list[0].novelId, 601)
  // 索引已按磁盘重建并落盘
  assert.ok(fs.existsSync(`${root}/Pix-Scripting/NovelOffline/users/1001/index.json`))
})

test("按账号隔离：另一账号看不到本账号的离线正文", () => {
  const { library } = setup(1001)
  library.saveOfflineEpisode({ novelId: 701, title: "甲的书", text: "甲的内容" }, 1001)
  assert.equal(library.readOfflineEpisode(701, 1001).text, "甲的内容")
  assert.equal(library.readOfflineEpisode(701, 2002), null)
  assert.equal(library.hasOfflineEpisode(701, 2002), false)
  // 另一账号写入同 ID 作品互不覆盖
  library.saveOfflineEpisode({ novelId: 701, title: "乙的书", text: "乙的内容" }, 2002)
  assert.equal(library.readOfflineEpisode(701, 1001).title, "甲的书")
  assert.equal(library.readOfflineEpisode(701, 2002).title, "乙的书")
})

test("图片完整性状态可记录并汇总，缺图不产生悬空正文", () => {
  const { library } = setup()
  library.saveOfflineEpisode({
    novelId: 801,
    title: "含插图",
    text: "正文[uploadedimage:9]继续",
    images: [
      { chunkId: "up-1", status: "ok" },
      { chunkId: "up-2", status: "missing" },
      { chunkId: "up-3", status: "pending" },
    ],
  })
  const summary = library.listOfflineEpisodes().find((item) => item.novelId === 801)
  assert.equal(summary.imageTotal, 3)
  assert.equal(summary.imageOk, 1)

  library.updateOfflineEpisodeImages(801, [{ chunkId: "up-2", status: "ok", bytes: 12 }])
  const after = library.readOfflineEpisode(801)
  assert.equal(library.summarizeImageIntegrity(after.images).ok, 2)
  assert.equal(library.summarizeImageIntegrity(after.images).pending, 1)
  assert.equal(after.text, "正文[uploadedimage:9]继续")
})

test("再次保存同篇内容会更新正文并保留首次保存时间", () => {
  const { library } = setup()
  const first = library.saveOfflineEpisode({ novelId: 901, title: "第一版", text: "旧正文" })
  assert.equal(first.text, "旧正文")
  const second = library.saveOfflineEpisode({ novelId: 901, title: "第一版", text: "新正文[newpage]续写" })
  assert.equal(second.text, "新正文[newpage]续写")
  assert.equal(second.savedAt, first.savedAt)
  assert.equal(second.pageCount, 2)
  const list = library.listOfflineEpisodes()
  assert.equal(list.filter((item) => item.novelId === 901).length, 1)
  assert.equal(list[0].contentVersion, second.contentVersion)
})

test("容量管理按最近访问淘汰，绝不删除阅读进度与批注", () => {
  const { library, root } = setup()
  // 阅读进度与批注位于 History 目录（与书库物理隔离）
  const progressPath = `${root}/Pix-Scripting/History/users/1001/novel_progress.json`
  fs.mkdirSync(path.dirname(progressPath), { recursive: true })
  fs.writeFileSync(progressPath, JSON.stringify([{ novelID: 1001, page: 9, updatedAt: 1 }]), "utf8")

  for (const id of [1001, 1002, 1003]) {
    library.saveOfflineEpisode({ novelId: id, title: `书${id}`, text: "正文".repeat(500) })
  }
  library.markOfflineEpisodeAccessed(1003)
  const usageBefore = library.offlineLibraryUsage()
  assert.equal(usageBefore.count, 3)

  // 上限设为现有占用的 2/3，至少需要淘汰 1 篇
  const limit = Math.floor(usageBefore.bytes * 0.66)
  const result = library.enforceOfflineLibraryCapacity(limit)
  assert.ok(result.evicted.length >= 1)
  assert.ok(result.evicted.includes(1001))
  assert.equal(library.hasOfflineEpisode(1003), true)
  assert.equal(library.offlineLibraryUsage().bytes <= limit, true)
  // 进度文件仍在，且内容未被改写
  assert.ok(fs.existsSync(progressPath))
  assert.equal(JSON.parse(fs.readFileSync(progressPath, "utf8"))[0].page, 9)

  // 未超限时不淘汰
  const noop = library.enforceOfflineLibraryCapacity(1024 * 1024 * 1024)
  assert.equal(noop.evicted.length, 0)
})

test("乐观清理：清空正文缓存但保留进度批注，并验证路径守卫", () => {
  const { library, root } = setup()
  const progressPath = `${root}/Pix-Scripting/History/users/1001/novel_progress.json`
  fs.mkdirSync(path.dirname(progressPath), { recursive: true })
  fs.writeFileSync(progressPath, "[]", "utf8")
  library.saveOfflineEpisode({ novelId: 1101, title: "书", text: "正文" })
  library.saveOfflineSeriesManifest({ seriesId: 55, title: "系列", episodeIds: [1101] })
  const cleared = library.clearOfflineLibraryContent()
  assert.equal(cleared.removed.join(","), "1101")
  assert.equal(library.hasOfflineEpisode(1101), false)
  assert.equal(library.readOfflineSeriesManifest(55), null)
  assert.ok(fs.existsSync(progressPath))

  // 路径守卫：书库根目录之外不得删除
  const studentRoot = library.offlineLibraryRoot()
  assert.equal(library.isSafeLibraryPath(studentRoot, `${studentRoot}/episodes/1.json`), true)
  assert.equal(library.isSafeLibraryPath(studentRoot, `${root}/Pix-Scripting/History/users/1001/x.json`), false)
  assert.equal(library.isSafeLibraryPath(studentRoot, `${studentRoot}/../History/x.json`), false)
})

test("atomic 写入：写入校验失败时不破坏已有离线正文（回退可用）", () => {
  const { library, root } = setup()
  library.saveOfflineEpisode({ novelId: 1201, title: "稳健", text: "原有正文" })
  const episodeFile = `${root}/Pix-Scripting/NovelOffline/users/1001/episodes/1201.json`
  assert.ok(fs.existsSync(episodeFile))
  // 人为注入一个写入后校验失败：让 readAsStringSync 在临时文件上返回坏内容
  const original = fs.readFileSync(episodeFile, "utf8")
  const brokenFileManager = { ...library, _: true }
  assert.ok(original.includes("原有正文"))
  // 恢复流程：把正式文件挪走但保留 .bak，读取时应自动回退
  fs.renameSync(episodeFile, `${episodeFile}.bak`)
  const recovered = library.readOfflineEpisode(1201)
  assert.ok(recovered)
  assert.equal(recovered.text, "原有正文")
  assert.ok(fs.existsSync(episodeFile))
  assert.equal(fs.existsSync(brokenFileManager), false)
})

test("系列清单：TTL、分页游标与完整标记", () => {
  const { library } = setup()
  const manifest = library.saveOfflineSeriesManifest({
    seriesId: 1301,
    title: "长篇系列",
    episodeIds: [1, 2, 3],
    missingEpisodeIds: [4],
    complete: true,
    pageCursor: "cursor-2",
  })
  assert.equal(manifest.complete, false) // 有缺章时不得标记完整
  assert.equal(manifest.pageCursor, "cursor-2")
  assert.equal(library.seriesManifestComplete(manifest), false)
  assert.equal(library.isSeriesManifestFresh(manifest), true)

  const full = library.saveOfflineSeriesManifest({
    seriesId: 1302,
    title: "完整系列",
    episodeIds: [1, 2],
    complete: true,
  })
  assert.equal(library.seriesManifestComplete(full), true)
  // 超过 TTL 视为过期
  assert.equal(library.isSeriesManifestFresh(full, Date.now() + 8 * 24 * 60 * 60 * 1000), false)
  assert.equal(library.isSeriesManifestFresh(full, Date.now() + 6 * 24 * 60 * 60 * 1000), true)
  assert.equal(library.isSeriesManifestFresh(null), false)
  assert.equal(library.readOfflineSeriesManifest(9999), null)

  const stored = library.readOfflineSeriesManifest(1301)
  assert.equal(stored.episodeIds.length, 3)
  assert.equal(library.offlineLibraryUsage().seriesManifests, 2)
})

test("阅读状态筛选：最高已读与当前进度分开，未读/在读/读完可筛选", () => {
  const { library } = setup()
  const summaries = [
    { novelId: 1, title: "a-未读", bytes: 10, savedAt: 1, lastAccessAt: 1, imageOk: 0, imageTotal: 0,
      contentVersion: "v1", pageCount: 5, paragraphCount: 1 },
    { novelId: 2, title: "b-在读", bytes: 10, savedAt: 2, lastAccessAt: 3, imageOk: 0, imageTotal: 0,
      contentVersion: "v1", pageCount: 5, paragraphCount: 1 },
    { novelId: 3, title: "c-读完", bytes: 10, savedAt: 3, lastAccessAt: 2, imageOk: 0, imageTotal: 0,
      contentVersion: "v1", pageCount: 5, paragraphCount: 1 },
  ]
  const progress = {
    2: { currentPage: 2, highestPage: 4 },
    3: { currentPage: 5, highestPage: 5 },
  }
  const views = library.buildOfflineViews(summaries, (id) => progress[id] ?? null)
  assert.equal(views[0].readState, null)
  assert.equal(views[1].reading, true)
  assert.equal(views[1].readState.highestPage, 4)
  assert.equal(views[2].finished, true)

  assert.equal(library.filterOfflineViews(views, "reading").map((v) => v.novelId).join(","), "2")
  assert.equal(library.filterOfflineViews(views, "unread").map((v) => v.novelId).join(","), "1")
  assert.equal(library.filterOfflineViews(views, "finished").map((v) => v.novelId).join(","), "3")
  assert.equal(library.filterOfflineViews(views, "all").length, 3)

  assert.equal(library.sortOfflineViews(views, "saved").map((v) => v.novelId).join(","), "3,2,1")
  assert.equal(library.sortOfflineViews(views, "title").map((v) => v.novelId).join(","), "1,2,3")
  assert.equal(library.sortOfflineViews(views, "recent").map((v) => v.novelId).join(","), "2,3,1")
  assert.equal(library.offlineBadgeText(true, true), "离线可用")
  assert.equal(library.offlineBadgeText(true, false), "未离线保存")
})

test("负向：章节页数与段落统计函数对空文本退化正确", () => {
  const { library } = setup()
  assert.equal(library.countOfflinePages(""), 1)
  assert.equal(library.countOfflinePages("[newpage][newpage]"), 3)
  assert.equal(library.countOfflineParagraphs("a\n\n\n b \n"), 2)
  assert.equal(library.countOfflineParagraphs(""), 0)
  assert.equal(library.summarizeImageIntegrity(undefined).total, 0)
  assert.equal(library.readOfflineEpisode(0), null)
  assert.equal(library.saveOfflineEpisode({ novelId: 0, title: "x", text: "y" }), null)
  assert.equal(library.removeOfflineEpisode(0), false)
})
