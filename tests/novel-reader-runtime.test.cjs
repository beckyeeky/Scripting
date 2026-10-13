const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function transpile(file) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  return ts.transpileModule(source, { fileName: absolute, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText
}

function loadModule(file, mocks = {}, globals = {}) {
  const js = transpile(file)
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: path.join(__dirname, "..", file) })
  return module.exports
}

const anchorModule = loadModule("Pix-Scripting/src/store/novelAnchor.ts")
const runtime = loadModule("Pix-Scripting/src/ui/novelReaderRuntime.ts", {
  "../store/novelAnchor": anchorModule,
})

// 真实离线书库实现（FileManager 为宿主替身：本测试环境没有任何离线内容）
const offlineFileManagerStub = {
  documentsDirectory: "/tmp/pix-novel-reader-runtime",
  iCloudDocumentsDirectory: "/tmp/pix-novel-reader-runtime-icloud",
  appGroupDocumentsDirectory: "/tmp/pix-novel-reader-runtime-group",
  isiCloudEnabled: false,
  existsSync: () => false,
  createDirectorySync() {},
  readDirectorySync: () => [],
  readAsStringSync: () => "",
  writeAsStringSync() {},
  statSync: () => ({ size: 0 }),
  removeSync() {},
  renameSync() {},
  isDirectorySync: () => false,
  copyFileSync() {},
  readAsDataSync: () => null,
}
const offlineSafeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, {
  FileManager: offlineFileManagerStub,
})
const offlineDataDirectory = loadModule(
  "Pix-Scripting/src/store/dataDirectory.ts",
  { "../api/session": { session: { userID: 1001 } }, "./safeFile": offlineSafeFile },
  { FileManager: offlineFileManagerStub }
)
const offlineLibrary = loadModule(
  "Pix-Scripting/src/store/novelOfflineLibrary.ts",
  {
    "./dataDirectory": offlineDataDirectory,
    "./safeFile": offlineSafeFile,
    "./novelAnchor": anchorModule,
  },
  { FileManager: offlineFileManagerStub }
)

/* ───────────────────────── 一、注入脚本语法与协议 ───────────────────────── */

test("注入运行时可解析，且不含网络/原生调用", () => {
  const js = runtime.NOVEL_READER_RUNTIME_JS
  assert.doesNotThrow(() => new Function(js))
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|webkit\.messageHandlers/)
  assert.match(js, /window\.NovelReaderRuntime = NovelReaderRuntime;/)
  assert.match(runtime.NOVEL_READER_RUNTIME_CSS, /novel-hit-mark/)
})

