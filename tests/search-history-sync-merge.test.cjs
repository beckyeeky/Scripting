const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

function makeHarness(local, cloud) {
  const historySource = fs.readFileSync("Pix-Scripting/src/store/searchHistory.ts", "utf8")
  const historyJs = ts.transpileModule(historySource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const historyModule = { exports: {} }
  vm.runInNewContext(historyJs, { module: historyModule, exports: historyModule.exports,
    require: () => ({}), console, setTimeout, clearTimeout })

  const source = fs.readFileSync("Pix-Scripting/src/store/historySync.ts", "utf8")
  const sameRecord = source.slice(source.indexOf("function sameRecord("), source.indexOf("// 0. 同步同步元数据文件"))
  const sync = source.slice(source.indexOf("async function syncSearchHistoryFile("), source.indexOf("// 统一立即同步入口"))
  const js = ts.transpileModule(`${sameRecord}\n${sync}\nmodule.exports = syncSearchHistoryFile`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  let localResult = local
  let cloudResult = cloud
  let syncState
  vm.runInNewContext(js, { module, exports: module.exports, console,
    Date, Map, Object, Array, JSON, Math, Number, String,
    prepareCloudFile: async () => true, assertSyncAccount() {},
    getFullSearchHistoryStore: () => localResult,
    readCloudJson: () => cloudResult,
    normalizeHistoryEntries: historyModule.exports.normalizeHistoryEntries,
    MAX_SEARCH_HISTORY_ITEMS: historyModule.exports.MAX_SEARCH_HISTORY_ITEMS,
    loadSyncState: () => ({ lastSyncTime: 0, tombstones: {}, clearBefore: {} }),
    saveSyncState: state => { syncState = state },
    replaceSearchHistoryStore: store => { localResult = store },
    writeTextSafely: (path, content) => { cloudResult = JSON.parse(content) },
  })
  return { run: () => module.exports("/local", "/cloud", { tombstones: {}, clearBefore: {} }),
    local: () => localResult, cloud: () => cloudResult, state: () => syncState }
}
const empty = () => ({ illust: [], novel: [], user: [], updatedAt: Date.now() })
const queries = entries => Array.from(entries, item => item.query)

test("搜索历史单条删除不会被另一设备旧记录复活", async () => {
  const now = Date.now()
  const local = { ...empty(), tombstones: { "novel:旧词": now - 1000 } }
  const cloud = { ...empty(), novel: [{ query: "旧词", searchedAt: now - 2000 }, { query: "保留", searchedAt: now - 1500 }] }
  const harness = makeHarness(local, cloud)
  await harness.run()
  assert.deepEqual(queries(harness.local().novel), ["保留"])
  assert.deepEqual(queries(harness.cloud().novel), ["保留"])
  assert.equal(harness.state().searchTombstones["novel:旧词"], now - 1000)
})

test("删除后重新搜索保留新记录并清除旧删除标记", async () => {
  const now = Date.now()
  const local = { ...empty(), novel: [{ query: "词", searchedAt: now - 500 }], tombstones: { "novel:词": now - 1000 } }
  const cloud = { ...empty(), novel: [{ query: "词", searchedAt: now - 2000 }] }
  const harness = makeHarness(local, cloud)
  await harness.run()
  assert.equal(harness.local().novel[0].searchedAt, now - 500)
  assert.equal(harness.cloud().novel[0].searchedAt, now - 500)
  assert.equal(harness.state().searchTombstones["novel:词"], undefined)
})

test("清空水位线只过滤对应分类的较早搜索", async () => {
  const now = Date.now()
  const local = { ...empty(), clearBefore: { novel: now - 1000 } }
  const cloud = { ...empty(), novel: [{ query: "旧", searchedAt: now - 2000 }, { query: "新", searchedAt: now - 500 }],
    illust: [{ query: "插画", searchedAt: now - 2000 }] }
  const harness = makeHarness(local, cloud)
  await harness.run()
  assert.deepEqual(queries(harness.local().novel), ["新"])
  assert.deepEqual(queries(harness.local().illust), ["插画"])
  assert.equal(harness.cloud().clearBefore.novel, now - 1000)
})
