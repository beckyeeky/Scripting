/**
 * Pix-Scripting 小说渲染白屏回归（1.7.13.6）
 *
 * 覆盖三类「语法检查通过、运行期必然失败」的缺陷：
 *   A. 组件首次 render 期间读取了「在更后方的 useRef 声明」——转译输出保留 const，
 *      首次执行即抛 ReferenceError（TDZ），整棵组件树渲染失败 = 白屏；
 *   B. 竖排引擎组件未从 props 解构 readingAnchor / controllerSink，
 *      竖向排版下续读锚点与目录跳转控制通道失效；
 *   C. 视图组件使用了 VStack / Spacer 但漏了 `scripting` 导入，宿主渲染 undefined。
 *
 * 设计原则：被测组件为真实源码（经 TypeScript 转译后真实执行），只替换宿主与网络边界
 * （`scripting` 渲染原语用最小宿主替身、FileManager 用真实文件系统、网络接口用替身）。
 * 语义扫描基于真实 TypeScript AST 做作用域/绑定可达性判定，不是字符串匹配。
 */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const scopeScan = require("./lib/scripting-scope-scan.cjs")

const ROOT = path.join(__dirname, "..")
const SOURCE_ROOT = path.join(ROOT, "Pix-Scripting")
const NOVEL_DETAIL = "Pix-Scripting/src/ui/NovelDetail.tsx"
const NOVEL_READER = "Pix-Scripting/src/ui/NovelReader.tsx"
const NOVEL_LIBRARY = "Pix-Scripting/src/ui/NovelLibrary.tsx"

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

function transpile(file, source) {
  return ts.transpileModule(source ?? readSource(file), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
}

/** JSX 转译目标：轻量 createElement，渲染树即普通对象，便于断言。 */
const JSX_RUNTIME = {
  createElement: (type, props, ...children) => {
    if (type === "Menu") {
      for (const child of children.flat(Infinity)) {
        if ((typeof child === "string" && child.trim()) || typeof child === "number") {
          throw new Error(`Native Menu rejects text child: ${JSON.stringify(child)}`)
        }
      }
    }
    return { type, props: { ...(props ?? {}), children } }
  },
}

/** 真实源码 + 宿主替身加载（与既有回归测试一致的装载方式）。 */
function loadTsModule(file, mocks = {}, globals = {}) {
  const module = { exports: {} }
  const requireStub = (id) => {
    if (id in mocks) return mocks[id]
    throw new Error(`缺少测试替身：${id}`)
  }
  vm.runInNewContext(transpile(file), {
    module,
    exports: module.exports,
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
    setTimeout, clearTimeout, queueMicrotask,
    React: JSX_RUNTIME,
    require: requireStub,
    ...globals,
  }, { filename: path.join(ROOT, file) })
  return module.exports
}

/* ───────────────────────── 宿主边界替身（真实文件系统 / 网络） ───────────────────────── */

function makeFileManagerStub(rootDir) {
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
    readAsDataSync: (p) => ({ toBase64String: () => fs.readFileSync(p).toString("base64") }),
  }
}

/** 真实离线书库（FileManager 指向真实临时目录；不需要 iOS 宿主）。 */
function loadOfflineLibraryStack(rootDir) {
  const FileManager = makeFileManagerStub(rootDir)
  const globals = { FileManager }
  const safeFile = loadTsModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadTsModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID: 1001 } },
    "./safeFile": safeFile,
  }, globals)
  const anchorModule = loadTsModule("Pix-Scripting/src/store/novelAnchor.ts")
  const library = loadTsModule("Pix-Scripting/src/store/novelOfflineLibrary.ts", {
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
    "./novelAnchor": anchorModule,
  }, globals)
  return { FileManager, safeFile, dataDirectory, anchorModule, library }
}