/** 用最小替身加载沉浸阅读器模块，只调用其 HTML 生成函数 */
function loadImmersiveReader() {
  const reactish = new Proxy({}, { get: () => () => null })
  const scriptingStub = new Proxy(
    {
      useCallback: (fn) => fn,
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [typeof value === "function" ? value() : value, () => {}],
      Device: { isiPad: false, screen: { height: 844 } },
      WebViewController: class {},
    },
    { get: (target, key) => (key in target ? target[key] : () => null) }
  )
  const novelReaderStub = {
    escapeHtml: (value) => String(value ?? ""),
    formatPixivRubyToHtml: (value) => String(value ?? ""),
    groupChunksByPage: (chunks) => [{ page: 1, items: chunks }],
    parseNovelToChunks: (text) => [{ id: "chunk-1", type: "text", text, page: 1 }],
    buildNovelTranslationPatchScript: () => "",
  }
  const settingsStub = {
    calculateLineSpacing: () => 6,
    loadNovelReaderSettings: () => ({ fontSize: 17, layoutDirection: "horizontal" }),
    onNovelReaderSettingsChanged: () => () => {},
    resolveFontName: () => "PingFang SC",
  }
  return loadModule("Pix-Scripting/src/ui/NovelImmersiveReader.tsx", {
    scripting: scriptingStub,
    "./components/glass": { appGlass: (s) => s, appInteractiveGlass: (s) => s, appCustomTint: () => undefined, currentGlass: () => null },
    "./Hooks": { useLayoutMetrics: () => ({ width: 390, isLandscape: false }), useEffectiveIsDark: () => false },
    "./components": { presentExternalURL: () => {}, routeForDescriptionLink: () => null },
    "../store/routeNavigation": { requestPixivRoute: () => {} },
    "../store/novelReaderSettings": settingsStub,
    "../store/settings": {},
    "../image/colorExtractor": {},
    "../store/bookmarkSync": { getCachedNovelMarker: () => null, recordNovelMarker: () => {} },
    "./NovelTypographySheet": { NovelTypographySheet: () => null },
    "./NovelOutlineSearchSheet": { NovelOutlineSearchSheet: () => null },
    "./NovelReader": novelReaderStub,
    "../store/novelProgress": { getNovelProgress: () => null, recordNovelProgress: () => {} },
    "../store/novelAnchor": anchorModule,
    "../store/novelOfflineLibrary": offlineLibrary,
    "./novelReaderRuntime": runtime,
    "../image/imageLoader": {},
    "./ambient": {},
    "../api/session": { session: { call: async () => null } },
    "../api/pixiv": {},
    "../store/novelCache": { getCachedNovel: () => null, cacheNovel: () => {} },
    "../store/history": { recordNovelHistory: () => {} },
    "./SeriesEpisodePager": { useSeriesEpisodeNav: () => ({}) },
    "../platform/haptics": { triggerHaptic: () => {} },
    "./useNovelTranslation": { useNovelTranslation: () => ({ session: null, snapshot: null }) },
    "./NovelTranslationStatus": { NovelTranslationStatus: () => null },
    "../api/aiService": { cleanHtmlCaption: (value) => value ?? "" },
  })
}

const sampleChunks = [
  { id: "chapter-1", type: "chapter", title: "第一章 月下", page: 1, index: 0 },
  { id: "chunk-1", type: "text", text: "月光洒在窗台上。", page: 1, index: 1 },
  { id: "page-2", type: "newpage", page: 2, index: 2 },
  { id: "chunk-2", type: "text", text: "第二页正文。", page: 2, index: 3 },
]

function extractScript(html) {
  const start = html.indexOf("<script>")
  const end = html.lastIndexOf("</script>")
  assert.ok(start >= 0 && end > start, "生成的 HTML 必须包含脚本块")
  return html.slice(start + "<script>".length, end)
}

test("横排与竖排模板都注入运行时、续读锚点与检索跳转协议", () => {
  const reader = loadImmersiveReader()
  for (const layoutDirection of ["horizontal", "vertical"]) {
    const html = reader.buildImmersiveHtml({
      chunks: sampleChunks,
      settings: { fontSize: 17, layoutDirection },
      initialChunkId: "chunk-1",
      initialPage: 1,
      initialAnchor: { chunkId: "chunk-1", page: 1, offset: 4, quote: "月光洒在窗台上。" },
      title: "测试小说",
      ownerGeneration: 1,
    })
    assert.match(html, /NovelReaderRuntime/, layoutDirection)
    assert.match(html, /var initialAnchor = \{"chunkId":"chunk-1","page":1,"offset":4,"quote":"月光洒在窗台上。"\}/)
    assert.match(html, /window\.jumpToReaderAnchor = function/)
    assert.match(html, /window\.clearReaderHighlight = function/)
    assert.match(html, /offset: anchorInfo\.offset \|\| 0, quote: anchorInfo\.quote \|\| ""/)
    assert.match(html, /realignAfterContentChange/)
    assert.match(html, /novel-hit-mark/)
    // 生成的脚本块必须可解析（语法错误会在 WebView 里静默失效）
    assert.doesNotThrow(() => new Function(extractScript(html)), layoutDirection)
  }
})

test("模板不再把用户滚动后的位置强行拉回", () => {
  const reader = loadImmersiveReader()
  const html = reader.buildImmersiveHtml({
    chunks: sampleChunks,
    settings: { fontSize: 17, layoutDirection: "horizontal" },
    title: "t",
    ownerGeneration: 2,
  })
  const script = extractScript(html)
  // 用户主动滚动 → noteScroll 判为接管；接管后不再自动校正
  assert.match(script, /if \(NovelReaderRuntime\.noteScroll\(\) && isRestoring\) finishSettling\(\);/)
  assert.match(script, /hasUserTakenOver/)
  // 续读恢复的重复尝试在用户接管后必须跳过
  assert.match(script, /if \(!NovelReaderRuntime\.hasUserTakenOver\(\)\) restoreProgress\(targetChunkId\);/)
})

