const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")
const crypto = require("node:crypto")

function evaluate(source, file, mocks = {}, globals = {}) {
  const js = ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, { module, exports: module.exports, console, setTimeout, clearTimeout,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: file })
  return module.exports
}
function load(file, mocks = {}, globals = {}) {
  return evaluate(fs.readFileSync(file, "utf8"), file, mocks, globals)
}
const readerFile = "Pix-Scripting/src/ui/NovelReader.tsx"
const readerSource = fs.readFileSync(readerFile, "utf8")
const reader = evaluate(readerSource.slice(readerSource.indexOf("export function escapeHtml"),
  readerSource.indexOf("function getLocalImageDataUrl")), readerFile)
const novelExport = load("Pix-Scripting/src/store/novelExport.ts")

function immersiveHarness(direction) {
  const effects = [], loaded = [], closes = [], translations = []
  const controller = {
    loadHTML: async html => { loaded.push(html) }, evaluateJavaScript: async () => {},
    addScriptMessageHandler: async () => {}, dispose() {},
  }
  const globals = { ...reader,
    useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn,
    useEffect: fn => { effects.push(fn) },
    useNovelExperimentalAmbientPalette: () => ({}), useEffectiveIsDark: () => false,
    generateAmbientBackgroundCss: () => "transparent", useLayoutMetrics: () => ({ isLandscape: false }),
    loadNovelReaderSettings: () => ({ layoutDirection: direction, pageDisplayMode: "continuous",
      fontSize: 18, fontWeight: "regular", lineSpacingLevel: 1 }),
    onNovelReaderSettingsChanged: () => () => {}, resolveFontName: () => null,
    calculateLineSpacing: () => 6, useSeriesEpisodeNav: () => ({}),
    useNovelTranslation: (...args) => { translations.push(args); return { session: null, snapshot: null } },
    WebViewController: function() { return controller }, Device: { screen: { height: 800 } },
    appCustomTint: () => "systemBlue", appGlass: () => ({}), appInteractiveGlass: () => ({}),
    Animation: { smooth: () => ({}) }, triggerHaptic() {},
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  }
  for (const name of ["NavigationStack", "ZStack", "Button", "Image", "WebView", "Rectangle",
    "VStack", "HStack", "Text", "Spacer", "Menu", "Picker", "NovelTypographySheet"]) globals[name] = name
  const file = "Pix-Scripting/src/ui/NovelImmersiveReader.tsx"
  const source = fs.readFileSync(file, "utf8")
  const mod = evaluate(source.slice(source.indexOf("function isVirtualNode")), file, {}, globals)
  const props = { novelId: 1, title: "原题", caption: "简介", text: "正文第一段\n[newpage]\n正文第二段",
    onClose: (...args) => closes.push(args) }
  return { render: () => mod.NovelImmersiveReaderView(props), effects, loaded, closes, translations }
}
for (const direction of ["horizontal", "vertical"]) {
  test(`沉浸式${direction}入口能渲染、加载正文并关闭`, async () => {
    const harness = immersiveHarness(direction)
    const tree = harness.render()
    assert.equal(tree.type, "NavigationStack")
    const zstack = tree.props.children[0]
    const webview = zstack.props.children.find(child => child?.type === "WebView")
    assert.ok(webview)
    for (const effect of harness.effects) effect()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(harness.loaded.length, 1)
    assert.match(harness.loaded[0], /正文第一段/)
    assert.match(harness.loaded[0], /正文第二段/)
    // 确保实际下发的内嵌 JS 可解析，避免页面加载后失去交互。
    for (const script of harness.loaded[0].matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1])
    assert.equal(harness.translations[0][2], "简介")
    zstack.props.toolbar.topBarLeading[0].props.action()
    assert.deepEqual(harness.closes, [[null, 1, 1]])
  })
}