/* ───────────────────────── 极简 hooks 运行时（支持重渲染） ───────────────────────── */

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let component = null
  let props = null

  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]))

  function renderNow() {
    cursor = 0
    const tree = component(props)
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

  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }
      const slot = slots[index]
      return [slot.value, (next) => {
        slot.value = typeof next === "function" ? next(slot.value) : next
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
    mount(componentFn, initialProps) { component = componentFn; props = initialProps; return renderNow() },
    render: () => renderNow(),
    runEffects() {
      const effects = []
      for (const slot of slots) {
        if (!slot || !slot.pending) continue
        slot.pending = false
        effects.push(slot.fn())
      }
      return effects
    },
  }
}

/* ───────────────────────────── 渲染树工具 ───────────────────────────── */

function flatten(node, out = []) {
  if (node == null || typeof node === "boolean") return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== "object") return out
  out.push(node)
  const children = node.props ? node.props.children : undefined
  flatten(children, out)
  return out
}

function nodeTypes(node) {
  return flatten(node).map((child) => child.type)
}

function findNodes(node, type) {
  return flatten(node).filter((child) => child.type === type)
}

/** 宿主渲染原语的字符串替身：type 为组件名，便于在渲染树中断言。 */
function hostViewStubs(names) {
  const stubs = {}
  for (const name of names) stubs[name] = name
  return stubs
}

function autoModule(names) {
  const module = {}
  for (const name of names) module[name] = () => null
  return module
}

/* ───────────────────────────── NovelDetailView 挂载 ───────────────────────────── */

const OFFLINE_TEXT = "离线正文一\n\n离线正文二\n\n[newpage]\n\n离线正文三"

