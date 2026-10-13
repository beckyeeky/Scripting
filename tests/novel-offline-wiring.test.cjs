/**
 * 离线读取接线回归（沉浸阅读器内部换篇 + 正文插图字节）。
 *
 * 使用真实锚点、真实阅读器运行时、真实离线书库实现；
 * 只替换宿主 FileManager（真实文件系统）、网络边界（novelDetail/novelViewerData/loadImage）。
 */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const ts = require("typescript")

const READER_FILE = "Pix-Scripting/src/ui/NovelImmersiveReader.tsx"
const NOVEL_READER_FILE = "Pix-Scripting/src/ui/NovelReader.tsx"

function transpile(file, source) {
  return ts.transpileModule(source ?? fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
}

function loadTsModule(file, mocks = {}, globals = {}) {
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

// 真实正文解析（分块 id 必须与阅读器一致，才能命中离线插图记录）
const readerSource = fs.readFileSync(path.join(__dirname, "..", NOVEL_READER_FILE), "utf8")
const readerSliced = readerSource.slice(
  readerSource.indexOf("export function escapeHtml"),
  readerSource.indexOf("function getLocalImageDataUrl")
)
const readerModule = { exports: {} }
vm.runInNewContext(transpile(NOVEL_READER_FILE, readerSliced), {
  module: readerModule,
  exports: readerModule.exports,
  console: { log() {}, warn() {} },
  setTimeout: () => 0,
  clearTimeout() {},
  require() { throw new Error("NovelReader 切片不应依赖额外模块") },
}, { filename: NOVEL_READER_FILE })
const readerExports = readerModule.exports

const anchorExports = loadTsModule("Pix-Scripting/src/store/novelAnchor.ts")
const runtimeExports = loadTsModule("Pix-Scripting/src/ui/novelReaderRuntime.ts", {
  "../store/novelAnchor": anchorExports,
})

/* ------------------------- 极简 hooks 运行时 ------------------------- */
function createHookRuntime() {
  const slots = []
  let cursor = 0
  let props = null
  let component = null
  let queued = false
  const sameDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]))
  let lastTree = null
  function renderNow() {
    cursor = 0
    const tree = component(props)
    lastTree = tree
    for (const slot of slots) {
      if (!slot || !slot.pending) continue
      slot.pending = false
      if (typeof slot.cleanup === "function") {
        try { slot.cleanup() } catch {}
      }
      const cleanup = slot.fn()
      slot.cleanup = typeof cleanup === "function" ? cleanup : undefined
    }
    return tree
  }
  function schedule() {
    if (queued) return
    queued = true
    Promise.resolve().then(() => { queued = false; renderNow() })
  }
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }
      const slot = slots[index]
      return [slot.value, (next) => {
        const value = typeof next === "function" ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        schedule()
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, value: factory() }
      return slots[index].value
    },
    useCallback(fn, deps) {
      const index = cursor++
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { deps, value: fn }
      return slots[index].value
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (!slots[index]) slots[index] = { deps, fn, pending: true }
      else if (!sameDeps(slots[index].deps, deps)) {
        slots[index].deps = deps
        slots[index].fn = fn
        slots[index].pending = true
      }
    },
  }
  return {
    hooks,
    tree: () => lastTree,
    mount(componentFn, initialProps) { component = componentFn; props = initialProps; return renderNow() },
    render: () => renderNow(),
    async settle(rounds = 8) { for (let i = 0; i < rounds; i++) await Promise.resolve() },
  }
}

/* ------------------------- 宿主 FileManager（真实文件系统） ------------------------- */
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

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6])
const OFFLINE_TEXT = "离线正文一\n\n[uploadedimage:9]\n\n离线正文二\n\n[newpage]\n\n离线正文三"

