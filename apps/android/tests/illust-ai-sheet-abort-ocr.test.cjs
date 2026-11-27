const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("../node_modules/typescript")

const sheetPath = path.resolve(__dirname, "../src/app/features/media/IllustAISheet.tsx")
const ocrLayoutPath = path.resolve(__dirname, "../src/app/features/media/ocrLayout.ts")
const aiServicePath = path.resolve(__dirname, "../../../Pix-Scripting/src/api/aiService.ts")
const photoAlbumPath = path.resolve(__dirname, "../../../Pix-Scripting/src/downloader/photoAlbum.ts")
const hapticsPath = path.resolve(__dirname, "../../../Pix-Scripting/src/platform/haptics.ts")
const componentsPath = path.resolve(__dirname, "../src/app/components/index.ts")
const navPath = path.resolve(__dirname, "../src/app/navigation/NavContext.tsx")
const overlayPath = path.resolve(__dirname, "../src/app/overlay/OverlayHost.tsx")
const themePath = path.resolve(__dirname, "../src/app/theme/ThemeProvider.tsx")
const insetsPath = path.resolve(__dirname, "../src/app/theme/insets.ts")
const dataPath = path.resolve(__dirname, "../src/scripting/dataAndCrypto.ts")
const hostGlobalsPath = path.resolve(__dirname, "../src/scripting/hostGlobals.ts")
const polyfillsPath = path.resolve(__dirname, "../src/scripting/polyfills.ts")
const mediaHelpersPath = path.resolve(__dirname, "../src/app/features/media/mediaHelpers.ts")

// ---- 极简 React 运行时：函数组件 + useState/useEffect/useRef/useCallback/useMemo ----
function createMiniReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
    children: children.flat(),
  })

  let hooks = []
  let cursor = 0
  let pendingEffects = []

  function useState(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial
    const setState = (next) => {
      hooks[index] = typeof next === "function" ? next(hooks[index]) : next
    }
    return [hooks[index], setState]
  }

  function useRef(initial) {
    const index = cursor++
    if (!(index in hooks)) hooks[index] = { current: initial }
    return hooks[index]
  }

  function useEffect(effect, deps) {
    const index = cursor++
    const prev = hooks[index]
    const changed = !prev || !deps || deps.some((d, i) => d !== prev.deps[i])
    if (changed) {
      pendingEffects.push(() => {
        if (prev?.cleanup) prev.cleanup()
        hooks[index] = { deps, cleanup: effect() }
      })
    } else {
      pendingEffects.push(() => {})
    }
  }

  function useCallback(fn, deps) {
    const index = cursor++
    const prev = hooks[index]
    if (prev && deps && deps.every((d, i) => d === prev.deps[i])) return prev.fn
    hooks[index] = { deps, fn }
    return fn
  }

  return {
    React: {
      createElement,
      Component: class {},
      Fragment: "Fragment",
      useCallback,
      useEffect,
      useMemo: (fn) => fn(),
      useRef,
      useState,
    },
    beginRender() {
      cursor = 0
    },
    flushEffects() {
      const effects = pendingEffects
      pendingEffects = []
      for (const effect of effects) effect()
    },
    reset() {
      hooks = []
      cursor = 0
      pendingEffects = []
    },
  }
}

function loadTsModule(absPath, mocks = {}) {
  const source = fs.readFileSync(absPath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: absPath,
  }).outputText

  const mod = { exports: {} }
  const dir = path.dirname(absPath)

  function customRequire(specifier) {
    let base = null
    if (specifier.startsWith(".")) {
      const resolved = path.resolve(dir, specifier)
      for (const candidate of [
        resolved,
        `${resolved}.ts`,
        `${resolved}.tsx`,
        resolved + "/index.ts",
        resolved + "/index.tsx",
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          base = candidate
          break
        }
      }
    }
    if (base && Object.prototype.hasOwnProperty.call(mocks, base)) return mocks[base]
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) return mocks[specifier]
    if (base) return loadTsModule(base, mocks)
    return require(specifier)
  }

  const fn = new Function("exports", "require", "module", "__filename", "__dirname", compiled)
  fn(mod.exports, customRequire, mod, absPath, dir)
  return mod.exports
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, seen)
    return
  }
  if (seen.has(node)) return
  seen.add(node)
  visit(node)
  walk(node.children, visit, seen)
  if (node.props?.children && node.props.children !== node.children) {
    walk(node.props.children, visit, seen)
  }
}

