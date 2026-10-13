/**
 * 离线正文插图：按账号真实落盘、断网重启读取、阅读时补全、容量清理边界。
 *
 * 替身边界：只替换宿主 FileManager（用真实文件系统实现）与注入的下载器（网络边界）；
 * 任务生成、落盘复制、路径表、补全判定与容量淘汰全部使用真实实现。
 */
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

/** 真实文件系统上的 FileManager 宿主替身 */
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
    readAsDataSync: (p) => {
      const buffer = fs.readFileSync(p)
      return { toBase64String: () => buffer.toString("base64") }
    },
  }
}

function setup(userID = 1001) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-offline-images-"))
  const FileManager = makeFileManager(root)
  const globals = { FileManager }
  const safeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID } },
    "./safeFile": safeFile,
  }, globals)
  const anchor = loadModule("Pix-Scripting/src/store/novelAnchor.ts", {}, globals)
  const libraryMocks = {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "./novelAnchor": anchor,
  }
  const library = loadModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", libraryMocks, globals)
  const images = loadModule("Pix-Scripting/src/store/novelOfflineImages.ts", {
    "./novelOfflineLibrary": library,
  }, globals)
  const capture = loadModule("Pix-Scripting/src/ui/novelOfflineCapture.ts", {}, globals)
  return { root, FileManager, globals, safeFile, dataDirectory, anchor, library, images, capture }
}

/** 模拟进程重启：重新加载离线书库模块（内存态清空，只保留磁盘） */
function restart(env) {
  return loadModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": env.dataDirectory,
    "./safeFile": env.safeFile,
    "./novelAnchor": env.anchor,
  }, env.globals)
}

/** 造一张真实的本地缓存图片文件（模拟阅读器已下载的缓存） */
function writeCacheImage(root, name, bytes) {
  const dir = `${root}/cache`
  fs.mkdirSync(dir, { recursive: true })
  const file = `${dir}/${name}`
  fs.writeFileSync(file, bytes)
  return file
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

/* ───────────────────────── 一、正文插图任务生成（真实逻辑） ───────────────────────── */

test("插图任务：上传插图取直连地址，正文未解析到地址的不冒充可下载", async () => {
  const { capture } = setup()
  const tasks = await capture.buildOfflineImageTasks({
    chunks: [
      { id: "up-1", type: "uploadedimage", imageId: "111", info: { urls: { "1200x1200": "https://img/1.png" } } },
      { id: "up-2", type: "uploadedimage", imageId: "222" },
      { id: "up-3", type: "uploadedimage", imageId: "333", info: { urls: { original: "https://img/3.png" } } },
      { id: "chunk-1", type: "text", text: "正文" },
    ],
    embeddedImages: { "222": { novelImageId: "222", urls: { "480mw": "https://img/2.png" } } },
  })
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].url, "https://img/1.png")
  assert.equal(tasks[1].url, "https://img/2.png")
  assert.equal(tasks[2].url, "https://img/3.png")
  assert.equal(tasks.every((task) => !task.deferred), true)

  const unresolved = await capture.buildOfflineImageTasks({
    chunks: [{ id: "up-9", type: "uploadedimage", imageId: "999" }],
  })
  assert.equal(unresolved.length, 1)
  assert.equal(unresolved[0].url, null)
  assert.equal(Boolean(unresolved[0].deferred), false)
  assert.match(capture.describeOfflineCaptureTasks(unresolved), /缺地址 1/)
})

test("插图任务：导出地址表兜底、插画详情只注入一次、重复块去重", async () => {
  const { capture } = setup()
  const requested = []
  const tasks = await capture.buildOfflineImageTasks({
    chunks: [
      { id: "up-4", type: "uploadedimage", imageId: "444" },
      { id: "px-1", type: "pixivimage", illustId: 9001, page: 2 },
      { id: "px-2", type: "pixivimage", illustId: 9001, page: 2 },
      { id: "px-3", type: "pixivimage", illustId: 9002 },
      { id: "up-4", type: "uploadedimage", imageId: "444" },
    ],
    imageUrls: { "444": "https://img/4.png" },
    resolveIllustUrl: async (illustId, pageIndex) => {
      requested.push(`${illustId}:${pageIndex}`)
      return illustId === 9001 ? "https://img/px1.png" : null
    },
  })
  assert.equal(tasks.length, 4)
  assert.equal(tasks[0].url, "https://img/4.png")
  assert.equal(tasks[1].url, "https://img/px1.png")
  assert.equal(tasks[1].chunkId, "px-1")
  // 同页重复引用共用一次解析（真实去重：不是四次网络请求）
  assert.deepEqual(requested, ["9001:1", "9002:0"])
  assert.equal(tasks[2].chunkId, "px-2")
  assert.equal(tasks[3].url, null)
})