function setupOfflineEpisode(root, options = {}) {
  const FileManager = makeFileManager(root)
  const globals = { FileManager }
  const safeFile = loadTsModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadTsModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID: 1001 } },
    "./safeFile": safeFile,
  }, globals)
  const library = loadTsModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "./novelAnchor": anchorExports,
  }, globals)

  // 目标作品 2 已在离线书库中
  library.saveOfflineEpisode({
    novelId: 2,
    title: "离线新题",
    author: "离线作者",
    text: OFFLINE_TEXT,
    seriesId: 10,
    episodeNumber: 2,
  })
  const chunks = readerExports.parseNovelToChunks(OFFLINE_TEXT)
  const imageChunk = chunks.find((chunk) => chunk.type === "uploadedimage")
  let offlineDataUrl = null
  if (options.withOfflineImage && imageChunk) {
    const cacheDir = `${root}/cache`
    fs.mkdirSync(cacheDir, { recursive: true })
    const cachePath = `${cacheDir}/reader.png`
    fs.writeFileSync(cachePath, PNG_BYTES)
    const saved = library.saveOfflineImageFromFile({
      novelId: 2, chunkId: imageChunk.id, sourcePath: cachePath,
    })
    library.updateOfflineEpisodeImages(2, [saved])
    offlineDataUrl = library.readOfflineImageDataUrl(2, imageChunk.id)
  }
  return { FileManager, library, chunks, imageChunk, offlineDataUrl }
}

/* ------------------------- 沉浸阅读器挂载 ------------------------- */
function mountImmersive(input) {
  const { FileManager, library, offlineDataUrl, runtime } = input
  const loaded = []
  const evaluated = []
  const loadImageCalls = []
  const handlers = {}
  const controller = {
    loadHTML: async (html) => { loaded.push(html) },
    evaluateJavaScript: async (script) => { evaluated.push(script) },
    addScriptMessageHandler: async (name, fn) => { handlers[name] = fn },
    dispose() {},
  }
  const globals = {
    ...readerExports,
    ...anchorExports,
    ...runtimeExports,
    ...library,
    FileManager,
    console: { log() {}, warn() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    useState: (...args) => runtime.hooks.useState(...args),
    useRef: (...args) => runtime.hooks.useRef(...args),
    useMemo: (...args) => runtime.hooks.useMemo(...args),
    useCallback: (...args) => runtime.hooks.useCallback(...args),
    useEffect: (...args) => runtime.hooks.useEffect(...args),
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    WebViewController: function () { return controller },
    Device: { screen: { height: 800 } },
    session: { call: (fn) => fn("fixture-token") },
    // 网络边界：换篇时全部失败，只有离线书库可用
    novelDetail: async () => { throw new Error("network down") },
    novelViewerData: async () => { throw new Error("network down") },
    illustrationDetail: async () => undefined,
    getCachedNovel: () => null,
    cacheNovel() {},
    recordNovelHistory() {},
    getNovelProgress: () => undefined,
    recordNovelProgress() {},
    getCachedNovelMarker: () => null,
    recordNovelMarker() {},
    addNovelMarker: async () => {},
    deleteNovelMarker: async () => {},
    cleanHtmlCaption: (value) => value || "",
    loadImage: async (url) => { loadImageCalls.push(url); return null },
    imageUrlOf: () => null,
    novelThumbUrlOf: () => null,
    requestPixivRoute() {},
    presentExternalURL() {},
    routeForDescriptionLink: () => null,
    triggerHaptic() {},
    appGlass: () => ({}),
    appInteractiveGlass: () => ({}),
    appCustomTint: () => "systemBlue",
    Animation: { smooth: () => ({}) },
    useLayoutMetrics: () => ({ isLandscape: false }),
    useEffectiveIsDark: () => false,
    useNovelExperimentalAmbientPalette: () => ({}),
    generateAmbientBackgroundCss: () => "transparent",
    useSeriesEpisodeNav: () => ({
      seriesID: 10, seriesTitle: "系列", episodeNumber: 1,
      hasPrev: false, prevID: null, hasNext: true, nextID: 2, loading: false,
    }),
    useNovelTranslation: () => ({ session: null, snapshot: null }),
    loadNovelReaderSettings: () => ({
      layoutDirection: "horizontal", pageDisplayMode: "continuous",
      fontSize: 18, fontWeight: "regular", lineSpacingLevel: 1,
    }),
    onNovelReaderSettingsChanged: () => () => {},
    resolveFontName: () => null,
    calculateLineSpacing: () => 6,
  }
  for (const name of ["NavigationStack", "ZStack", "VStack", "HStack", "Button", "Image", "WebView",
    "Rectangle", "Text", "Spacer", "Menu", "Picker", "ProgressView", "Group", "Divider", "ScrollView",
    "NovelTypographySheet", "NovelOutlineSearchSheet"]) {
    globals[name] = name
  }

  const file = READER_FILE
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const sliced = source.slice(source.indexOf("function isVirtualNode"))
  const module = { exports: {} }
  vm.runInNewContext(transpile(file, sliced), {
    module,
    exports: module.exports,
    require(id) { throw new Error(`未提供替身的导入：${id}`) },
    ...globals,
  }, { filename: path.join(__dirname, "..", file) })

  const props = {
    novelId: 1,
    textEmbeddedImages: input.embeddedImages ?? undefined,
    title: "原题",
    caption: "简介",
    text: "在线正文一\n[newpage]\n在线正文二",
    markerPage: 1,
    currentPage: 1,
    seriesID: 10,
    seriesTitle: "系列",
    seriesPrev: null,
    seriesNext: { id: 2 },
    episodeNumber: 1,
    onClose() {},
  }
  const tree = runtime.mount(module.exports.NovelImmersiveReaderView, props)
  return { tree, loaded, evaluated, loadImageCalls, handlers, controller, offlineDataUrl }
}

/* ------------------------- 行为断言 ------------------------- */

test("断网换篇：已离线保存的下一话仍能载入并明确标注离线", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-offline-wiring-"))
  const offline = setupOfflineEpisode(root)
  const runtime = createHookRuntime()
  const harness = mountImmersive({ ...offline, runtime })
  await runtime.settle()
  assert.equal(harness.loaded.length, 1)

  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: 1 })
  await runtime.settle()
  assert.equal(harness.loaded.length, 2, "网络失败但该话已离线时必须换篇成功")
  assert.match(harness.loaded[1], /离线正文一/)
  assert.match(harness.loaded[1], /离线正文三/)

  // 离线标注出现在界面上（不把离线内容说成在线），目录也切换到离线正文
  const flat = JSON.stringify(runtime.tree())
  assert.match(flat, /离线阅读：本话正文来自离线书库/)
  assert.match(flat, /离线正文一/)
  assert.doesNotMatch(flat, /在线正文一/)
})