function seriesHarness({ incompleteId, fetchFailureId, missingTextId, accountChangeId, realStore = false } = {}) {
  const exported = [], inputs = [], taskErrors = []
  let uid = "fixture-user"
  const novels = [2, 1].map(id => ({ id, title: `原题${id}`, caption: `简介${id}`,
    series: { series_order: id }, user: { name: "作者" } }))
  const sourceText = "[chapter:原章]\n原文正文\n[newpage]\n[uploadedimage:9]\n[pixivimage:123-2]\n[jump:1]"
  const mocks = {
    "../api/pixiv": {
      novelSeries: async () => ({ novel_series_detail: { title: "系列" }, novels: novels.slice(0, 1), next_url: "next" }),
      nextNovelSeries: async () => ({ novels: novels.slice(1) }),
      novelViewerData: async id => {
        if (id === fetchFailureId) throw new Error("正文请求失败")
        if (id === accountChangeId) uid = "another-user"
        return { text: id === missingTextId ? "" : sourceText,
          textEmbeddedImages: { 9: { urls: { original: "https://fixture/image.jpg" } } } }
      },
    },
    "../api/session": { session: { call: fn => fn("fixture-token") } },
    "../image/imageLoader": {}, "../store/settings": {}, "./cbzExporter": {},
    "./epubExporter": { exportNovelToEpub: async options => { exported.push(options); return "/fixture.epub" } },
    "./downloadHelper": { yieldToMainThread: async () => {} },
    "./StageProgressPipeline": { StageProgressPipeline: class {
      reportPrepare() {} reportDownload() {} reportPack() {} reportComplete() {}
    } },
    "./downloadTaskManager": { DownloadTaskManager: { submitTask: async task => {
      try { await task.runner({ checkOrWait: async () => {} }, {}, { completedIndices: [] }, () => {}) }
      catch (error) { taskErrors.push(error) }
      return "fixture-task"
    } } },
    "../ui/NovelReader": reader,
    "../api/aiService": { cleanHtmlCaption: value => value || "" },
    "../store/novelExport": novelExport,
    "../store/dataDirectory": { resolveEffectiveUID: () => uid },
    "../store/novelReaderSettings": { loadNovelReaderSettings: () => ({ translationTargetLanguage: "en" }) },
    "../store/novelTranslation": { getNovelTranslationSession: input => {
      inputs.push(input)
      return { getSnapshot: () => ({ translatedTitle: `译题${input.novelId}`, translatedCaption: `译介${input.novelId}`,
        targetLanguage: input.targetLanguage, total: 2, done: input.novelId === incompleteId ? 1 : 2, failed: 0,
        blocks: Object.fromEntries(input.blocks.map(block => [block.id, { status: "done", translation: block.kind === "chapter" ? "译章" : "译文正文" }])),
      }), start() { throw new Error("导出不得启动付费翻译") } }
    } },
  }
  const files = new Map()
  let translationCalls = 0
  if (realStore) {
    mocks["../store/novelTranslation"] = load("Pix-Scripting/src/store/novelTranslation.ts", {
      scripting: { AbortController },
      "../api/aiService": { isAIAvailable: () => true, getNovelTranslationThinkingNotice: () => "",
        translateNovelPassage: async text => { translationCalls++; return text === "原章" ? "译章" : "译文正文" },
        generateNovelTranslationContext: async (title, caption, text, needs) => needs.summary
          ? { translatedTitle: title.replace("原题", "译题"), translatedCaption: caption.replace("简介", "译介"), summary: "摘要" }
          : { glossary: "人物｜Alice｜爱丽丝" }, validateNovelTranslation() {},
      },
      "./customAI": { loadCustomAIProfile: () => ({ general: { protocol: "openai-chat", endpoint: "https://fixture", model: "fixture" } }),
        isCustomAIConfigured: () => true, getEffectiveGeneralEndpoint: config => config.endpoint },
      "../api/aiAdapters": { resolveGeneralAIConfigRoute: config => config },
      "./dataDirectory": { pixivDataDirectory: () => "/fixture-cache", resolveEffectiveUID: () => uid },
      "./safeFile": { recoverFile() {}, writeTextSafely: (file, value) => files.set(file, value) },
    }, {
      Data: { fromRawString: text => Buffer.from(text) },
      Crypto: { sha256: value => ({ toHexString: () => crypto.createHash("sha256").update(value).digest("hex") }) },
      FileManager: { existsSync: file => files.has(file), readAsStringSync: file => files.get(file) },
    })
  }
  const downloader = load("Pix-Scripting/src/downloader/seriesDownloader.ts", mocks)
  return { download: options => downloader.downloadEntireNovelSeries(10, "系列", undefined, options),
    exported, inputs, taskErrors, sourceText, novels, store: mocks["../store/novelTranslation"],
    getTranslationCalls: () => translationCalls }
}
test("系列译文 EPUB 使用完整缓存译名、译介与正文，保留标记和章节顺序", async () => {
  const harness = seriesHarness()
  assert.equal(await harness.download({ mode: "translated", targetLanguage: "en" }), "/fixture.epub")
  assert.equal(harness.exported.length, 1)
  const epub = harness.exported[0]
  assert.deepEqual(Array.from(epub.chapters, chapter => chapter.id), [1, 2])
  assert.equal(epub.chapters[0].title, "译题1")
  assert.equal(epub.chapters[0].caption, "译介1")
  assert.match(epub.chapters[0].text, /译文正文/)
  assert.doesNotMatch(epub.chapters[0].text, /原文正文/)
  for (const marker of ["[chapter:译章]", "[newpage]", "[uploadedimage:9]", "[pixivimage:123-2]", "[jump:1]"]) assert.ok(epub.chapters[0].text.includes(marker))
  assert.equal(epub.chapters[0].images["9"], "https://fixture/image.jpg")
  assert.match(epub.customFileName, /en译文/)
  assert.ok(harness.inputs.every(input => input.targetLanguage === "en" && input.seriesId === 10))
})
test("原文系列下载保持兼容且不读取译文会话", async () => {
  const harness = seriesHarness()
  await harness.download()
  assert.equal(harness.exported[0].chapters[0].text, harness.sourceText)
  assert.equal(harness.inputs.length, 0)
})
for (const [name, options, message] of [
  ["某章译文未完成", { incompleteId: 2 }, /第 2 话.*译文尚未完成/],
  ["某章正文请求失败", { fetchFailureId: 2 }, /第 2 话.*正文请求失败/],
  ["某章正文为空", { missingTextId: 2 }, /第 2 话.*正文/],
  ["账号中途切换", { accountChangeId: 2 }, /账号.*变化/],
]) {
  test(`系列译文导出在${name}时拒绝生成混合或缺章 EPUB`, async () => {
    const harness = seriesHarness(options)
    await assert.rejects(harness.download({ mode: "translated", targetLanguage: "en" }), message)
    assert.equal(harness.exported.length, 0)
  })
}