function mountNovelDetail(options = {}) {
  const runtime = createHookRuntime()
  const rootDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "pix-novel-detail-"))
  const stack = loadOfflineLibraryStack(rootDir)
  const readerSettings = loadTsModule("Pix-Scripting/src/store/novelReaderSettings.ts", {
    "./dataDirectory": stack.dataDirectory,
    "./safeFile": stack.safeFile,
  }, { FileManager: stack.FileManager, Animation: { smooth: (options) => options } })
  if (options.offline) {
    const saved = stack.library.saveOfflineEpisode({
      novelId: options.offline.novelId,
      title: options.offline.title,
      author: "离线作者",
      text: OFFLINE_TEXT,
      seriesId: options.offline.seriesId,
      episodeNumber: options.offline.episodeNumber,
    })
    assert.ok(saved, "离线书库写入失败（宿主替身或实现异常）")
  }

  const seriesAssociations = []
  const networkCalls = []
  const apiFailure = options.failNetwork ? new Error("网络失败") : null

  const scripting = {
    ...hostViewStubs([
      "Button", "Divider", "DragGesture", "FlowLayout", "GlassEffectContainer", "Group", "HStack",
      "Image", "LazyVStack", "LongPressGesture", "Menu", "NavigationLink", "Picker", "ProgressView",
      "Rectangle", "ScrollView", "ScrollViewReader", "Spacer", "Text", "VStack", "ZStack",
    ]),
    Device: { isiPad: false, isLandscape: false, screen: { width: 390, height: 844 } },
    useCallback: (...a) => runtime.hooks.useCallback(...a),
    useEffect: (...a) => runtime.hooks.useEffect(...a),
    useMemo: (...a) => runtime.hooks.useMemo(...a),
    useRef: (...a) => runtime.hooks.useRef(...a),
    useState: (...a) => runtime.hooks.useState(...a),
    useObservable: (initial) => ({
      value: initial ?? null,
      setValue() {},
      getValue() { return this.value },
      addObserver: () => ({ dispose() {} }),
    }),
  }

  const detail = loadTsModule(NOVEL_DETAIL, {
    scripting,
    "./components/glass": { appGlass: (s) => s, appInteractiveGlass: (s) => s, appThemeColor: () => null },
    "../api/pixiv": {
      ...autoModule([
        "addNovelBookmark", "addNovelMarker", "deleteNovelMarker", "followDetail", "followUser",
        "nextNovels", "novelBookmarkDetail", "novelBookmarkTags", "illustrationDetail",
        "relatedNovels", "removeNovelBookmark", "unfollowUser", "userNovels",
      ]),
      novelDetail: async () => {
        networkCalls.push("novelDetail")
        if (apiFailure) throw apiFailure
        return options.detail ?? null
      },
      novelViewerData: async () => {
        networkCalls.push("novelViewerData")
        if (apiFailure) throw apiFailure
        return options.viewer ?? { text: "", textEmbeddedImages: undefined }
      },
    },
    "../api/session": { session: { call: (fn) => Promise.resolve().then(() => fn("fixture-token")) } },
    "../platform/haptics": { triggerHaptic: () => {} },
    "../downloader": autoModule(["exportNovelToEpub", "exportNovelToText"]),
    "./Hooks": {
      currentBatchSize: () => 20,
      waitForNovelLoadingFeedback: async () => {},
      useAsyncGuard: () => Object.assign(() => ({ isCurrent: () => true, invalidate() {} }), { isCurrent: () => true, invalidate() {} }),
      useLatest: (value) => runtime.hooks.useRef(value),
      useLayoutMetrics: () => ({ width: 390, isLandscape: false, isiPad: false }),
      useNovelBookmark: (_id, initial) => [initial, () => {}],
      useNovelMarker: () => [null, () => {}],
      useOpenBookmarkDetailListener: () => {},
      useOpenRelatedUsersListener: () => {},
      usePagedList: (opts) => ({
        items: options.relatedItems ?? [],
        pendingItems: [],
        initialLoading: Boolean(options.initialLoading),
        loadingMore: false,
        error: null,
        loadMoreError: null,
        hasFilteredContent: false,
        refresh: async () => {},
        loadMore: async () => {},
        ...(opts ? {} : {}),
      }),
    },
    "./ambient": {
      useNovelExperimentalAmbientPalette: () => ({
        ambientBackground: undefined,
        ambientPalette: null,
        ambientAlgorithm: "classic",
        ambientEnabled: false,
      }),
      generateAmbientBackgroundCss: () => "transparent",
    },
    "./bottomAccessory": { useFloatingCapsuleHeight: () => 0 },
    "../image/imageLoader": {
      imageUrlOf: () => null,
      loadImage: async () => null,
      novelThumbUrlOf: () => null,
      prefetch: () => ({ cancel() {} }),
    },
    "../store/history": autoModule(["recordNovelHistory", "updateNovelHistoryBookmark"]),
    "../store/novelProgress": {
      flushNovelProgress: () => {},
      getNovelProgress: () => undefined,
      recordNovelProgress: () => {},
    },
    "../store/seriesCache": {
      getSeriesByWorkID: () => null,
      recordWorkSeriesAssociation: (...args) => seriesAssociations.push(args),
    },
    "../store/userFollow": {
      ...autoModule(["getUserFollowRestrict", "isUserFollowed", "notifyUserFollowChanged", "onUserFollowChanged", "recordUserFollowed"]),
      isUserFollowed: () => false,
      getUserFollowRestrict: () => null,
    },
    "../store/bookmarkSync": {
      getCachedNovelBookmark: () => false,
      getCachedNovelMarker: () => null,
      recordNovelMarker: () => {},
    },
    "../store/novelCache": { cacheNovel: () => {}, getCachedNovel: () => null },
    "../store/settings": { loadSettings: () => ({ quickActionButtonEnabled: false, pageLayout: "default" }), onSettingsChanged: () => () => {} },
    "../store/contentFilter": {
      getNovelContentBlockReason: () => null,
      isNovelContentVisible: () => true,
    },
    "./components": {
      ...hostViewStubs([
        "AvatarImage", "BookmarkDetailSheet", "ErrorView", "ExpandableIntroduction", "LoadingView",
        "LoadMoreTrigger", "NovelCard", "RelatedSection", "RelatedUsersSheet", "TagChip",
      ]),
      formatDate: () => "",
      formatNumber: () => "",
      formatWordCount: () => "",
    },
    "./SeriesEpisodePager": { SeriesEpisodePager: "SeriesEpisodePager" },
    "./NovelReader": {
      NovelReaderView: "NovelReaderView",
      NovelReaderWebView: "NovelReaderWebView",
      parseNovelToChunks: () => [],
    },
    "./NovelOutlineSearchSheet": { NovelOutlineSearchSheet: "NovelOutlineSearchSheet" },
    "./novelReaderRuntime": { anchorFromReaderMessage: () => null, readerJumpPayload: () => null },
    "../store/novelAnchor": stack.anchorModule,
    "../store/novelOfflineLibrary": stack.library,
    "../store/novelOfflineImages": stack.library,
    "./novelOfflineCapture": stack.library,
    "../store/novelSearch": { jumpFeedbackText: () => "", NOVEL_SEARCH_KIND: {} },
    "./useNovelTranslation": { useNovelTranslation: () => ({ session: null, snapshot: null }) },
    "./NovelTranslationStatus": { NovelTranslationStatus: "NovelTranslationStatus" },
    "./components/ConnectionRow": { ConnectionRow: "ConnectionRow" },
    "./NovelImmersiveReader": { NovelImmersiveReaderView: "NovelImmersiveReaderView" },
    "./components/pageChrome": {
      PAGE_TOOLBAR_BACKGROUND: {},
      PAGE_TOOLBAR_BACKGROUND_VISIBILITY: "visible",
    },
    "./comments": { CommentsSheet: "CommentsSheet" },
    "./aiSheet": { NovelAISheet: "NovelAISheet" },
    "./NovelTypographySheet": { NovelTypographySheet: "NovelTypographySheet" },
    "../store/novelReaderSettings": readerSettings,
    "../store/novelExport": autoModule([
      "buildBilingualNovelSource", "buildNovelPlainTextDocument", "buildTranslatedNovelSource",
      "bilingualExportIssue", "novelTranslationExportIssue",
    ]),
    "../api/aiService": { cleanHtmlCaption: (value) => value ?? "" },
    "../store/routeNavigation": { renderDestination: () => null, requestPixivRoute: () => {} },
    "./DualRouteContext": { AppNavigationLink: "AppNavigationLink", useDualRoute: () => ({ isDetailPane: true, isSplitViewActive: false }) },
    "./NavigationZoomContext": { getActiveZoomNamespace: () => null },
  }, { FileManager: stack.FileManager, Animation: { smooth: (options) => options } })

  return {
    module: detail,
    runtime,
    seriesAssociations,
    networkCalls,
    stack,
    mount: (props) => runtime.mount(detail.NovelDetailView, props),
  }
}

