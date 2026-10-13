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

function setup(userID = 1001) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-progress-"))
  const FileManager = {
    documentsDirectory: root,
    iCloudDocumentsDirectory: `${root}-icloud`,
    appGroupDocumentsDirectory: `${root}-group`,
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
  // 可控假定时器：用于精确验证去抖行为，不依赖真实等待
  const timers = new Map()
  let timerSeq = 0
  const globals = {
    FileManager,
    setTimeout: (fn) => {
      const id = ++timerSeq
      timers.set(id, fn)
      return id
    },
    clearTimeout: (id) => {
      timers.delete(id)
    },
  }
  const fireTimers = () => {
    const pending = Array.from(timers.values())
    timers.clear()
    pending.forEach((fn) => fn())
    return pending.length
  }
  const mutations = []
  const safeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID } },
    "./safeFile": safeFile,
  }, globals)
  const progress = loadModule("Pix-Scripting/src/store/novelProgress.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "../api/session": { session: { userID } },
    "./historySync": { notifyLocalMutation: () => mutations.push(Date.now()) },
  }, globals)
  return { root, FileManager, progress, mutations, globals, safeFile, dataDirectory, timers, fireTimers }
}

function progressPath(root, userID = 1001) {
  return `${root}/Pix-Scripting/History/users/${userID}/novel_progress.json`
}

test("旧格式进度（仅 page/chunkId）可读，并补齐最高已读兜底", () => {
  const { progress, root } = setup()
  const file = progressPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify([
    { novelID: 11, page: 7, chunkId: "chunk-7", updatedAt: 100 },
    { novelID: 0, page: 1, updatedAt: 1 },
    { novelID: 12, page: 0, updatedAt: 2 },
    "bad-entry",
  ]), "utf8")

  const loaded = progress.getNovelProgress(11)
  assert.equal(loaded.page, 7)
  assert.equal(loaded.chunkId, "chunk-7")
  assert.equal(loaded.updatedAt, 100)
  assert.equal(loaded.contentVersion, undefined)
  // 旧记录没有最高已读字段时以当前进度兜底
  const highest = progress.getNovelHighestProgress(11)
  assert.equal(highest.page, 7)
  assert.equal(highest.chunkId, "chunk-7")
  // 非法条目被忽略，不抛错
  assert.equal(progress.getNovelProgress(0), undefined)
  assert.equal(progress.getNovelProgress(12).page, 1)
  assert.equal(progress.hasNovelReadingProgress(11), true)
  assert.equal(progress.hasNovelReadingProgress(12), false)
  assert.equal(progress.getAllNovelProgressMap().size, 2)
})

test("新锚点字段（正文版本/偏移/文本锚点/块序号）持久化并可跨重启恢复", () => {
  const { progress, root, safeFile, dataDirectory, globals, mutations } = setup()
  progress.recordNovelProgress(21, 3, "chunk-3", true, {
    contentVersion: "v2-120-abcd1234",
    offset: 42,
    quote: "月光洒在窗台上。",
    chunkIndex: 5,
  })
  assert.equal(mutations.length, 1)

  const stored = JSON.parse(fs.readFileSync(progressPath(root), "utf8"))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].page, 3)
  assert.equal(stored[0].chunkId, "chunk-3")
  assert.equal(stored[0].contentVersion, "v2-120-abcd1234")
  assert.equal(stored[0].offset, 42)
  assert.equal(stored[0].quote, "月光洒在窗台上。")
  assert.equal(stored[0].chunkIndex, 5)
  // 旧版读取器只会用这三个字段，必须仍然存在且语义不变
  assert.equal(typeof stored[0].novelID, "number")
  assert.equal(typeof stored[0].page, "number")
  assert.equal(typeof stored[0].updatedAt, "number")

  // 模拟进程重启
  const restarted = loadModule("Pix-Scripting/src/store/novelProgress.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "../api/session": { session: { userID: 1001 } },
    "./historySync": { notifyLocalMutation: () => {} },
  }, globals)
  const reloaded = restarted.getNovelProgress(21)
  assert.equal(reloaded.contentVersion, "v2-120-abcd1234")
  assert.equal(reloaded.offset, 42)
  assert.equal(reloaded.quote, "月光洒在窗台上。")
  assert.equal(reloaded.chunkIndex, 5)
})

