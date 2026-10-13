/**
 * 译文状态面板与导出/离线入口的接线回归。
 *
 * - 译文状态面板：真实渲染（只替身宿主组件与脚本运行时），验证术语、供应商发送范围、失效段落提示实际显示；
 * - 导出闸门：真实 novelExport 实现，验证 stale 段落真的阻止复用旧译文导出；
 * - 系列离线保存入口：串接真实系列保存实现 + 源码接线断言（入口被移除时必须失败）。
 */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const ROOT = path.join(__dirname, "..")

function loadTsModule(file, mocks = {}, globals = {}) {
  const absolute = path.join(ROOT, file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
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

const ledger = loadTsModule("Pix-Scripting/src/store/novelTranslationLedger.ts", {
  "./novelAnchor": loadTsModule("Pix-Scripting/src/store/novelAnchor.ts"),
})
const novelExport = loadTsModule("Pix-Scripting/src/store/novelExport.ts")

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

/* ───────────────────── 一、译文状态面板真实渲染 ───────────────────── */

function createStateRuntime() {
  const slots = []
  let cursor = 0
  let component = null
  let props = null
  let last = null
  let queued = false
  function renderNow() {
    cursor = 0
    last = component(props)
    return last
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
  }
  return {
    hooks,
    tree: () => last,
    mount(fn, initialProps) { component = fn; props = initialProps; return renderNow() },
    async settle(rounds = 6) { for (let i = 0; i < rounds; i++) await Promise.resolve() },
  }
}

/** 找到树里标题匹配的按钮（真实交互：点开详情再断言显示内容） */
function findButtonTitle(tree, title) {
  let found = null
  const visit = (node) => {
    if (!node || typeof node !== "object" || found) return
    if (Array.isArray(node)) return node.forEach(visit)
    if (node.type === "Button" && node.props?.title === title) { found = node; return }
    Object.values(node.props ?? {}).forEach(visit)
  }
  visit(tree)
  return found
}

function renderStatus(props) {
  const runtime = createStateRuntime()
  const hostComponents = {}
  for (const name of ["Button", "HStack", "Image", "NavigationStack", "ProgressView", "ScrollView",
    "Spacer", "Text", "TextField", "Toggle", "VStack"]) {
    hostComponents[name] = name
  }
  hostComponents.useState = (...args) => runtime.hooks.useState(...args)
  const module = loadTsModule("Pix-Scripting/src/ui/NovelTranslationStatus.tsx", {
    scripting: hostComponents,
    "./components/glass": { appGlass: () => ({}) },
    "./components/pageChrome": { sheetDetents: () => [], sheetTopBar: () => ({}) },
    "../store/novelTranslation": {},
    "../store/novelReaderSettings": {
      NOVEL_TRANSLATION_TARGETS: [
        { id: "zh-Hans", label: "简体中文" },
        { id: "en", label: "English" },
      ],
    },
  }, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  })
  runtime.mount(module.NovelTranslationStatus, props)
  return runtime
}

/** 真实会话替身：发送范围与对齐警告使用真实实现，只有供应商判定是注入的边界 */
function makeSession(provider, snapshot, blocks) {
  return {
    currentProviderKind: () => provider,
    sendScopeNotice: (kind) => ledger.translationSendScopeNotice({
      provider: kind,
      title: "标题",
      caption: "简介",
      blocks,
      targetLanguage: snapshot.targetLanguage,
      glossaryCount: snapshot.glossaryCount,
    }),
    alignmentWarnings: () => ledger.translationAlignmentWarnings(blocks, snapshot.blocks),
    setMode() {}, pause() {}, start() {}, retry() {},
  }
}

const baseSnapshot = {
  novelId: 1,
  targetLanguage: "zh-Hans",
  mode: "translated",
  running: false,
  blocks: { "chunk-1": { id: "chunk-1", status: "done", translation: "译文" } },
  done: 1,
  total: 1,
  failed: 0,
  phase: "idle",
  summaryStatus: "ready",
  glossaryStatus: "ready",
  glossary: "类别｜原文｜译文\n人物｜小明｜小明",
  glossaryCount: 3,
  seriesGlossaryCount: 1,
  stale: 0,
  glossaryLocked: true,
  thinkingNotice: "",
}

test("译文面板实际显示术语条数与供应商发送范围（不含端点与密钥）", async () => {
  const blocks = [
    { id: "chapter-1", original: "第一章", kind: "chapter" },
    { id: "chunk-1", original: "正文一", kind: "text" },
  ]
  const runtime = renderStatus({
    session: makeSession("openai", baseSnapshot, blocks),
    snapshot: baseSnapshot,
    compact: false,
  })
  const collapsed = JSON.stringify(runtime.tree())
  assert.match(collapsed, /术语 3 项（系列继承 1）/)
  // 展开「译名、摘要与术语」后才显示发送范围（真实交互）
  findButtonTitle(runtime.tree(), "译名、摘要与术语").props.action()
  await runtime.settle()
  const flat = JSON.stringify(runtime.tree())
  assert.match(flat, /术语 3 项（系列继承 1）/)
  assert.match(flat, /发送范围：将向OpenAI 兼容接口请求翻译：标题与简介、1 个章节标题、1 个正文段落、术语表 3 条、目标语言 zh-Hans/)
  assert.match(flat, /不含账号序列号、令牌或本地凭据/)
  assert.doesNotMatch(flat, /apiKey|Bearer|sk-/)
})

test("译文面板在原文改动后显示失效段落并声明不复用旧译文", async () => {
  const staleSnapshot = {
    ...baseSnapshot,
    stale: 2,
    done: 1,
    total: 3,
    blocks: {
      "chunk-1": { id: "chunk-1", status: "done", translation: "译文" },
      "chunk-2": { id: "chunk-2", status: "stale", translation: "旧译文" },
    },
  }
  const blocks = [
    { id: "chunk-1", original: "正文一", kind: "text" },
    { id: "chunk-2", original: "正文二（已改）", kind: "text" },
    { id: "chunk-3", original: "正文三", kind: "text" },
  ]
  const runtime = renderStatus({
    session: makeSession("anthropic", staleSnapshot, blocks),
    snapshot: staleSnapshot,
  })
  const collapsed = JSON.stringify(runtime.tree())
  assert.match(collapsed, /失效 2（旧译文不会静默复用）/)
  findButtonTitle(runtime.tree(), "译名、摘要与术语").props.action()
  await runtime.settle()
  const flat = JSON.stringify(runtime.tree())
  assert.match(flat, /将向Anthropic请求翻译/)
  assert.match(flat, /个原文段落没有对应译文块，已回退为按块对照（非逐句对齐）/)
})

/* ───────────────────── 二、导出闸门：stale 真的阻止复用 ───────────────────── */

function snapshotWithStale() {
  return {
    novelId: 1,
    targetLanguage: "zh-Hans",
    mode: "translated",
    running: false,
    blocks: {
      "chunk-1": { id: "chunk-1", status: "done", translation: "译文一" },
      "chunk-2": { id: "chunk-2", status: "stale", translation: "旧译文二" },
    },
    done: 2,
    total: 2,
    failed: 0,
    phase: "idle",
    summaryStatus: "ready",
    glossaryStatus: "ready",
    translatedTitle: "译名",
    translatedCaption: "译简介",
    glossary: "",
    glossaryCount: 0,
    seriesGlossaryCount: 0,
    stale: 1,
    glossaryLocked: false,
    thinkingNotice: "",
  }
}

test("原文/配置改动后旧译文不得复用导出：单语与双语导出都被闸门拦下", () => {
  const snapshot = snapshotWithStale()
  const issue = novelExport.novelTranslationExportIssue(snapshot, true)
  assert.ok(issue, "stale 段落必须阻止导出")
  assert.match(issue, /1 个段落的原文或模型配置已变化/)
  assert.match(novelExport.bilingualExportIssue(snapshot, false), /原文或模型配置已变化/)

  // 即使绕过闸门，失效率先于完成状态生效：失效块不会作为 done 复用
  const chunks = [
    { type: "text", id: "chunk-1", text: "正文一" },
    { type: "text", id: "chunk-2", text: "正文二" },
  ]
  assert.equal(novelExport.buildTranslatedNovelSource(chunks, snapshot), null)
  assert.equal(novelExport.buildBilingualNovelSource(chunks, snapshot), null)

  // 正向对照：同一结构在无失效段落（全部 done）时可以导出
  const clean = {
    ...snapshot,
    blocks: {
      "chunk-1": { id: "chunk-1", status: "done", translation: "译文一" },
      "chunk-2": { id: "chunk-2", status: "done", translation: "译文二" },
    },
    stale: 0,
  }
  assert.equal(novelExport.novelTranslationExportIssue(clean, true), null)
  assert.match(novelExport.buildTranslatedNovelSource(chunks, clean), /译文二/)
})

test("导出闸门接线：单篇与系列导出都先校验译文完整性", () => {
  const detail = readSource("Pix-Scripting/src/ui/NovelDetail.tsx")
  assert.match(detail, /novelTranslationExportIssue\(translation, Boolean\(cleanedCaption\)\)/)
  const series = readSource("Pix-Scripting/src/downloader/seriesDownloader.ts")
  assert.match(series, /novelTranslationExportIssue\(snapshot, Boolean\(caption\)\)/)
  // 三处单篇导出路径（EPUB 译文/双语、TXT 译文）都经过闸门
  assert.ok((detail.match(/resolveTranslatedExport\(/g) ?? []).length >= 3)
})

/* ───────────────────── 三、离线保存入口接线 ───────────────────── */

test("系列离线保存入口存在且使用真实落盘实现与真实图片下载边界", () => {
  const series = readSource("Pix-Scripting/src/ui/seriesView.tsx")
  assert.match(series, /saveNovelSeriesOffline\(\{/)
  assert.match(series, /loadBytes: \(url\) => loadImage\(url, -1000\)/)
  assert.match(series, /resolveIllustUrl: async \(illustId, pageIndex\)/)
  assert.match(series, /expectedEpisodeCount/)
  assert.match(series, /enforceOfflineLibraryCapacity\(\)/)
  assert.match(series, /hasOfflineEpisode\(novel\.id\)/)
  // 三个可用入口：底部操作区 + 分栏工具栏菜单 + iPad 菜单，另有函数定义
  assert.ok((series.match(/handleSaveSeriesOffline/g) ?? []).length >= 4)
  assert.ok((series.match(/保存系列离线/g) ?? []).length >= 3)
  assert.match(series, /seriesOfflineSaving \? "停止保存离线"/)
  assert.match(series, /seriesOfflineStatus/)
})

test("单篇离线保存把插图字节真实复制进书库，并如实汇总结果", () => {
  const detail = readSource("Pix-Scripting/src/ui/NovelDetail.tsx")
  assert.match(detail, /buildOfflineImageTasks\(\{/)
  assert.match(detail, /resolveIllustUrl: resolveOfflineIllustUrl/)
  assert.match(detail, /persistOfflineImages\(\{[\s\S]{0,200}loadBytes: \(url\) => loadImage\(url, -1000\)/)
  assert.match(detail, /offlineImageSummaryText\(summary\)/)
  // 不得再用「有地址就算 ok」的旧口径统计图片完整性
  assert.doesNotMatch(detail, /status: url \? "ok" : "failed"/)
})

test("正文阅读器离线优先：先读离线字节，再走网络，并把阅读中拿到的图片补进书库", () => {
  for (const file of ["Pix-Scripting/src/ui/NovelReader.tsx", "Pix-Scripting/src/ui/NovelImmersiveReader.tsx"]) {
    const source = readSource(file)
    const offlineLookup = source.indexOf("offlineImagePathMap(")
    const offlineUse = source.indexOf("const offlinePath = offlineImagePaths[chunk.id]")
    // 仅在本篇取图路径内比较顺序（文件其它位置也有 loadImage 调用）
    const networkFetch = source.indexOf("loadImage(url, -1000)", offlineUse)
    assert.ok(offlineLookup > 0, `${file} 必须读取离线插图路径表`)
    assert.ok(offlineUse > offlineLookup, `${file} 必须在取图前查离线路径`)
    assert.ok(networkFetch > offlineUse, `${file} 的离线命中必须先于网络下载`)
    assert.match(source, /completePendingOfflineImage\(/)
    assert.match(source, /if \(!url \|\| imageCacheRef\.current\[chunk\.id\]\?\.dataUrl\)( return| continue)/)
  }
})

test("沉浸阅读器断网换篇走离线书库并如实标注", () => {
  const source = readSource("Pix-Scripting/src/ui/NovelImmersiveReader.tsx")
  assert.match(source, /readOfflineEpisode\(targetNovelId\)/)
  assert.match(source, /synthesizeOfflineNovelDetail\(offlineRecord/)
  assert.match(source, /offlineFallback \? "离线阅读：本话正文来自离线书库" : null/)
  assert.match(source, /setActiveText\(newText\)/)
  assert.match(source, /const newText = viewerText \|\| offlineRecord\?\.text \|\| ""/)
})
