const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadNovelHtmlBuilder() {
  const androidRoot = path.resolve(__dirname, "..")
  const cache = new Map()

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const js = ts.transpileModule(source, {
      fileName: absPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText

    const mod = { exports: {} }
    cache.set(absPath, mod)
    const ctx = {
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id.startsWith(".")) {
          const base = path.resolve(path.dirname(absPath), id)
          for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return load(cand)
          }
        }
        throw new Error(`Unexpected require "${id}" from ${absPath}`)
      },
      console,
      Math,
      Date,
      Error,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      JSON,
      parseInt,
    }
    vm.runInNewContext(js, ctx, { filename: absPath })
    return mod.exports
  }

  return load(path.resolve(androidRoot, "src/app/features/novel/novelHtmlBuilder.ts"))
}

const DEFAULT_SETTINGS = {
  fontId: "songti",
  customFontPostscriptName: null,
  fontWeight: "regular",
  fontSize: 18,
  lineSpacingLevel: "normal",
  layoutDirection: "horizontal",
  pageDisplayMode: "continuous",
  translationTargetLanguage: "zh-CN",
}

test("parseNovelToChunks 生成与 iOS NovelReader 完全一致的 chunk ID（text/chapter/newpage/jump/uploadedimage/pixivimage）", () => {
  const builder = loadNovelHtmlBuilder()
  const raw = [
    "[chapter: 第一章 序幕]",
    "正文第一段，包含 [[rb:漢字 > かな]] 与 [[emphasismark:重点 > ﹅]]。",
    "[uploadedimage: 9001]",
    "[newpage]",
    "第二页正文 [pixivimage: 12345-2]",
    "[jump: 1]",
  ].join("\n")

  const chunks = builder.parseNovelToChunks(raw, {
    "9001": { urls: { "1200x1200": "https://i.pximg.net/novel-img/9001.jpg" } },
  })

  assert.deepEqual(
    Array.from(chunks, (c) => ({ type: c.type, id: c.id })),
    [
      { type: "chapter", id: "chapter-1" },
      { type: "text", id: "chunk-1" },
      { type: "uploadedimage", id: "up-9001-2" },
      { type: "newpage", id: "page-2" },
      { type: "text", id: "chunk-4" },
      { type: "pixivimage", id: "px-12345-2-5" },
      { type: "jump", id: "jump-1-6" },
    ],
  )

  const pageMap = builder.indexNovelChunkPages(chunks)
  assert.equal(pageMap["chapter-1"], 1)
  assert.equal(pageMap["chunk-1"], 1)
  assert.equal(pageMap["page-2"], 2)
  assert.equal(pageMap["chunk-4"], 2)

  const translatable = builder.extractTranslatableBlocks(chunks)
  assert.deepEqual(
    Array.from(translatable, (b) => ({ id: b.id, kind: b.kind })),
    [
      { id: "chapter-1", kind: "chapter" },
      { id: "chunk-1", kind: "text" },
      { id: "chunk-4", kind: "text" },
    ],
  )
})