test("最高已读位置与当前进度分开：回看不回退最高位置", () => {
  const { progress, root } = setup()
  progress.recordNovelProgress(31, 10, "chunk-10", true, { offset: 5, chunkIndex: 9 })
  assert.equal(progress.getNovelHighestProgress(31).page, 10)

  // 用户回看到第 3 页
  progress.recordNovelProgress(31, 3, "chunk-3", true, { offset: 1, chunkIndex: 2 })
  assert.equal(progress.getNovelProgress(31).page, 3)
  assert.equal(progress.getNovelProgress(31).chunkId, "chunk-3")
  assert.equal(progress.getNovelHighestProgress(31).page, 10)
  assert.equal(progress.getNovelHighestProgress(31).chunkId, "chunk-10")

  // 继续读到第 12 页 → 最高位置前移
  progress.recordNovelProgress(31, 12, "chunk-12", true, { offset: 0, chunkIndex: 11 })
  assert.equal(progress.getNovelHighestProgress(31).page, 12)
  assert.equal(progress.getNovelProgress(31).page, 12)

  const stored = JSON.parse(fs.readFileSync(progressPath(root), "utf8"))
  assert.equal(stored[0].page, 12)
  assert.equal(stored[0].highestPage, 12)
})

test("进度写入去抖 + 显式刷盘，重复记录同一位置不产生写入", () => {
  const { progress, root, fireTimers, timers } = setup()
  progress.recordNovelProgress(41, 2, "chunk-2", false, { contentVersion: "v2-1-a", offset: 0 })
  assert.equal(fs.existsSync(progressPath(root)), false) // 去抖期内还没落盘
  assert.equal(timers.size, 1)
  // 连续的中间态：旧定时器被清除，只保留最后一次
  progress.recordNovelProgress(41, 3, "chunk-3", false, { contentVersion: "v2-1-a", offset: 1 })
  assert.equal(timers.size, 1)
  progress.recordNovelProgress(41, 4, "chunk-4", false, { contentVersion: "v2-1-a", offset: 2 })
  assert.equal(fireTimers(), 1)
  const stored = JSON.parse(fs.readFileSync(progressPath(root), "utf8"))
  assert.equal(stored[0].page, 4)

  const before = fs.readFileSync(progressPath(root), "utf8")
  progress.recordNovelProgress(41, 4, "chunk-4", true, { contentVersion: "v2-1-a", offset: 2 })
  assert.equal(fs.readFileSync(progressPath(root), "utf8"), before)

  // 锚点变化时应视为更新
  progress.recordNovelProgress(41, 4, "chunk-4", true, { contentVersion: "v2-2-b", offset: 8 })
  assert.notEqual(fs.readFileSync(progressPath(root), "utf8"), before)
  assert.equal(progress.getNovelProgress(41).offset, 8)

  // flushNovelProgress 在没有待写入时应立即返回 true
  assert.equal(progress.flushNovelProgress(), true)
})

test("清空进度与非法入参的负向行为", () => {
  const { progress, root } = setup()
  progress.recordNovelProgress(51, 1, undefined, true, { chunkIndex: 0 })
  progress.recordNovelProgress(52, 4, "chunk-4", true, {})
  assert.equal(progress.getAllNovelProgressMap().size, 2)
  progress.clearNovelProgress(51)
  assert.equal(progress.getNovelProgress(51), undefined)
  assert.equal(progress.getAllNovelProgressMap().size, 1)
  progress.clearNovelProgress()
  assert.equal(progress.getAllNovelProgressMap().size, 0)
  assert.equal(JSON.parse(fs.readFileSync(progressPath(root), "utf8")).length, 0)

  // 非法入参不得写入
  progress.recordNovelProgress(0, 1, "x", true, {})
  progress.recordNovelProgress(-3, 1, "x", true, {})
  assert.equal(progress.getAllNovelProgressMap().size, 0)
  assert.equal(progress.getNovelProgress(0), undefined)
})

test("replaceNovelProgressMap 保留锚点字段并能持久化", () => {
  const { progress, root } = setup()
  const map = new Map()
  map.set(61, {
    novelID: 61, page: 5, chunkId: "chunk-5", updatedAt: 10,
    contentVersion: "v2-9-ffffffff", offset: 3, quote: "片段", chunkIndex: 4,
    highestPage: 8, highestChunkId: "chunk-8",
  })
  progress.replaceNovelProgressMap(map)
  const stored = JSON.parse(fs.readFileSync(progressPath(root), "utf8"))
  assert.equal(stored[0].contentVersion, "v2-9-ffffffff")
  assert.equal(stored[0].highestPage, 8)
  assert.equal(progress.getNovelHighestProgress(61).page, 8)
})
