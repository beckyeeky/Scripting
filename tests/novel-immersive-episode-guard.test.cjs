const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

const READER_FILE = "Pix-Scripting/src/ui/NovelImmersiveReader.tsx"
const NOVEL_READER_FILE = "Pix-Scripting/src/ui/NovelReader.tsx"

// 复用真实正文解析实现（分块、分页、Ruby 转换、译文补丁脚本）
const readerSource = fs.readFileSync(NOVEL_READER_FILE, "utf8")
const readerJs = ts.transpileModule(
  readerSource.slice(readerSource.indexOf("export function escapeHtml"), readerSource.indexOf("function getLocalImageDataUrl")),
  { fileName: NOVEL_READER_FILE, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText
const readerModule = { exports: {} }
vm.runInNewContext(readerJs, {
  module: readerModule,
  exports: readerModule.exports,
  console: { log() {}, warn() {} },
  setTimeout: () => 0,
  clearTimeout() {},
  require() { throw new Error("NovelReader 切片不应依赖额外模块") },
}, { filename: NOVEL_READER_FILE })
const readerExports = readerModule.exports

// 复用真实锚点与阅读器运行时实现：续读锚点、跳转协议与目录/检索面板都必须是真实代码
function loadTsModule(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(file, "utf8")
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    console: { log() {}, warn() {} },
    JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: file })
  return module.exports
}

const anchorExports = loadTsModule("Pix-Scripting/src/store/novelAnchor.ts")
const runtimeExports = loadTsModule("Pix-Scripting/src/ui/novelReaderRuntime.ts", {
  "../store/novelAnchor": anchorExports,
})

// 真实离线书库实现（FileManager 为宿主替身：本测试环境没有任何离线内容）
const offlineFileManagerStub = {
  documentsDirectory: "/tmp/pix-novel-offline-guard",
  iCloudDocumentsDirectory: "/tmp/pix-novel-offline-guard-icloud",
  appGroupDocumentsDirectory: "/tmp/pix-novel-offline-guard-group",
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
const offlineSafeFile = loadTsModule("Pix-Scripting/src/store/safeFile.ts", {}, {
  FileManager: offlineFileManagerStub,
})
const offlineDataDirectory = loadTsModule(
  "Pix-Scripting/src/store/dataDirectory.ts",
  { "../api/session": { session: { userID: 1001 } }, "./safeFile": offlineSafeFile },
  { FileManager: offlineFileManagerStub }
)
const offlineLibraryExports = loadTsModule(
  "Pix-Scripting/src/store/novelOfflineLibrary.ts",
  {
    "./dataDirectory": offlineDataDirectory,
    "./safeFile": offlineSafeFile,
    "./novelAnchor": anchorExports,
  },
  { FileManager: offlineFileManagerStub }
)

/* ------------------------------------------------------------------ *
 * 极简 hooks 运行时：支持重渲染与依赖变更后的副作用重跑，
 * 用于验证「沉浸阅读器内部换章」这一真实交互路径。
 * ------------------------------------------------------------------ */
function createHookRuntime() {
  const slots = []
  let cursor = 0
  let props = null
  let component = null
  let queued = false

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

  function schedule() {
    if (queued) return
    queued = true
    Promise.resolve().then(() => {
      queued = false
      renderNow()
    })
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
      if (!slots[index]) {
        slots[index] = { deps, fn, pending: true }
      } else if (!sameDeps(slots[index].deps, deps)) {
        slots[index].deps = deps
        slots[index].fn = fn
        slots[index].pending = true
      }
    },
  }

  return {
    hooks,
    mount(componentFn, initialProps) {
      component = componentFn
      props = initialProps
      return renderNow()
    },
    render: () => renderNow(),
    async settle(rounds = 6) {
      for (let i = 0; i < rounds; i++) await Promise.resolve()
    },
  }
}