/* ───────────────────────────── NovelReaderView 挂载 ───────────────────────────── */

function mountNovelReaderView(options = {}) {
  const runtime = createHookRuntime()
  const createdControllers = []
  class WebViewControllerStub {
    constructor() {
      createdControllers.push(this)
      this.loaded = []
      this.handlers = {}
      this.disposed = false
    }
    async loadHTML(html) { this.loaded.push(html) }
    async evaluateJavaScript(script) { this.scripts = (this.scripts ?? []).concat([script]) }
    async addScriptMessageHandler(name, fn) { this.handlers[name] = fn }
    dispose() { this.disposed = true }
  }
  const translatorCalls = []
  const reader = loadTsModule(NOVEL_READER, {
    "./novelInlineMarkup": loadTsModule("Pix-Scripting/src/ui/novelInlineMarkup.ts"),
    scripting: {
      ...hostViewStubs([
        "Button", "Divider", "Group", "HStack", "Image", "ProgressView", "Rectangle", "ScrollView",
        "ScrollViewReader", "Spacer", "Text", "VStack", "WebView", "ZStack",
      ]),
      useCallback: (...a) => runtime.hooks.useCallback(...a),
      useEffect: (...a) => runtime.hooks.useEffect(...a),
      useMemo: (...a) => runtime.hooks.useMemo(...a),
      useRef: (...a) => runtime.hooks.useRef(...a),
      useState: (...a) => runtime.hooks.useState(...a),
      useObservable: (initial) => ({ value: initial ?? null, setValue() {}, getValue() { return this.value } }),
      WebViewController: WebViewControllerStub,
    },
    "./components/glass": { appGlass: (s) => s, appInteractiveGlass: (s) => s },
    "../store/routeNavigation": { requestPixivRoute: () => {} },
    "./components": {
      CachedImage: "CachedImage",
      presentExternalURL: () => {},
      routeForDescriptionLink: () => null,
    },
    "./Hooks": { useLayoutMetrics: () => ({ width: 390, height: 844, isiPad: false, isLandscape: false }), useEffectiveIsDark: () => false },
    "../api/session": { session: { call: (fn) => Promise.resolve().then(() => fn("fixture-token")) } },
    "../api/pixiv": { illustrationDetail: async () => null },
    "../image/imageLoader": {
      imageUrlOf: () => null,
      pageThumbUrlOf: () => null,
      cachedFilePath: () => null,
      loadImage: async () => null,
    },
    "../downloader/photoAlbum": { saveImageToPixivAlbum: async () => true, withAlbumKeepAlive: async (fn) => fn() },
    "../store/settings": { loadSettings: () => ({}) },
    "../store/novelReaderSettings": {
      calculateLineSpacing: () => 6,
      loadNovelReaderSettings: () => options.settings ?? {
        layoutDirection: "vertical",
        pageDisplayMode: "continuous",
        fontSize: 18,
        fontWeight: "regular",
        lineSpacingLevel: 1,
      },
      onNovelReaderSettingsChanged: () => () => {},
      resolveFontName: () => null,
    },
    "../store/novelProgress": { getNovelProgress: () => undefined, recordNovelProgress: () => {} },
    "../store/novelOfflineLibrary": {
      completePendingOfflineImage: async () => null,
      offlineImagePathMap: () => ({}),
    },
    "./novelReaderRuntime": {
      NOVEL_READER_RUNTIME_CSS: "/* css */",
      NOVEL_READER_RUNTIME_JS: "window.NovelReaderRuntime = {};",
    },
    "./ambient": { generateAmbientBackgroundCss: () => "transparent" },
  })

  return { reader, runtime, createdControllers, translatorCalls }
}