test("buildNovelReaderHtml 正确输出横向/竖排文库 CSS、行内语法、安全转义与运行时桥接", () => {
  const builder = loadNovelHtmlBuilder()
  const raw = [
    "[chapter: 序章 <script>alert(1)</script>]",
    "[b:加粗] [i:斜体] [[rb:魔法 > まほう]] [[emphasismark:注目 > ﹅]] [[jumpuri:官网 > https://www.pixiv.net]]",
    "[newpage]",
    "[pixivimage: 88888]",
    "[jump: 1]",
  ].join("\n")
  const chunks = builder.parseNovelToChunks(raw)

  const horizontalHtml = builder.buildNovelReaderHtml({
    novelId: 42,
    title: "测试小说 <Title>",
    chunks,
    settings: { ...DEFAULT_SETTINGS, layoutDirection: "horizontal" },
    readerTheme: "sepia",
    systemIsDark: false,
    ownerGeneration: 1,
    safeTopPx: 36,
    safeBottomPx: 24,
  })

  // XSS escaped
  assert.ok(!horizontalHtml.includes("<script>alert(1)</script>"))
  assert.ok(horizontalHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"))
  assert.ok(horizontalHtml.includes("测试小说 &lt;Title&gt;"))

  // Inline markup rendered
  assert.ok(horizontalHtml.includes("<strong>加粗</strong>"))
  assert.ok(horizontalHtml.includes("<em>斜体</em>"))
  assert.ok(horizontalHtml.includes("<ruby>魔法<rt>まほう</rt></ruby>"))
  assert.ok(horizontalHtml.includes('class="novel-emphasis"'))
  assert.ok(horizontalHtml.includes("handleLinkClick"))
  assert.ok(horizontalHtml.includes("handleOpenIllust(88888)"))
  assert.ok(horizontalHtml.includes("handleJumpToPage(1)"))

  // Sepia theme + safe-area CSS variables + runtime embedded
  assert.ok(horizontalHtml.includes("--bg-color: #F4ECD8"))
  assert.ok(horizontalHtml.includes("--safe-top: 36px"))
  assert.ok(horizontalHtml.includes("--safe-bottom: 24px"))
  assert.ok(horizontalHtml.includes("window.NovelReaderRuntime"))
  assert.ok(horizontalHtml.includes("writing-mode: horizontal-tb"))

  // Vertical bunko mode
  const verticalHtml = builder.buildNovelReaderHtml({
    novelId: 42,
    title: "縦書きテスト",
    chunks,
    settings: { ...DEFAULT_SETTINGS, layoutDirection: "vertical" },
    readerTheme: "dark",
    systemIsDark: true,
    ownerGeneration: 2,
    seriesTitle: "测试系列",
    seriesPrev: { id: 41, title: "前一话" },
    seriesNext: { id: 43, title: "后一话" },
  })
  assert.ok(verticalHtml.includes("writing-mode: vertical-rl"))
  assert.ok(verticalHtml.includes("text-orientation: mixed"))
  assert.ok(verticalHtml.includes("--bg-color: #121216"))
  assert.ok(verticalHtml.includes("handleSeriesNav('prev', 41)"))
  assert.ok(verticalHtml.includes("handleSeriesNav('next', 43)"))
})

test("buildNovelTranslationPatchScript / Typography / Image / Jump 脚本结构有效且支持原文/译文切换", () => {
  const builder = loadNovelHtmlBuilder()
  const patchScript = builder.buildNovelTranslationPatchScript(
    {
      novelId: 42,
      targetLanguage: "zh-CN",
      mode: "translated",
      running: false,
      done: 2,
      total: 2,
      failed: 0,
      stale: 0,
      phase: "idle",
      summaryStatus: "ready",
      glossaryStatus: "skipped",
      glossaryCount: 0,
      seriesGlossaryCount: 0,
      glossaryLocked: false,
      thinkingNotice: "",
      translatedTitle: "中文译名",
      blocks: {
        "chapter-1": { id: "chapter-1", original: "第一章", kind: "chapter", status: "done", translation: "第一章（译）" },
        "chunk-1": { id: "chunk-1", original: "本文", kind: "text", status: "done", translation: "译文第一行\n\n译文第二行" },
      },
    },
    "chunk-1",
  )

  assert.ok(patchScript.includes("中文译名"))
  assert.ok(patchScript.includes("第一章（译）"))
  assert.ok(patchScript.includes("译文第一行"))
  assert.ok(patchScript.includes("__novelTranslationOriginals"))
  assert.ok(patchScript.includes("data-chunk-id"))

  const typoScript = builder.buildNovelTypographyPatchScript(
    { ...DEFAULT_SETTINGS, fontSize: 22, fontWeight: "bold", lineSpacingLevel: "loose" },
    "dark",
    true,
  )
  assert.ok(typoScript.includes("window.applyTypography"))
  assert.ok(typoScript.includes('"fontSize":22'))
  assert.ok(typoScript.includes('"fontWeight":700'))

  const imgScript = builder.buildNovelImagePatchScript("up-9001-2", "data:image/jpeg;base64,AAAA", "chunk-1")
  assert.ok(imgScript.includes("up-9001-2"))
  assert.ok(imgScript.includes("realignAfterContentChange"))

  const jumpScript = builder.buildNovelJumpScript({ chunkId: "chunk-4", page: 2, quote: "第二页" })
  assert.ok(jumpScript.includes("NovelReaderRuntime.jumpToAnchor"))
  assert.ok(jumpScript.includes("chunk-4"))
})

const MESSAGE_NAMES = [
  "onProgressChange",
  "readerReady",
  "toggleControls",
  "openLink",
  "openIllust",
  "jumpToPage",
  "onSeriesNav",
]

function makeChunkElement(spec) {
  return {
    id: spec.id,
    innerText: spec.text || "",
    textContent: spec.text || "",
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(spec.attrs, name) ? spec.attrs[name] : null
    },
    getBoundingClientRect() {
      return spec.rect
    },
  }
}