function findButton(tree, title) {
  let found = null
  walk(tree, (node) => {
    if (node.type === "ActionButton" && node.props?.title === title) found = node
  })
  return found
}

function readSelectableTexts(tree) {
  const out = []
  walk(tree, (node) => {
    if (node.type === "Text" && node.props?.selectable) out.push(node.props.children)
  })
  return out
}

function findStage(tree) {
  let found = null
  walk(tree, (node) => {
    if (node.type === "View" && typeof node.props?.onLayout === "function") found = node
  })
  return found
}

function readBubbleRects(tree) {
  const rects = []
  walk(tree, (node) => {
    if (node.type !== "Pressable" || !Array.isArray(node.props?.style)) return
    const layout = node.props.style.find((entry) => entry && "left" in entry && "top" in entry)
    if (layout) rects.push(layout)
  })
  return rects
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// 与 scripting/polyfills.ts 的 PolyfillAbortSignal 行为一致的替身：
// 只记录是否真的通过 onAbort/addEventListener 分发中止。
function createAbortHarness() {
  const controllers = []
  class MockSignal {
    constructor() {
      this.aborted = false
      this.listeners = new Set()
      this.abortEvents = 0
      this.reason = undefined
    }
    onAbort(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
    addEventListener(type, listener) {
      if (type === "abort") this.listeners.add(listener)
    }
    removeEventListener(type, listener) {
      if (type === "abort") this.listeners.delete(listener)
    }
  }
  class MockAbortController {
    constructor() {
      this.signal = new MockSignal()
      controllers.push(this)
    }
    abort(reason) {
      if (this.signal.aborted) return
      this.signal.aborted = true
      this.signal.reason = reason
      this.signal.abortEvents += 1
      for (const listener of Array.from(this.signal.listeners)) listener()
      this.signal.listeners.clear()
    }
  }
  return { controllers, MockAbortController }
}

function createAiService(overrides = {}) {
  return {
    cleanHtmlCaption: () => "测试简介",
    cleanOCRDisplayMarkdown: (text) => text,
    isAIAvailable: () => true,
    streamTranslateText: async () => "",
    streamVisionTranslateImage: async () => "",
    streamGenerateTranslatedImage: async () => {},
    ...overrides,
  }
}

function loadSheet(mini, aiService, abortModule) {
  const ActionButton = "ActionButton"
  const SegmentedControl = "SegmentedControl"

  return loadTsModule(sheetPath, {
    react: { ...mini.React, __esModule: true, default: mini.React },
    "react-native": {
      __esModule: true,
      ActivityIndicator: "ActivityIndicator",
      Image: "Image",
      NativeModules: { PixImageMedia: {} },
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      StyleSheet: {
        create: (styles) => styles,
        absoluteFill: {},
        hairlineWidth: 1,
      },
      Text: "Text",
      View: "View",
    },
    [aiServicePath]: aiService,
    [photoAlbumPath]: { saveImageToPixivAlbum: async () => true },
    [hapticsPath]: { triggerHaptic: () => {} },
    [componentsPath]: { ActionButton, SegmentedControl },
    [navPath]: { useAppNav: () => ({ push: () => {} }) },
    [overlayPath]: { useOverlay: () => ({ showToast: () => {} }) },
    [themePath]: { useAppTheme: () => ({ colors: {}, accent: "#000000", accentSoft: "#eeeeee" }) },
    [insetsPath]: { useSafeInsets: () => ({}), effectiveBottomInset: () => 0 },
    [dataPath]: { ScriptingData: { fromBase64String: () => null } },
    [hostGlobalsPath]: {
      ScriptingFileManager: { temporaryDirectory: "" },
      ScriptingImageRenderer: { toJPEGData: async () => null },
    },
    [polyfillsPath]: { PolyfillAbortController: abortModule.MockAbortController },
    [mediaHelpersPath]: {
      copyToClipboard: async () => {},
      getIllustPageCount: () => 1,
      shareItems: async () => {},
      toFileUri: (p) => `file://${p}`,
    },
  })
}

function makeIllust(width, height) {
  return {
    id: 42,
    title: "测试插画",
    caption: "<p>简介</p>",
    width,
    height,
    pageCount: 1,
  }
}

test("插画 OCR：停止通过 PolyfillAbortController 中断信号，迟到回调不覆写状态", async () => {
  const mini = createMiniReact()
  const abortModule = createAbortHarness()
  const gates = []
  const calls = []
  let callIndex = 0

  const aiService = createAiService({
    streamVisionTranslateImage: async (_illust, _pageIndex, options) => {
      callIndex += 1
      const current = callIndex
      calls.push({ current, options })
      options.onChunk(current === 1 ? "第一段" : "第二段")
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      gates.push(release)
      await gate
      return current === 1 ? "第一次完整返回" : "第二次完整返回"
    },
  })

  const mod = loadSheet(mini, aiService, abortModule)
  const renderSheet = () => {
    mini.beginRender()
    const tree = mod.IllustAISheet({
      illust: makeIllust(800, 4000),
      initialMode: "ocr",
      initialPage: 0,
      onClose: () => {},
    })
    mini.flushEffects()
    return tree
  }

  let tree = renderSheet()
  findButton(tree, "开始识别与气泡翻译").props.onPress()
  await tick()

  const first = calls[0]
  assert.ok(first, "应发起第一次 OCR 请求")
  // 普通对象没有 onAbort，fetchAndHttp 无法注册 PixHttp.abortRequest
  assert.equal(typeof first.options.signal.onAbort, "function", "signal 必须是 PolyfillAbortController.signal")
  assert.equal(abortModule.controllers.length, 1)
  assert.equal(first.options.signal.aborted, false)

  // 模拟 fetchAndHttp 在 signal 上登记原生请求中止
  let nativeAbortCalls = 0
  first.options.signal.onAbort(() => {
    nativeAbortCalls += 1
  })

  tree = renderSheet()
  const stopBtn = findButton(tree, "停止识别")
  assert.ok(stopBtn, "请求进行中应显示「停止识别」")
  stopBtn.props.onPress()

  assert.equal(first.options.signal.aborted, true, "停止后 signal 应变为 aborted")
  assert.equal(nativeAbortCalls, 1, "停止应触发 signal 的 onAbort，从而调用 PixHttp.abortRequest")
  assert.equal(abortModule.controllers[0].signal.abortEvents, 1)

  // 中止后迟到的回调与最终结果都不能写入状态
  first.options.onChunk("迟到分片不应写入")
  first.options.onImageReady("/late/should-not-render.jpg")
  first.options.onBubblesParsed([{ box_2d: [0, 0, 500, 500], translation: "迟到气泡" }])

  tree = renderSheet()
  assert.deepEqual(readSelectableTexts(tree), ["第一段"], "迟到分片与结果不应覆盖中止前的输出")
  let images = []
  walk(tree, (node) => {
    if (node.type === "Image") images.push(node)
  })
  assert.equal(images.length, 0, "中止后迟到的 onImageReady 不应渲染预览图")
  assert.ok(findButton(tree, "开始识别与气泡翻译"), "中止后应恢复启动按钮")

  // 旧请求的 finally 不能清掉新请求的 running 状态
  findButton(tree, "开始识别与气泡翻译").props.onPress()
  await tick()

  const second = calls[1]
  assert.ok(second, "应发起第二次 OCR 请求")
  assert.equal(typeof second.options.signal.onAbort, "function")
  assert.equal(abortModule.controllers.length, 2)

  // 第二次请求尚未完成时，让第一次请求 settle
  first.options.onChunk("旧请求迟到覆盖")
  gates[0]()
  await tick()

  tree = renderSheet()
  assert.ok(findButton(tree, "停止识别"), "旧请求 finally 不应清除新请求的 running 状态")
  assert.deepEqual(readSelectableTexts(tree), ["第二段"])

  gates[1]()
  await tick()

  tree = renderSheet()
  assert.ok(findButton(tree, "开始识别与气泡翻译"))
  assert.deepEqual(readSelectableTexts(tree), ["第二次完整返回"])
})

test("OCR contain 几何：窄长图与宽图都按实际绘制区域换算气泡", () => {
  const layout = loadTsModule(ocrLayoutPath)

  // 窄长图：容器 360×300 里放 800×4000，实际只画出 60×300 并水平居中
  const tall = layout.computeContainedRect({ width: 360, height: 300 }, { width: 800, height: 4000 })
  assert.deepEqual(tall, { x: 150, y: 0, width: 60, height: 300, scale: 0.075 })
  assert.deepEqual(
    layout.mapBubbleBoxToRect([100, 0, 200, 1000], tall),
    { left: 150, top: 30, width: 60, height: 30 },
  )

  // 宽图：容器 400×200 里放 2000×800，实际画出 400×160 并垂直居中
  const wide = layout.computeContainedRect({ width: 400, height: 200 }, { width: 2000, height: 800 })
  assert.deepEqual(wide, { x: 0, y: 20, width: 400, height: 160, scale: 0.2 })
  assert.deepEqual(
    layout.mapBubbleBoxToRect([0, 0, 200, 500], wide),
    { left: 0, top: 20, width: 200, height: 32 },
  )

  // 无效尺寸不产生负数或 NaN 坐标
  const empty = layout.computeContainedRect({ width: 0, height: 0 }, { width: 800, height: 4000 })
  assert.deepEqual(empty, { x: 0, y: 0, width: 0, height: 0, scale: 0 })
  assert.equal(layout.mapBubbleBoxToRect([0, 0, 1000, 1000], empty), null)

  // 长条漫不再被旧的 [0.45, 2.2] 夹取
  assert.equal(layout.computeStageAspectRatio({ width: 800, height: 4000 }), 0.2)
  assert.equal(layout.computeStageAspectRatio({ width: 2000, height: 800 }), 2.5)
})

test("OCR 预览：长条漫 stage 使用原始比例，气泡叠加按 contain 偏移定位", async () => {
  const mini = createMiniReact()
  const abortModule = createAbortHarness()
  const bubble = {
    box_2d: [0, 0, 1000, 1000],
    translation: "译文",
    original: "原文",
    shape: "ellipse",
  }

  const aiService = createAiService({
    streamVisionTranslateImage: async (_illust, _pageIndex, options) => {
      options.onChunk("识别完成")
      options.onImageReady("/ocr/page-1.jpg")
      options.onBubblesParsed([bubble])
      return "识别完成"
    },
  })

  const mod = loadSheet(mini, aiService, abortModule)
  const renderSheet = () => {
    mini.beginRender()
    const tree = mod.IllustAISheet({
      illust: makeIllust(800, 20000),
      initialMode: "ocr",
      initialPage: 0,
      onClose: () => {},
    })
    mini.flushEffects()
    return tree
  }

  let tree = renderSheet()
  findButton(tree, "开始识别与气泡翻译").props.onPress()
  await tick()

  tree = renderSheet()
  const stage = findStage(tree)
  assert.ok(stage, "应渲染 OCR 预览 stage")
  const stageStyle = stage.props.style.find((entry) => entry && "aspectRatio" in entry)
  // 800×20000 的原图比例为 0.04；旧实现会夹到 0.45，导致明显左右黑边
  assert.equal(stageStyle.aspectRatio, 0.08, "超长图应按最小比例 0.08 显示而不是 0.45")

  // 容器高 4500（360 / 0.08），800×20000 按 contain 实际只画 180 宽并左右各留 90
  stage.props.onLayout({ nativeEvent: { layout: { width: 360, height: 4500 } } })
  tree = renderSheet()

  const rects = readBubbleRects(tree)
  assert.equal(rects.length, 1, "应渲染一个气泡叠加层")
  assert.equal(rects[0].left, 90, "气泡 left 应加上 contain 水平偏移")
  assert.equal(rects[0].top, 0)
  assert.equal(rects[0].width, 180, "气泡宽度应按实际绘制宽度换算")
  assert.equal(rects[0].height, 4500)
})