test("插图任务：超出本次解析上限的保持待补（不谎称缺地址）", async () => {
  const { capture } = setup()
  let calls = 0
  const tasks = await capture.buildOfflineImageTasks({
    chunks: [
      { id: "px-a", type: "pixivimage", illustId: 1 },
      { id: "px-b", type: "pixivimage", illustId: 2 },
      { id: "px-c", type: "pixivimage", illustId: 3 },
    ],
    maxTasks: 2,
    resolveIllustUrl: async () => { calls += 1; return `https://img/${calls}.png` },
  })
  assert.equal(calls, 2)
  assert.equal(tasks[2].url, null)
  assert.equal(tasks[2].deferred, true)
  assert.match(capture.describeOfflineCaptureTasks(tasks), /超上限待补 1/)
})

/* ───────────────────────── 二、真实落盘与断网重启读取 ───────────────────────── */

test("图片字节真实落盘：源缓存被清理后仍可按账号离线读取（非只记缓存路径）", async () => {
  const env = setup(1001)
  const { images, library, capture, root } = env
  const sourcePath = writeCacheImage(root, "reader-cache-1.png", PNG_BYTES)

  library.saveOfflineEpisode({
    novelId: 2001,
    title: "含插图的作品",
    text: "正文[uploadedimage:1]\n\n[newpage]\n\n第二页",
  })
  const tasks = await capture.buildOfflineImageTasks({
    chunks: [{ id: "up-1", type: "uploadedimage", imageId: "1", info: { urls: { original: "https://img/1.png" } } }],
  })
  const summary = await images.persistOfflineImages({
    novelId: 2001,
    tasks,
    loadBytes: async (url) => {
      assert.equal(url, "https://img/1.png")
      return sourcePath
    },
  })
  assert.equal(summary.ok, 1)
  assert.equal(summary.failed, 0)
  assert.equal(summary.bytes, PNG_BYTES.length)
  assert.match(images.offlineImageSummaryText(summary), /插图 1\/1 已离线/)

  // 记录里的状态与磁盘一致，并且指向离线书库内的真实文件
  const record = library.readOfflineEpisode(2001)
  assert.equal(record.images["up-1"].status, "ok")
  assert.equal(record.images["up-1"].fileName.endsWith(".png"), true)

  // 模拟阅读器缓存被 LRU 清理
  fs.rmSync(sourcePath)

  // 模拟进程重启：内存态清空、索引删除，只留磁盘
  fs.rmSync(`${root}/Pix-Scripting/NovelOffline/users/1001/index.json`, { force: true })
  const restarted = restart(env)
  const paths = restarted.offlineImagePathMap(2001)
  assert.equal(typeof paths["up-1"], "string")
  assert.ok(fs.existsSync(paths["up-1"]))
  assert.deepEqual(fs.readFileSync(paths["up-1"]), PNG_BYTES)

  const dataUrl = restarted.readOfflineImageDataUrl(2001, "up-1")
  assert.equal(dataUrl, `data:image/png;base64,${PNG_BYTES.toString("base64")}`)
  // 其它块没有落盘时不得伪造
  assert.equal(restarted.readOfflineImageDataUrl(2001, "up-2"), null)
  assert.equal(restarted.offlineImagePathMap(2001)["up-2"], undefined)
})

test("按账号隔离：另一账号读不到本账号的离线插图字节", () => {
  const env = setup(1001)
  const { root, library } = env
  const sourcePath = writeCacheImage(root, "reader-cache-2.png", PNG_BYTES)
  library.saveOfflineEpisode({ novelId: 2002, title: "甲的书", text: "正文" }, 1001)
  const saved = library.saveOfflineImageFromFile(
    { novelId: 2002, chunkId: "up-1", sourcePath }, 1001
  )
  assert.ok(saved)
  library.updateOfflineEpisodeImages(2002, [saved], 1001)

  assert.equal(library.offlineImagePathMap(2002, 1001)["up-1"] !== undefined, true)
  assert.equal(library.offlineImagePathMap(2002, 2002)["up-1"], undefined)
  assert.equal(library.readOfflineImageDataUrl(2002, "up-1", 2002), null)
  // 另一账号保存同 ID 作品不覆盖甲的文件
  library.saveOfflineEpisode({ novelId: 2002, title: "乙的书", text: "正文" }, 2002)
  assert.equal(library.readOfflineEpisode(2002, 1001).title, "甲的书")
  assert.equal(library.readOfflineEpisode(2002, 2002).title, "乙的书")
})

test("记录标 ok 但文件被清理时，路径表与读取都不谎报可离线", () => {
  const env = setup()
  const { root, library } = env
  const sourcePath = writeCacheImage(root, "reader-cache-3.png", PNG_BYTES)
  library.saveOfflineEpisode({ novelId: 2003, title: "书", text: "正文" })
  const saved = library.saveOfflineImageFromFile({ novelId: 2003, chunkId: "up-1", sourcePath })
  library.updateOfflineEpisodeImages(2003, [saved])
  assert.ok(library.offlineImagePathMap(2003)["up-1"])

  fs.rmSync(`${root}/Pix-Scripting/NovelOffline/users/1001/images/2003/up-1.png`, { force: true })
  for (const name of fs.readdirSync(`${root}/Pix-Scripting/NovelOffline/users/1001/images/2003`)) {
    fs.rmSync(`${root}/Pix-Scripting/NovelOffline/users/1001/images/2003/${name}`, { force: true })
  }
  assert.equal(library.offlineImagePathMap(2003)["up-1"], undefined)
  assert.equal(library.readOfflineImageDataUrl(2003, "up-1"), null)
})