function seriesHandler(name, globals, file = "Pix-Scripting/src/ui/seriesView.tsx") {
  const source = fs.readFileSync(file, "utf8")
  // 用 TypeScript AST 提取真实入口，保留弹窗、模式传递、错误提示和 finally。
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(declaration)
  return evaluate(declaration.getText(ast) + `\nexport { ${name} }`, file, {}, globals)[name]
}
const seriesDownloadEntrypoints = [
  ["系列页工具栏", "Pix-Scripting/src/ui/seriesView.tsx", "handleExportSeries", true],
  ["系列页底部操作栏", "Pix-Scripting/src/ui/bottomAccessory.tsx", "handleDownloadSeries", true],
  ["追更卡片菜单", "Pix-Scripting/src/ui/components/WatchlistSeriesCard.tsx", "handleExportSeries", false],
]
for (const [label, file, handler, hasBusyState] of seriesDownloadEntrypoints) {
  for (const [scenario, choice, incompleteId] of [["译文", 1], ["原文", 0], ["取消", null], ["译文缺章", 1, 2]]) {
    test(`${label}：${scenario}走统一选择流程`, async () => {
      const harness = seriesHarness({ incompleteId })
      const alerts = [], states = [], choices = [], shares = []
      const Dialog = { actionSheet: async options => { choices.push(options); return choice },
        confirm: async () => true, alert: async options => { alerts.push(options) } }
      const ShareSheet = { present: async files => shares.push(files) }
      const downloadEntireNovelSeries = (id, title, progress, options) => harness.download(options)
      const loadNovelReaderSettings = () => ({ translationTargetLanguage: "en" })
      const helperFile = "Pix-Scripting/src/ui/novelSeriesDownload.ts"
      const helper = fs.existsSync(helperFile) ? load(helperFile, {
        "../downloader/seriesDownloader": { downloadEntireNovelSeries },
        "../store/novelReaderSettings": { loadNovelReaderSettings },
        "../platform/haptics": { triggerHaptic() {} },
      }, { Dialog, ShareSheet }) : {}
      const action = seriesHandler(handler, {
        seriesDownloading: false, kind: "novel", isNovel: true, seriesID: 10, title: "系列", seriesTitle: "系列",
        item: { id: 10, title: "系列" }, triggerHaptic() {}, Dialog, ShareSheet,
        loadNovelReaderSettings, downloadEntireNovelSeries, ...helper,
        setSeriesDownloading: value => states.push(value),
      }, file)
      await action()
      assert.equal(choices.length, 1, "入口必须提供原文／译文选择")
      assert.match(choices[0].actions[0].label, /原文/)
      assert.match(choices[0].actions[1].label, /译文/)
      if (choice === null || incompleteId) {
        assert.equal(harness.exported.length, 0)
        assert.equal(shares.length, 0)
      } else {
        assert.equal(harness.exported.length, 1)
        assert.equal(shares.length, 1)
        assert.equal(harness.exported[0].chapters[0].title, choice === 1 ? "译题1" : "原题1")
      }
      if (incompleteId) {
        assert.equal(alerts.length, 1)
        assert.match(alerts[0].message, /第 2 话/)
      } else assert.equal(alerts.length, 0)
      if (hasBusyState) assert.deepEqual(states, choice === null ? [] : [true, false])
    })
  }
}