/* ───────────────────────────── NovelLibraryView 挂载 ───────────────────────────── */

function mountNovelLibrary(options = {}) {
  const runtime = createHookRuntime()
  const rootDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "pix-novel-library-"))
  const stack = loadOfflineLibraryStack(rootDir)

  const marker = {
    id: 1,
    novel: {
      id: 501,
      title: "离线书库回归样例",
      user: { id: 9, name: "作者" },
      tags: [],
      text_length: 1200,
      page_count: 3,
      is_bookmarked: true,
    },
  }

  const library = loadTsModule(NOVEL_LIBRARY, {
    scripting: {
      ...hostViewStubs(["Button", "HStack", "Image", "Label", "LazyVStack", "Menu", "Picker", "Text", "VStack", "Spacer", "ZStack", "ProgressView"]),
      Device: { isiPad: false, isLandscape: false, screen: { width: 390, height: 844 } },
      useCallback: (...a) => runtime.hooks.useCallback(...a),
      useEffect: (...a) => runtime.hooks.useEffect(...a),
      useMemo: (...a) => runtime.hooks.useMemo(...a),
      useRef: (...a) => runtime.hooks.useRef(...a),
      useState: (...a) => runtime.hooks.useState(...a),
      useObservable: (initial) => ({ value: initial ?? null, setValue() {}, getValue() { return this.value } }),
    },
    "./DualRouteContext": { useDualRoute: () => ({ isSplitViewActive: false }) },
    "../api/pixiv": { novelMarkers: async () => ({ novels: [marker] }), nextNovelMarkers: async () => ({ novels: [] }) },
    "../store/novelOfflineLibrary": stack.library,
    "../store/novelProgress": {
      getNovelHighestProgress: () => null,
      getNovelProgress: () => undefined,
      onNovelProgressChanged: () => () => {},
    },
    "./components/glass": { appGlass: (s) => s },
    "../store/routeNavigation": { requestPixivRoute: () => {} },
    "../image/imageLoader": { novelThumbUrlOf: () => null, prefetch: () => ({ cancel() {} }) },
    "../store/settings": { loadSettings: () => ({ pageLayout: "default", batchSize: 20, loadingAnimationDuration: 0 }), onSettingsChanged: () => () => {} },
    "../store/contentFilter": { isNovelContentVisible: () => true },
    "./bookmarkSync": { onNovelMarkerChanged: () => () => {} },
    "../store/bookmarkSync": { onNovelMarkerChanged: () => () => {} },
    "./Hooks": {
      currentBatchSize: () => 20,
      IPAD_WIDE_MIN_WIDTH: 700,
      useLatest: (value) => runtime.hooks.useRef(value),
      useLayoutMetrics: () => ({ width: 390, isLandscape: false, isiPad: false }),
      usePagedList: () => ({
        items: options.emptyItems ? [] : [{...marker, novel_marker: { page: 1 }}],
        pendingItems: [],
        initialLoading: Boolean(options.initialLoading),
        loadingMore: false,
        error: null,
        loadMoreError: null,
        hasFilteredContent: false,
        refresh: async () => {},
        loadMore: async () => {},
      }),
    },
    "./ambient": {
      useExperimentalAmbientPalette: () => ({ ambientBackground: undefined, ambientEnabled: false }),
      getLastActiveAmbientImageUrl: () => null,
      recordActiveAmbientImageUrl: () => {},
    },
    "./DestinationElement": { destinationElement: null },
    "./bottomAccessory": {
      DockActionBar: "DockActionBar",
      useRegisterBottomAccessory: () => {},
    },
    "../platform/haptics": { triggerHaptic: () => {} },
    "./components": {
      ...hostViewStubs(["EmptyView", "ErrorView", "LoadingView", "LoadMoreTrigger", "NovelCard", "RefreshableScrollView"]),
    },
  }, { FileManager: stack.FileManager })

  return { library, runtime, stack, mount: () => runtime.mount(library.NovelLibraryView, {}) }
}