/**
 * 在 vm 中执行 buildNovelReaderHtml 注入的内联脚本，用替身 DOM/滚动容器捕获进度消息。
 * 只替换宿主边界（DOM 与 NovelReaderRuntime），进度与锚点换算仍走生成脚本的真实实现。
 */
function runReaderDocumentScript(html, env) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(match, "reader inline script not found")

  const messages = []
  const scrollListeners = []
  const timers = []
  const handlers = {}
  for (const name of MESSAGE_NAMES) {
    handlers[name] = {
      postMessage(payload) {
        messages.push({ name, payload: JSON.parse(JSON.stringify(payload)) })
      },
    }
  }

  const chunks = env.chunks.map(makeChunkElement)
  const root = {
    scrollWidth: env.scrollWidth,
    scrollHeight: env.scrollHeight,
    scrollLeft: env.rootScrollLeft || 0,
    scrollTop: env.rootScrollTop || 0,
    clientWidth: env.innerWidth,
    clientHeight: env.innerHeight,
    style: { setProperty() {} },
  }
  const body = {
    scrollLeft: env.bodyScrollLeft || 0,
    scrollTop: env.bodyScrollTop || 0,
    style: {},
  }
  const windowObj = {
    innerWidth: env.innerWidth,
    innerHeight: env.innerHeight,
    scrollX: env.scrollX || 0,
    scrollY: env.scrollY || 0,
    addEventListener(type, handler) {
      if (type === "scroll") scrollListeners.push(handler)
    },
    scrollTo() {},
    webkit: { messageHandlers: handlers },
    setTimeout(fn) {
      timers.push(fn)
      return timers.length
    },
    clearTimeout() {},
    getSelection() {
      return null
    },
  }
  windowObj.window = windowObj

  const documentObj = {
    readyState: "complete",
    documentElement: root,
    body,
    scrollingElement: root,
    getElementById(id) {
      return chunks.find((el) => el.id === id) || null
    },
    querySelectorAll() {
      return []
    },
    addEventListener() {},
  }

  const context = vm.createContext({
    window: windowObj,
    document: documentObj,
    setTimeout: windowObj.setTimeout,
    clearTimeout: windowObj.clearTimeout,
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    parseInt,
    Infinity,
  })
  vm.runInContext(match[1], context, { filename: "novel-reader-inline.js" })

  // 用确定性替身替换运行时，只验证生成脚本的阅读边/滚动轴换算
  const runtime = {
    chunkElements: () => chunks,
    computeAnchor: () => ({ offset: 999, quote: "stub" }),
    subElements: (el) => [el],
    textOf: (el) => el.innerText || "",
    noteScroll() {},
    markProgrammatic() {},
    jumpToAnchor: () => ({ matched: "start", chunkId: null }),
    scrollElementIntoView: () => true,
  }
  windowObj.NovelReaderRuntime = runtime

  for (const listener of scrollListeners) listener()
  assert.ok(timers.length > 0, "scroll listener did not schedule a progress report")
  timers[timers.length - 1]()

  return messages.filter((m) => m.name === "onProgressChange").map((m) => m.payload)
}