/* ───────────────────────── 二、DOM 侧运行时行为 ───────────────────────── */

function makeDom(blocks) {
  const scrolled = []
  const classAdded = new Set()
  function makeText(block, index) {
    const paras = block.paras
    return {
      innerText: paras[index],
      textContent: paras[index],
      getBoundingClientRect: () => ({ top: block.lines[index] }),
    }
  }
  const nodes = blocks.map((block) => {
    const children = block.paras.map((_, index) => makeText(block, index))
    const classList = {
      add: (name) => classAdded.add(`${block.id}:${name}`),
      remove: (name) => classAdded.delete(`${block.id}:${name}`),
    }
    return {
      id: block.id,
      classList,
      attrs: { "data-chunk-id": block.id, "data-page": String(block.page) },
      getAttribute(name) { return this.attrs[name] ?? null },
      get innerText() { return this.children.map((child) => child.innerText).join("\n") },
      get textContent() { return this.innerText },
      children,
      querySelectorAll: () => children,
      getBoundingClientRect: () => ({ top: 0 }),
      scrollIntoView: () => scrolled.push(block.id),
    }
  })
  const document = {
    getElementById: (id) => nodes.find((node) => node.id === id) || null,
    querySelectorAll: () => nodes,
    createElement: () => ({ className: "", classList: { add() {}, remove() {} } }),
    createTreeWalker: undefined,
    createRange: undefined,
  }
  const window = {}
  return { nodes, scrolled, classAdded, document, window }
}

function loadRuntimeIn(dom) {
  const sandbox = {
    document: dom.document,
    window: dom.window,
    Date, Math, Array, String, Number, Object, Boolean, RegExp, JSON,
  }
  vm.runInNewContext(runtime.NOVEL_READER_RUNTIME_JS, sandbox)
  return dom.window.NovelReaderRuntime
}

function sampleDom() {
  return makeDom([
    { id: "chunk-1", page: 1, paras: ["月光洒在窗台上。", "风起了。"], lines: [0, 40] },
    { id: "chunk-2", page: 2, paras: ["第二页正文。", "结束语。"], lines: [80, 120] },
  ])
}

test("运行时按读取线计算段内偏移与文本锚点", () => {
  const dom = sampleDom()
  const api = loadRuntimeIn(dom)
  const first = api.computeAnchor(dom.nodes[0], 0)
  assert.equal(first.chunkId, "chunk-1")
  assert.equal(first.offset, 0)
  assert.match(first.quote, /^月光洒在窗台上。/)
  const second = api.computeAnchor(dom.nodes[0], 45)
  assert.equal(second.offset, dom.nodes[0].children[0].innerText.length + 1)
  assert.equal(second.quote, "风起了。")
  assert.equal(api.computeAnchor(null, 0), null)
})

test("运行时跳转：块 id 命中；块 id 失效时按文本锚点找回", () => {
  const dom = sampleDom()
  const api = loadRuntimeIn(dom)
  const direct = api.jumpToAnchor({ chunkId: "chunk-2", quote: "结束语。" })
  assert.equal(direct.matched, "chunk")
  assert.deepEqual(dom.scrolled, ["chunk-2"])

  dom.scrolled.length = 0
  // 正文改版：块 id 变化，但文本仍在
  const drifted = api.jumpToAnchor({ chunkId: "chunk-legacy", quote: "月光洒在窗台上。" })
  assert.equal(drifted.matched, "quote")
  assert.equal(drifted.chunkId, "chunk-1")
  assert.deepEqual(dom.scrolled, ["chunk-1"])

  // 找不到任何线索 → 不滚动，交由 TS 侧按页码兜底
  const missing = api.jumpToAnchor({ chunkId: "nope", quote: "不存在的片段", page: 99 })
  assert.equal(missing.matched, "start")
  assert.equal(missing.chunkId, null)
})