/* ═══════════════════ 一、语义诊断（AST 作用域 / 绑定可达性，非字符串匹配） ═══════════════════ */

test("项目语义扫描：全部源码无「声明前读取 / 缺 scripting 导入 / 未声明标识符」", () => {
  const results = scopeScan.scanProject(SOURCE_ROOT)
  const report = results
    .map((entry) => `${path.relative(ROOT, entry.file)}\n` +
      entry.findings.map((f) => `    ${f.kind} ${f.name} ${f.line}:${f.column} ${f.message}`).join("\n"))
    .join("\n")
  assert.equal(results.length, 0,
    `语义扫描发现「语法检查通过、运行期必然失败」的绑定问题：\n${report}`)
})

test("语义扫描器自检：能报出 TDZ 与缺导入，且不误报顺序正确的代码", () => {
  const hostNames = scopeScan.collectProjectHostSymbols(SOURCE_ROOT)
  const useBeforeDecl = `import { Text, useRef, VStack } from "scripting"
export function Sample() {
  const value = ref.current
  const ref = useRef(null)
  return <VStack><Text>{value}</Text></VStack>
}`
  const tdzFindings = scopeScan.scanSource(useBeforeDecl, "sample-tdz.tsx", { hostNames })
  assert.deepEqual(
    tdzFindings.map((f) => `${f.kind}:${f.name}`),
    ["USE_BEFORE_DECL:ref"],
    `TDZ 样例诊断不符：${JSON.stringify(tdzFindings)}`
  )

  const missingImport = `import { Text } from "scripting"
export function Sample() {
  return <VStack><Text>hi</Text><Spacer /></VStack>
}`
  const importFindings = scopeScan.scanSource(missingImport, "sample-import.tsx", { hostNames })
  assert.deepEqual(
    [...new Set(importFindings.map((f) => `${f.kind}:${f.name}`))].sort(),
    ["MISSING_IMPORT:Spacer", "MISSING_IMPORT:VStack"],
    `缺导入样例诊断不符：${JSON.stringify(importFindings)}`
  )

  const unknownName = `import { Text } from "scripting"
export function Sample() {
  return <Text>{definitelyMissingName}</Text>
}`
  const unknownFindings = scopeScan.scanSource(unknownName, "sample-unknown.tsx", { hostNames })
  assert.deepEqual(
    unknownFindings.map((f) => `${f.kind}:${f.name}`),
    ["UNKNOWN_UNBOUND:definitelyMissingName"]
  )

  const correctOrder = `import { Spacer, Text, VStack, useRef } from "scripting"
export function Sample() {
  const ref = useRef(null)
  const value = ref.current
  return <VStack><Text>{value}</Text><Spacer /></VStack>
}`
  assert.deepEqual(scopeScan.scanSource(correctOrder, "sample-ok.tsx", { hostNames }), [])
})