function createHarness() {
  const handlers = {}
  const loaded = []
  const closes = []
  const jumpCalls = []
  const progressCalls = []
  const markerCalls = []
  const addedMarkers = []
  const deletedMarkers = []
  const holder = {}
  const controller = {
    loadHTML: async (html) => { loaded.push(html) },
    evaluateJavaScript: async () => {},
    addScriptMessageHandler: async (name, fn) => { handlers[name] = fn },
    dispose() {},
  }

  const readerSource = fs.readFileSync(READER_FILE, "utf8")
  const sliced = readerSource.slice(readerSource.indexOf("function isVirtualNode"))
  const js = ts.transpileModule(sliced, {
    fileName: READER_FILE,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText

  const globals = {
    ...readerExports,
    ...anchorExports,
    ...runtimeExports,
    ...offlineLibraryExports,
    console: { log() {}, warn() {} },
    setTimeout: (fn) => { return 0 },
    clearTimeout() {},
    useState: (...args) => holder.hooks.useState(...args),
    useRef: (...args) => holder.hooks.useRef(...args),
    useMemo: (...args) => holder.hooks.useMemo(...args),
    useCallback: (...args) => holder.hooks.useCallback(...args),
    useEffect: (...args) => holder.hooks.useEffect(...args),
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    FileManager: { existsSync: () => false, readAsDataSync: () => null },
    // 宿主与数据边界替身
    WebViewController: function () { return controller },
    Device: { screen: { height: 800 } },
    session: { call: (fn) => fn("fixture-token") },
    novelDetail: async (id) => ({ id, title: `新题${id}`, caption: "新简介" }),
    novelViewerData: async () => ({ text: "新正文一\n[newpage]\n新正文二\n[newpage]\n新正文三" }),
    illustrationDetail: async () => undefined,
    getCachedNovel: () => null,
    cacheNovel() {},
    recordNovelHistory() {},
    getNovelProgress: (id) => (id === 2 ? { page: 2, chunkId: "saved-chunk" } : undefined),
    recordNovelProgress: (...args) => progressCalls.push(args),
    getCachedNovelMarker: (id) => (id === 2 ? 3 : null),
    recordNovelMarker: (...args) => markerCalls.push(args),
    addNovelMarker: async (...args) => { addedMarkers.push(args) },
    deleteNovelMarker: async (...args) => { deletedMarkers.push(args) },
    cleanHtmlCaption: (value) => value || "",
    loadImage: async () => null,
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
      hasPrev: true, prevID: 1, hasNext: true, nextID: 3, loading: false,
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

  const module = { exports: {} }
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require(id) { throw new Error(`未提供替身的导入：${id}`) },
    ...globals,
  }, { filename: READER_FILE })
  holder.module = module.exports

  const props = {
    novelId: 1,
    title: "原题",
    caption: "简介",
    text: "正文一\n[newpage]\n正文二\n[newpage]\n[chapter:章]\n正文三",
    markerPage: 1,
    currentPage: 1,
    seriesID: 10,
    seriesTitle: "系列",
    seriesPrev: { id: 1 },
    seriesNext: { id: 3 },
    episodeNumber: 1,
    onClose: (...args) => closes.push(args),
    onToggleMarker: () => { markerCalls.push(["legacy"]) },
    onToggleMarkerAtPage: (...args) => { markerCalls.push(["parent", ...args]) },
    onJumpToPage: (...args) => jumpCalls.push(args),
  }

  const runtime = createHookRuntime()
  holder.hooks = runtime.hooks
  const tree = runtime.mount(module.exports.NovelImmersiveReaderView, props)
  return { runtime, tree, handlers, loaded, closes, jumpCalls, progressCalls, markerCalls, addedMarkers, deletedMarkers }
}

/* ---------------------------- 树遍历工具 ---------------------------- */
function walkValues(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (!value || typeof value !== "object") return
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") walk(nested, visit)
  }
}
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  if (!node || typeof node !== "object") return
  if (typeof node.type !== "undefined" && node.props) {
    visit(node)
    walkValues(node.props, visit)
  } else {
    // 普通配置对象（如 toolbar / sheet），只继续向下遍历，本身不是节点
    walkValues(node, visit)
  }
}
function findNode(tree, predicate) {
  let found = null
  walk(tree, (node) => { if (!found && predicate(node)) found = node })
  return found
}
function collectStrings(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out)
  } else if (typeof node === "string") {
    out.push(node)
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStrings(value, out)
  }
  return out
}
function hasDescendantImage(node, pattern) {
  let found = false
  walk(node, (child) => {
    if (child.type === "Image" && typeof child.props?.systemName === "string" &&
      new RegExp(pattern.source, pattern.flags.replace("g", "")).test(child.props.systemName)) {
      found = true
    }
  })
  return found
}
function generationOf(html) {
  const match = html.match(/var novelOwnerId = (\d+);/)
  return match ? Number(match[1]) : null
}