test("图片迟加载：待稳态内重新对齐，用户滚动后绝不拉回（回退负测试）", () => {
  const dom = sampleDom()
  const api = loadRuntimeIn(dom)
  api.jumpToAnchor({ chunkId: "chunk-1", quote: "月光洒在窗台上。" })
  assert.equal(api.isSettling(), true)

  let realigned = 0
  assert.equal(api.realignAfterContentChange(() => { realigned += 1 }), true)
  assert.equal(realigned, 1)

  // 跳转本身触发的程序化滚动窗口结束后，用户主动滚动 → 接管
  api.markProgrammatic(0)
  assert.equal(api.noteScroll(), true)
  assert.equal(api.hasUserTakenOver(), true)
  assert.equal(api.isSettling(), false)
  assert.equal(api.realignAfterContentChange(() => { realigned += 1 }), false)
  assert.equal(realigned, 1)

  // 程序化滚动（恢复/跳转自身触发）不算接管
  const freshDom = sampleDom()
  const freshApi = loadRuntimeIn(freshDom)
  freshApi.markProgrammatic(600)
  assert.equal(freshApi.noteScroll(), false)
  assert.equal(freshApi.hasUserTakenOver(), false)
})

test("命中高亮：无 Range 支持时退化为段落级高亮，并可清除", () => {
  const dom = sampleDom()
  const api = loadRuntimeIn(dom)
  assert.equal(api.highlightQuote(dom.nodes[0], "风起了。"), true)
  assert.equal(dom.classAdded.has("chunk-1:novel-hit-para"), true)
  api.clearHighlight()
  assert.equal(dom.classAdded.has("chunk-1:novel-hit-para"), false)
})

/* ───────────────────────── 三、TS 侧锚点换算 ───────────────────────── */

test("WebView 上报的偏移/文本锚点换算为源正文锚点", () => {
  const sourceText = "月光洒在窗台上，她想起那句话。"
  const anchor = runtime.anchorFromReaderMessage(
    { novelId: 11, page: 3, chunkId: "chunk-9", offset: 0, quote: "她想起那句话。" },
    sourceText,
    "v2-100-abcdef12",
    99
  )
  assert.equal(anchor.novelId, 11)
  assert.equal(anchor.page, 3)
  assert.equal(anchor.chunkId, "chunk-9")
  assert.equal(anchor.contentVersion, "v2-100-abcdef12")
  assert.equal(anchor.quote, "她想起那句话。")
  assert.equal(anchor.offset, sourceText.indexOf("她想起那句话。"))
  assert.equal(runtime.anchorFromReaderMessage(null, sourceText, null, 1), null)
  // 无 chunkText 时仍保留上报的文本锚点
  const fallback = runtime.anchorFromReaderMessage({ page: 1, chunkId: "c", quote: "片段" }, "", null, 7)
  assert.equal(fallback.quote, "片段")
  assert.equal(fallback.novelId, 7)
})

test("续读载荷：正文改动后按文本锚点落点并标记 contentChanged", () => {
  const chunks = [
    { id: "chunk-1", type: "text", text: "月光洒在窗台上。" },
    { id: "chunk-2", type: "text", text: "第二页正文。" },
  ]
  const current = anchorModule.computeNovelContentVersion("月光洒在窗台上。\n\n第二页正文。")
  const anchor = {
    novelId: 1, page: 1, chunkId: "chunk-1", offset: 2,
    quote: "第二页正文。", contentVersion: "v2-0-stale", updatedAt: 1,
  }
  const payload = runtime.readerJumpPayload(anchor, chunks, current)
  assert.equal(payload.contentChanged, true)
  assert.equal(payload.chunkId, "chunk-2")
  assert.equal(payload.matched, "quote")
  assert.equal(payload.quote, "第二页正文。")

  // 旧式记录（只有 page）也能得到可用的跳转载荷
  const legacy = runtime.readerJumpPayload({ novelID: 1, page: 2, updatedAt: 1 }, chunks, current)
  assert.equal(legacy.matched, "page")
  assert.equal(legacy.page, 2)
})
