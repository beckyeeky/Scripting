const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("../node_modules/typescript")

const sheetPath = path.resolve(__dirname, "../src/app/features/novel/NovelAISheet.tsx")
const aiServicePath = path.resolve(
  __dirname,
  "../../../Pix-Scripting/src/api/aiService.ts",
)
const componentsPath = path.resolve(__dirname, "../src/app/components/index.ts")
const overlayPath = path.resolve(__dirname, "../src/app/overlay/OverlayHost.tsx")
const themePath = path.resolve(__dirname, "../src/app/theme/ThemeProvider.tsx")
const insetsPath = path.resolve(__dirname, "../src/app/theme/insets.ts")
const hostGlobalsPath = path.resolve(__dirname, "../src/scripting/hostGlobals.ts")
const polyfillsPath = path.resolve(__dirname, "../src/scripting/polyfills.ts")

// ---- 极简 React 运行时：够用即可（函数组件 + useState/useEffect/useRef/useCallback）----
function createMiniReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
    children: children.flat(),
  })

  let hooks = []
  let cursor = 0
  let pendingEffects = []

  function beginRender() {
    cursor = 0
  }

  function useState(initial) {
    const index = cursor++
    if (!(index in hooks)) {
      hooks[index] = typeof initial === "function" ? initial() : initial
    }
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
      const cleanup = prev && prev.cleanup
      pendingEffects.push(() => {
        if (cleanup) cleanup()
        const result = effect()
        hooks[index] = { deps, cleanup: result }
      })
    } else {
      pendingEffects.push(() => {})
    }
  }

  function useCallback(fn, deps) {
    const index = cursor++
    const prev = hooks[index]
    if (prev && deps && deps.every((d, i) => d === prev.deps[i])) {
      hooks[index] = prev
      return prev.fn
    }
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
      useRef,
      useState,
      useMemo: (fn) => fn(),
    },
    beginRender,
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
      for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, resolved + "/index.ts", resolved + "/index.tsx"]) {
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
  if (node.props && node.props.children && node.props.children !== node.children) {
    walk(node.props.children, visit, seen)
  }
}

test("小说 AI 导读：累计快照流不能拼接成反复刷屏的正文", async () => {
  const mini = createMiniReact()
  const chunks = ["### 📌 核心剧情大纲", "### 📌 核心剧情大纲\n主线开始。", "### 📌 核心剧情大纲\n主线开始。\n主线结束。"]
  let releaseStream
  const streamGate = new Promise((resolve) => {
    releaseStream = resolve
  })

  const aiService = {
    getNovelPageText: (text) => text,
    isAIAvailable: () => true,
    splitNovelPages: () => ["page-1"],
    streamContinueNovel: async () => "",
    streamSummarizeNovel: async (_text, options) => {
      for (const snapshot of chunks) options.onChunk(snapshot)
      // 卡在流式过程中，检查中途渲染的正文是否已经重复拼接
      await streamGate
      return chunks[chunks.length - 1]
    },
  }

  const ActionButton = (props) => mini.React.createElement("ActionButton", props)
  const SegmentedControl = (props) => mini.React.createElement("SegmentedControl", props)
  const ThemedTextInput = (props) => mini.React.createElement("ThemedTextInput", props)

  const mod = loadTsModule(sheetPath, {
    react: { ...mini.React, __esModule: true, default: mini.React },
    "react-native": {
      ActivityIndicator: "ActivityIndicator",
      ScrollView: "ScrollView",
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
      Text: "Text",
      View: "View",
    },
    [aiServicePath]: aiService,
    [componentsPath]: { ActionButton, SegmentedControl, ThemedTextInput },
    [overlayPath]: { useOverlay: () => ({ showToast: () => {} }) },
    [themePath]: { useAppTheme: () => ({ colors: {}, accent: "#000000" }) },
    [insetsPath]: { useSafeInsets: () => ({}), effectiveBottomInset: () => 0 },
    [hostGlobalsPath]: { ScriptingPasteboard: { setString: async () => {} } },
    [polyfillsPath]: {
      PolyfillAbortController: class {
        constructor() {
          this.signal = { aborted: false }
        }
        abort() {
          this.signal.aborted = true
        }
      },
    },
  })

  mini.beginRender()
  let tree = mod.NovelAISheet({
    title: "测试小说",
    text: "正文",
    onOpenCustomAISettings: () => {},
    onClose: () => {},
  })
  mini.flushEffects()

  let generate = null
  walk(tree, (node) => {
    if (node.type === ActionButton && node.props?.title === "生成导读总结") generate = node
  })
  assert.ok(generate, "应渲染出「生成导读总结」按钮")

  generate.props.onPress()
  await new Promise((resolve) => setTimeout(resolve, 0))

  mini.beginRender()
  tree = mod.NovelAISheet({
    title: "测试小说",
    text: "正文",
    onOpenCustomAISettings: () => {},
    onClose: () => {},
  })

  // 流式进行中：此刻的正文必须是最后一次累计快照，而不是历史快照的拼接
  const midOutputs = []
  walk(tree, (node) => {
    if (node.type === "Text" && node.props?.selectable) midOutputs.push(node.props.children)
  })
  assert.equal(midOutputs.length, 1)
  assert.equal(midOutputs[0], chunks[chunks.length - 1], "流式中途的正文不应重复拼接")

  releaseStream()
  await new Promise((resolve) => setTimeout(resolve, 0))

  mini.beginRender()
  tree = mod.NovelAISheet({
    title: "测试小说",
    text: "正文",
    onOpenCustomAISettings: () => {},
    onClose: () => {},
  })

  const outputs = []
  walk(tree, (node) => {
    if (node.type === "Text" && node.props?.selectable) outputs.push(node.props.children)
  })
  assert.equal(outputs.length, 1, "应只有一处输出正文")
  assert.equal(outputs[0], chunks[chunks.length - 1])
  assert.ok(
    !outputs[0].includes("主线开始。\n主线结束。\n### 📌"),
    "累计快照不应被重复拼接",
  )
  assert.ok(outputs[0].length <= chunks.join("").length, "输出长度不应超过全部快照之和")
})