test("沉浸阅读器文档携带代际标识，且内嵌脚本全部可解析", async () => {
  const harness = createHarness()
  await harness.runtime.settle()
  assert.equal(harness.loaded.length, 1)
  const html = harness.loaded[0]
  assert.match(html, /var novelOwnerId = 1;/)
  assert.match(html, /window\.__novelOwnerId = novelOwnerId;/)
  assert.match(html, /body\.owner = novelOwnerId;/)
  assert.match(html, /postNovelMessage\("onProgressChange"/)
  assert.equal(generationOf(html), 1)
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1])
})

test("内部换章后，旧文档的迟到进度不会写到新作品", async () => {
  const harness = createHarness()
  await harness.runtime.settle()
  assert.equal(generationOf(harness.loaded[0]), 1)

  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: 1 })
  await harness.runtime.settle()
  assert.equal(harness.loaded.length, 2, "换章必须重新载入正文文档")
  const newGeneration = generationOf(harness.loaded[1])
  assert.ok(newGeneration > 1, "换章后文档代际必须递增")
  assert.match(harness.loaded[1], /新正文一/)

  // 旧文档（旧代际）迟到的滚动进度：必须整体丢弃
  harness.handlers.onProgressChange({ owner: 1, page: 9, chunkId: "old-chunk" })
  assert.equal(harness.progressCalls.length, 0, "旧文档进度不得写入任何作品")

  // 当前文档的进度：写到当前作品（2），而不是原作品（1）
  harness.handlers.onProgressChange({
    owner: newGeneration, page: 3, chunkId: "new-chunk", offset: 4, quote: "新正文二",
  })
  assert.equal(harness.progressCalls.length, 1, "只有当前文档的进度写入当前作品")
  const call = harness.progressCalls[0]
  assert.deepEqual(call.slice(0, 3), [2, 3, "new-chunk"], "进度必须归属换章后的新作品")
  // 新增锚点：正文版本 + 段内偏移 + 文本锚点，供正文/排版变化后安全恢复
  assert.equal(typeof call[4]?.contentVersion, "string")
  assert.equal(call[4].offset, 0)
  assert.equal(typeof call[4].quote, "string")
})