test("真实系列翻译入口生成的缓存可在清空内存会话后直接导出译文 EPUB", async () => {
  const harness = seriesHarness({ realStore: true })
  const action = seriesHandler("handleTranslateSeries", {
    kind: "novel", seriesID: 10, title: "系列", seriesTranslating: false,
    paged: { items: harness.novels.map(novel => ({ ...novel, episode_number: novel.id })) },
    Dialog: { confirm: async () => true }, stopTranslationRef: { current: false }, activeTranslationRef: { current: null },
    setSeriesTranslating() {}, setTranslationStatus() {}, resolveEffectiveUID: () => "fixture-user",
    session: { call: fn => fn("fixture-token") }, novelViewerData: async () => ({ text: harness.sourceText }),
    parseNovelToChunks: reader.parseNovelToChunks, cleanHtmlCaption: value => value,
    getNovelTranslationSession: harness.store.getNovelTranslationSession,
    loadNovelReaderSettings: () => ({ translationTargetLanguage: "en" }),
  })
  await action()
  const calls = harness.getTranslationCalls()
  assert.equal(calls, 4)
  harness.store.discardNovelTranslationSessions()
  await harness.download({ mode: "translated", targetLanguage: "en" })
  assert.equal(harness.exported.length, 1)
  assert.equal(harness.exported[0].chapters[0].title, "译题1")
  assert.equal(harness.exported[0].chapters[0].caption, "译介1")
  assert.match(harness.exported[0].chapters[0].text, /译文正文/)
  assert.equal(harness.getTranslationCalls(), calls, "导出只读缓存，不触发新翻译")
})