function buildSettings(overrides) {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

test("竖排只输出单一滚动容器，进度按横向滚动轴（含 RTL 负值/body 兜底）换算", () => {
  const builder = loadNovelHtmlBuilder()
  const raw = ["第一页正文", "[newpage]", "第二页正文"].join("\n")
  const chunks = builder.parseNovelToChunks(raw)
  const verticalHtml = builder.buildNovelReaderHtml({
    novelId: 7,
    title: "縦書き",
    chunks,
    settings: buildSettings({ layoutDirection: "vertical" }),
    readerTheme: "light",
    systemIsDark: false,
    ownerGeneration: 3,
  })

  // html 是唯一滚动容器；body 不再声明 overflow-x/height:100vh
  assert.equal(
    (verticalHtml.match(/overflow-x: auto/g) || []).length,
    1,
    "vertical document must declare exactly one horizontal scroll container",
  )
  assert.ok(verticalHtml.includes("body {\n      height: 100%;\n      overflow: visible;"))
  assert.ok(!verticalHtml.includes("html, body {\n      height: 100vh;"))

  // 横排行为保持不变
  const horizontalHtml = builder.buildNovelReaderHtml({
    novelId: 7,
    title: "横向",
    chunks,
    settings: buildSettings({ layoutDirection: "horizontal" }),
    readerTheme: "light",
    systemIsDark: false,
    ownerGeneration: 4,
  })
  assert.ok(horizontalHtml.includes("overflow-x: hidden"))
  assert.ok(horizontalHtml.includes("overflow-y: auto"))
  assert.equal((horizontalHtml.match(/overflow-x: auto/g) || []).length, 0)

  const chunkSpecs = [
    {
      id: "chunk-1",
      text: "第一页正文",
      attrs: { "data-chunk-id": "chunk-1", "data-chunk-index": "0", "data-page": "1" },
      rect: { top: 0, right: 500, left: 380, bottom: 800 },
    },
    {
      id: "chunk-2",
      text: "第二页正文",
      attrs: { "data-chunk-id": "chunk-2", "data-chunk-index": "1", "data-page": "2" },
      rect: { top: 0, right: 340, left: 180, bottom: 800 },
    },
  ]

  // 竖排：right=340 命中 innerWidth*0.85，scrollX=-1800 / (4000-400) = 0.5
  const verticalMessages = runReaderDocumentScript(verticalHtml, {
    innerWidth: 400,
    innerHeight: 800,
    scrollWidth: 4000,
    scrollHeight: 800,
    scrollX: -1800,
    rootScrollLeft: -1800,
    chunks: chunkSpecs,
  })
  assert.equal(verticalMessages.length, 1)
  assert.equal(verticalMessages[0].chunkId, "chunk-2")
  assert.equal(verticalMessages[0].page, 2)
  assert.equal(verticalMessages[0].ratio, 0.5)
  assert.equal(verticalMessages[0].quote, "第二页正文")

  // 只有 body.scrollLeft 有值时也能拿到真实进度（900/3600 = 0.25）
  const bodyFallbackMessages = runReaderDocumentScript(verticalHtml, {
    innerWidth: 400,
    innerHeight: 800,
    scrollWidth: 4000,
    scrollHeight: 800,
    scrollX: 0,
    rootScrollLeft: 0,
    bodyScrollLeft: -900,
    chunks: chunkSpecs,
  })
  assert.equal(bodyFallbackMessages[0].ratio, 0.25)

  // 横排：仍按 rect.top / scrollY 计算（450/1200 = 0.375）
  const horizontalMessages = runReaderDocumentScript(horizontalHtml, {
    innerWidth: 400,
    innerHeight: 600,
    scrollWidth: 400,
    scrollHeight: 1800,
    scrollY: 450,
    chunks: [
      { ...chunkSpecs[0], rect: { top: 10, right: 400, left: 0, bottom: 200 } },
      { ...chunkSpecs[1], rect: { top: 74, right: 400, left: 0, bottom: 260 } },
    ],
  })
  assert.equal(horizontalMessages.length, 1)
  assert.equal(horizontalMessages[0].chunkId, "chunk-2")
  assert.equal(horizontalMessages[0].ratio, 0.375)
})

test("paged 模式输出可见分页样式，continuous 模式不输出 paged-break", () => {
  const builder = loadNovelHtmlBuilder()
  const chunks = builder.parseNovelToChunks(["第一页正文", "[newpage]", "第二页正文"].join("\n"))

  const pagedHtml = builder.buildNovelReaderHtml({
    novelId: 8,
    title: "分页",
    chunks,
    settings: buildSettings({ pageDisplayMode: "paged" }),
    readerTheme: "light",
    systemIsDark: false,
    ownerGeneration: 5,
  })
  assert.ok(pagedHtml.includes('class="page-divider paged-break"'))
  assert.ok(pagedHtml.includes(".page-divider.paged-break {"))
  assert.ok(pagedHtml.includes("break-before: page"))
  assert.ok(pagedHtml.includes("page-break-before: always"))
  assert.ok(pagedHtml.includes("border-radius: 999px"))
  // 分页只改分隔样式，不改变 chunk 结构（翻译原位替换依赖这些节点）
  assert.ok(pagedHtml.includes('class="text-chunk-block" data-chunk-id="chunk-0"'))
  assert.ok(pagedHtml.includes("window.NovelReaderRuntime"))

  const continuousHtml = builder.buildNovelReaderHtml({
    novelId: 8,
    title: "连续",
    chunks,
    settings: buildSettings({ pageDisplayMode: "continuous" }),
    readerTheme: "light",
    systemIsDark: false,
    ownerGeneration: 6,
  })
  assert.ok(continuousHtml.includes('class="page-divider"'))
  assert.ok(!continuousHtml.includes("paged-break"))

  // 竖排分页同样有页界，且不影响竖排单一滚动容器
  const verticalPagedHtml = builder.buildNovelReaderHtml({
    novelId: 8,
    title: "縦書き分頁",
    chunks,
    settings: buildSettings({ layoutDirection: "vertical", pageDisplayMode: "paged" }),
    readerTheme: "dark",
    systemIsDark: true,
    ownerGeneration: 7,
  })
  assert.ok(verticalPagedHtml.includes('class="page-divider paged-break"'))
  assert.equal((verticalPagedHtml.match(/overflow-x: auto/g) || []).length, 1)
})

test("NovelReaderScreen 的 HUD 初始值与设置项 novelImmersiveReaderEnabled 接线", () => {
  const screenPath = path.resolve(
    __dirname,
    "../src/app/features/novel/NovelReaderScreen.tsx",
  )
  const source = fs.readFileSync(screenPath, "utf8")

  // 初始值来自设置项，而不是硬编码 useState(true)
  assert.ok(source.includes("loadSettings().novelImmersiveReaderEnabled"))
  assert.ok(source.includes("() => !loadSettings().novelImmersiveReaderEnabled"))
  assert.ok(!source.includes("const [showHud, setShowHud] = useState(true)"))
  // 设置变化时生效（订阅 onSettingsChanged 并刷新 HUD）
  assert.ok(source.includes("onSettingsChanged("))
  assert.ok(source.includes("if (next === immersiveReaderRef.current) return"))
  // 未开启沉浸时轻触正文不应隐藏上下栏
  assert.ok(source.includes("if (!immersiveReaderRef.current) return"))
})