test("换章后跳页与书签归属新作品，绝不回写原作品", async () => {
  const harness = createHarness()
  await harness.runtime.settle()

  // 1) 原作品内的跳页仍然走父级回调，保持普通阅读器兼容
  const picker = findNode(harness.tree, (node) => node.type === "Picker")
  assert.ok(picker, "多页小说必须渲染页码选择器")
  picker.props.onChanged(2)
  assert.deepEqual(harness.jumpCalls, [[2]], "原作品跳页仍走父级回调，保持兼容")

  // 2) 内部换章到第 2 话
  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: generationOf(harness.loaded[0]) })
  await harness.runtime.settle()

  // 3) 书签页显示当前作品自己的书签（缓存第 3 页），不沿用原作品第 1 页
  let tree = harness.runtime.render()
  const texts = collectStrings(tree)
  assert.ok(texts.some((text) => text.includes("第 3 页（书签）")), "书签页码必须来自当前作品")
  assert.ok(!texts.some((text) => text.includes("第 1 页（书签）")), "不得沿用原作品书签页码")

  // 4) 换章后打书签：写到新作品，且沿用新作品原有书签状态
  let markerButton = findNode(tree, (node) =>
    typeof node.props?.onTapGesture === "function" && hasDescendantImage(node, /^book\.pages/))
  assert.ok(markerButton, "必须渲染书签按钮")
  markerButton.props.onTapGesture()
  await harness.runtime.settle()
  assert.deepEqual(
    Array.from(harness.addedMarkers, (call) => `${call[0]}|${call[1]}`),
    ["2|2"],
    "新作品书签写在新作品上（切章后当前第 2 页）"
  )

  // 5) 换章后跳页：记录到新作品，且不再回调原作品
  const pickerAfterSwitch = findNode(harness.runtime.render(), (node) => node.type === "Picker")
  assert.ok(pickerAfterSwitch)
  pickerAfterSwitch.props.onChanged(3)
  assert.deepEqual(harness.jumpCalls, [[2]], "换章后不得再把新作品页码回调给原作品")
  assert.deepEqual(
    Array.from(harness.progressCalls, (call) => `${call[0]}|${call[1]}|${call[2]}`),
    ["2|3|saved-chunk"],
    "换章后跳页必须记录到新作品"
  )

  // 6) 当前页正是新作品书签页时再次点击：删除该作品的既有书签
  markerButton = findNode(harness.runtime.render(), (node) =>
    typeof node.props?.onTapGesture === "function" && hasDescendantImage(node, /^book\.pages/))
  markerButton.props.onTapGesture()
  await harness.runtime.settle()
  assert.deepEqual(
    Array.from(harness.deletedMarkers, (call) => `${call[0]}`),
    ["2"],
    "删除的必须是新作品自己的书签"
  )
  assert.ok(
    !harness.addedMarkers.some((call) => call[0] === 1) &&
      !harness.deletedMarkers.some((call) => call[0] === 1),
    "任何书签请求都不得指向原作品"
  )
})

test("关闭沉浸阅读器时回传最终作品 ID 与页码，保持正确的关闭路由", async () => {
  const harness = createHarness()
  await harness.runtime.settle()
  harness.handlers.onSeriesNav({ action: "next", id: 2, owner: generationOf(harness.loaded[0]) })
  await harness.runtime.settle()
  harness.handlers.onProgressChange({ owner: generationOf(harness.loaded[1]), page: 3, chunkId: "final-chunk" })
  // 旧文档在切换后才迟到上报：必须被丢弃，不能覆盖当前作品的阅读位置
  harness.handlers.onProgressChange({ owner: generationOf(harness.loaded[0]), page: 9, chunkId: "old-chunk" })
  const closeButton = findNode(harness.runtime.render(), (node) =>
    node.type === "Button" && typeof node.props?.action === "function" &&
    hasDescendantImage(node, /^xmark$/))
  assert.ok(closeButton)
  closeButton.props.action()
  assert.equal(harness.closes.length, 1)
  assert.deepEqual(harness.closes[0].slice(0, 3), ["final-chunk", 3, 2],
    "关闭时必须回传最终作品与页码，不带旧文档进度")
  // 第四项为可选续读锚点（正文版本 + 偏移 + 文本锚点）：归属必须与 finalNovelId 一致，
  // 即原作品（1）的锚点绝不能被旧文档或跨篇状态覆盖
  assert.equal(harness.closes[0][3]?.novelId, 2, "续读锚点必须归属换章后的新作品")
  assert.equal(harness.closes[0][3]?.chunkId, "final-chunk")
  assert.equal(typeof harness.closes[0][3]?.contentVersion, "string")
})