test("没有离线记录的换篇在网络失败时仍按失败处理（不伪造正文）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-offline-wiring-empty-"))
  const FileManager = makeFileManager(root)
  const globals = { FileManager }
  const safeFile = loadTsModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadTsModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID: 1001 } }, "./safeFile": safeFile,
  }, globals)
  const library = loadTsModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": dataDirectory, "./safeFile": safeFile, "./novelAnchor": anchorExports,
  }, globals)
  const runtime = createHookRuntime()
  const harness = mountImmersive({ FileManager, library, runtime, offlineDataUrl: null })
  await runtime.settle()
  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: 1 })
  await runtime.settle()
  assert.equal(harness.loaded.length, 1, "没有任何离线正文时不得载入空文档")
  assert.match(JSON.stringify(runtime.tree()), /载入失败/)
})

test("已离线落盘的正文插图在阅读时直接读本地字节，不依赖网络与阅读器缓存", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-offline-wiring-img-"))
  const offline = setupOfflineEpisode(root, { withOfflineImage: true })
  assert.ok(offline.offlineDataUrl, "前置条件：插图字节已落盘")
  // 模拟阅读器缓存被清理：离线书库里的字节仍在
  fs.rmSync(`${root}/cache`, { recursive: true, force: true })

  const runtime = createHookRuntime()
  const harness = mountImmersive({
    ...offline,
    runtime,
    // 在线路径本可以下载这张图：离线命中后不得再去下载
    embeddedImages: { "9": { novelImageId: "9", urls: { original: "https://img/9.png" } } },
  })
  await runtime.settle()
  // 换到已离线保存的第 2 话（网络仍不可用）
  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: 1 })
  await runtime.settle()
  assert.equal(harness.loaded.length, 2)

  const pushed = harness.evaluated.filter((script) => script.includes("updateNovelImage"))
  const base64 = offline.offlineDataUrl.split("base64,")[1]
  assert.ok(
    pushed.some((script) => script.includes(base64.slice(0, 32))),
    "离线插图必须以本地字节下发给 WebView"
  )
  assert.equal(
    harness.loadImageCalls.some((url) => String(url) === "https://img/9.png"),
    false,
    "离线命中时不得再为同一块发起网络下载"
  )
})