/* ───────────────────────── 三、阅读时补全与容量边界 ───────────────────────── */

test("阅读时补全：待补/失败可补成 ok，已 ok 不重复写，未离线保存时不动磁盘", () => {
  const env = setup()
  const { root, library } = env
  const sourcePath = writeCacheImage(root, "reader-cache-4.png", PNG_BYTES)
  library.saveOfflineEpisode({
    novelId: 2004,
    title: "书",
    text: "正文",
    images: [
      { chunkId: "up-1", status: "pending", note: "超出本次保存上限，阅读时可继续补全" },
      { chunkId: "up-2", status: "failed", note: "插图下载失败" },
      { chunkId: "up-3", status: "missing", note: "未解析到插图地址" },
      { chunkId: "up-4", status: "ok", bytes: 5, fileName: "x.png" },
    ],
  })
  assert.equal(library.completePendingOfflineImage(2004, "up-1", sourcePath), true)
  assert.equal(library.readOfflineEpisode(2004).images["up-1"].status, "ok")
  assert.equal(library.completePendingOfflineImage(2004, "up-2", sourcePath), true)
  assert.equal(library.readOfflineEpisode(2004).images["up-2"].status, "ok")
  assert.equal(library.completePendingOfflineImage(2004, "up-3", sourcePath), true)
  assert.equal(library.readOfflineEpisode(2004).images["up-3"].status, "ok")
  // 已 ok 的块不重复写入
  assert.equal(library.completePendingOfflineImage(2004, "up-4", sourcePath), false)
  // 正文没有记录的块不写入（避免把别的正文图片混入本篇）
  assert.equal(library.completePendingOfflineImage(2004, "up-99", sourcePath), false)
  // 未保存离线的作品完全不动磁盘
  assert.equal(library.completePendingOfflineImage(9999, "up-1", sourcePath), false)
  assert.equal(fs.existsSync(`${root}/Pix-Scripting/NovelOffline/users/1001/images/9999`), false)
})

test("容量清理：同时淘汰正文与插图字节，只动书库、不删阅读进度", () => {
  const env = setup()
  const { root, library } = env
  const progressPath = `${root}/Pix-Scripting/History/users/1001/novel_progress.json`
  fs.mkdirSync(path.dirname(progressPath), { recursive: true })
  fs.writeFileSync(progressPath, JSON.stringify([{ novelId: 3001, page: 3 }]), "utf8")

  const sourcePath = writeCacheImage(root, "reader-cache-5.png", Buffer.alloc(4096, 7))
  for (const novelId of [3001, 3002]) {
    library.saveOfflineEpisode({
      novelId,
      title: `书 ${novelId}`,
      text: "正".repeat(2000),
      images: [{ chunkId: "up-1", status: "pending" }],
    })
    const saved = library.saveOfflineImageFromFile({ novelId, chunkId: "up-1", sourcePath })
    library.updateOfflineEpisodeImages(novelId, [saved])
  }
  const usage = library.offlineLibraryUsage()
  assert.equal(usage.imageFiles, 2)
  assert.ok(usage.imageBytes >= 8192)

  const evicted = library.enforceOfflineLibraryCapacity(usage.bytes - 1)
  assert.equal(evicted.evicted.length, 1)
  assert.ok(evicted.freedBytes >= 4096)
  assert.equal(library.listOfflineEpisodes().length, 1)
  assert.ok(fs.existsSync(progressPath), "阅读进度必须在清理后保留")
  assert.equal(JSON.parse(fs.readFileSync(progressPath, "utf8"))[0].page, 3)
  assert.equal(library.offlineLibraryUsage().imageFiles, 1, "被淘汰作品的插图字节必须一并删除")
})

test("负向：缺失地址的插图不落盘、不产生悬空文件", async () => {
  const env = setup()
  const { root, library, images } = env
  library.saveOfflineEpisode({ novelId: 3003, title: "书", text: "正文", images: [{ chunkId: "up-1", status: "missing" }] })
  const summary = await images.persistOfflineImages({
    novelId: 3003,
    tasks: [{ chunkId: "up-1", url: null }],
    loadBytes: async () => {
      throw new Error("不应触网")
    },
  })
  assert.equal(summary.missing, 1)
  assert.equal(summary.ok, 0)
  assert.equal(library.readOfflineEpisode(3003).images["up-1"].status, "missing")
  assert.equal(fs.existsSync(`${root}/Pix-Scripting/NovelOffline/users/1001/images/3003`), false)
  assert.equal(library.offlineImagePathMap(3003)["up-1"], undefined)
})