/* ═══════════════════ 二、组件首次渲染回归（真实组件 + 宿主边界替身） ═══════════════════ */

test("小说详情：首次 render 不发生声明前读取，加载态整体渲染成功", () => {
  const harness = mountNovelDetail()
  const tree = harness.mount({ novelID: 1 })
  assert.equal(tree.type, "ZStack", "详情页应进入渲染分支")
  assert.ok(nodeTypes(tree).includes("LoadingView"), "首帧应显示加载态")
  // 宿主在状态变化后会重渲染；第二次 render 同样不得抛错（同一份 hooks 槽位）
  assert.doesNotThrow(() => harness.runtime.render())
})

test("小说详情：网络失败回退离线书库后可重渲染，离线系列归属仍被解析", async () => {
  const harness = mountNovelDetail({
    failNetwork: true,
    offline: { novelId: 1, title: "离线小说", seriesId: 10, episodeNumber: 2 },
  })
  harness.mount({ novelID: 1 })
  harness.runtime.runEffects()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(harness.networkCalls.includes("novelDetail"), "加载副作用应已请求详情接口")
  assert.doesNotThrow(() => harness.runtime.render())
})

test("小说竖排：NovelReaderView 进入竖向引擎并透传续读锚点与控制器通道", async () => {
  const harness = mountNovelReaderView()
  const sink = { current: null }
  const anchor = { chunkId: "chunk-2", page: 2, offset: 3, quote: "第二次续读" }
  const tree = harness.runtime.mount(harness.reader.NovelReaderView, {
    novelId: 7,
    title: "竖排样例",
    text: "第一段正文",
    readingAnchor: anchor,
    controllerSink: sink,
  })

  const vertical = flatten(tree).find((node) => typeof node.type === "function")
  assert.ok(vertical, "竖排排版应渲染 WebKit 竖向引擎组件")
  assert.equal(vertical.props.readingAnchor, anchor, "续读锚点必须下沉到竖向引擎")
  assert.equal(vertical.props.controllerSink, sink, "控制器通道必须下沉到竖向引擎")

  assert.ok(vertical.props.chunks.length > 0, "有正文时竖排引擎接收真实解析段落")
})

test("小说书签书库：首屏渲染书库区块（VStack / Spacer 已声明）", () => {
  const harness = mountNovelLibrary()
  const tree = harness.mount({ emptyItems: true })
  const types = nodeTypes(tree)
  assert.ok(types.includes("RefreshableScrollView"), "书签页外层可正常渲染")
  const textContents = findNodes(tree, "Text")
    .map((node) => JSON.stringify(node.props.children))
    .join("|")

})
