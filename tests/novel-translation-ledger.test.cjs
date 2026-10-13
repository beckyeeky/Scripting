const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const crypto = require("node:crypto")
const ts = require("typescript")

function loadModule(file, mocks = {}, globals = {}) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, { fileName: absolute, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
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

const anchorModule = loadModule("Pix-Scripting/src/store/novelAnchor.ts")
const ledger = loadModule("Pix-Scripting/src/store/novelTranslationLedger.ts", { "./novelAnchor": anchorModule })
const novelExport = loadModule("Pix-Scripting/src/store/novelExport.ts")

/* ───────────────────────── 一、纯逻辑账本 ───────────────────────── */

test("块状态区分 未完成/完成/失败/失效", () => {
  const source = ledger.ledgerSourceFingerprint("原文一")
  assert.equal(ledger.ledgerBlockStatus(null, source), "unfinished")
  assert.equal(ledger.ledgerBlockStatus({ source, translation: "译文" }, source), "done")
  assert.equal(ledger.ledgerBlockStatus({ source, error: "超时" }, source), "failed")
  assert.equal(ledger.ledgerBlockStatus({ source: "别的指纹", translation: "旧译文" }, source), "stale")
  assert.equal(ledger.ledgerBlockStatus({ source, translation: "   " }, source), "unfinished")
  assert.equal(
    ledger.ledgerBlockStatus({ source, translation: "译文", model: "fingerprintA" }, source, "fingerprintB"),
    "stale"
  )
  assert.equal(
    ledger.ledgerBlockStatus({ source, translation: "译文", model: "fingerprintB" }, source, "fingerprintB"),
    "done"
  )
  // 存档没有模型指纹（旧缓存）时不误判失效
  assert.equal(ledger.ledgerBlockStatus({ source, translation: "译文" }, source, "fingerprintB"), "done")
})

test("源正文改动后旧译文失效，重译列表按需生成", () => {
  const blocks = [
    { id: "chunk-1", original: "第一段原文" },
    { id: "chunk-2", original: "第二段原文" },
    { id: "chapter-1", original: "原名", kind: "chapter" },
  ]
  const stored = {
    "chunk-1": { source: ledger.ledgerSourceFingerprint("第一段原文"), translation: "第一段译文" },
    "chunk-2": { source: ledger.ledgerSourceFingerprint("第二段原文已改"), translation: "第二段旧译文" },
    "chapter-1": { source: ledger.ledgerSourceFingerprint("原名"), error: "限流" },
  }
  const counts = ledger.ledgerCounts(blocks, stored)
  assert.equal(counts.total, 3)
  assert.equal(counts.done, 1)
  assert.equal(counts.stale, 1)
  assert.equal(counts.failed, 1)
  assert.equal(counts.unfinished, 0)
  assert.equal(ledger.retryableBlockIds(blocks, stored).join(","), "chunk-2,chapter-1")
  assert.equal(ledger.retryableBlockIds(blocks, stored, undefined, { includeStale: false }).join(","), "chapter-1")
  assert.equal(ledger.ledgerStatusLabel("stale"), "原文已改动，需重新翻译")
  assert.equal(ledger.ledgerStatusLabel("failed"), "失败，可重试")
  assert.match(ledger.ledgerSummaryText(counts), /完成 1\/3/)
  assert.match(ledger.ledgerSummaryText(counts), /失效 1/)
  assert.equal(ledger.ledgerSummaryText({ total: 0, done: 0, failed: 0, unfinished: 0, stale: 0 }), "没有可翻译的段落")

  // 负向：stored 为空时全部视为未完成
  const empty = ledger.ledgerCounts(blocks, null)
  assert.equal(empty.unfinished, 3)
  assert.equal(ledger.retryableBlockIds(blocks, {}).length, 3)
  assert.equal(ledger.ledgerCounts(null, null).total, 0)
})

test("模型/提示词配置指纹不含密钥，配置变化即改变", () => {
  const base = {
    protocol: "openai-chat", endpoint: "https://api.example.com", model: "m1",
    temperature: 0.3, targetLanguage: "zh-CN",
  }
  const a = ledger.promptConfigurationFingerprint(base)
  assert.equal(a, ledger.promptConfigurationFingerprint({ ...base }))
  assert.notEqual(a, ledger.promptConfigurationFingerprint({ ...base, model: "m2" }))
  assert.notEqual(a, ledger.promptConfigurationFingerprint({ ...base, endpoint: "https://api.other.com" }))
  assert.notEqual(a, ledger.promptConfigurationFingerprint({ ...base, promptVersion: 99 }))
  assert.notEqual(a, ledger.promptConfigurationFingerprint({ ...base, targetLanguage: "ja" }))
  assert.notEqual(a, ledger.promptConfigurationFingerprint({ ...base, temperature: 0.7 }))
  assert.equal(ledger.promptConfigurationFingerprint({ ...base, apiKey: "sk-secret" }),
    ledger.promptConfigurationFingerprint({ ...base, apiKey: "sk-other" }))
  assert.equal(typeof a, "string")
  assert.equal(a.length, 8)
})

test("术语表可编辑锁定并合并进 prompt，锁定条目优先", () => {
  const local = "人物｜琳｜琳（Rin）\n地名｜王都｜王都（Kyo）"
  const series = "人物｜琳｜琳（旧译）\n物品｜短杖｜短杖"
  const merged = ledger.mergeLockedGlossary(local, series)
  assert.match(merged, /琳（Rin）/)
  assert.doesNotMatch(merged, /琳（旧译）/)
  assert.match(merged, /短杖/)

  const entries = ledger.parseGlossaryEntries(merged)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].category, "人物")
  assert.equal(entries[0].source, "琳")
  assert.equal(entries[0].target, "琳（Rin）")
  const withNote = ledger.parseGlossaryEntries("人物｜琳｜琳（Rin）｜女主角")
  assert.equal(withNote[0].note, "女主角")
  assert.equal(ledger.serializeGlossaryEntries(withNote), "人物｜琳｜琳（Rin）｜女主角")
  // 非法行被忽略
  assert.equal(ledger.parseGlossaryEntries("只有一段文字").length, 0)
  assert.equal(ledger.parseGlossaryEntries("人物｜" + "x".repeat(120) + "｜y").length, 0)
  assert.equal(ledger.parseGlossaryEntries(null).length, 0)
  assert.equal(ledger.serializeGlossaryEntries(null), "")

  assert.equal(ledger.isGlossaryLocked({ glossary: local, glossaryLocked: true }), true)
  assert.equal(ledger.isGlossaryLocked({ glossary: local, glossaryLocked: false }), false)
  assert.equal(ledger.isGlossaryLocked({ glossary: "  ", glossaryLocked: true }), false)
  assert.equal(ledger.isGlossaryLocked(null), false)
})

test("发送范围提示与供应商标识不含凭据", () => {
  const notice = ledger.translationSendScopeNotice({
    provider: "anthropic",
    title: "标题",
    caption: "简介",
    blocks: [
      { id: "c1", original: "a" },
      { id: "c2", original: "b" },
      { id: "ch1", original: "章", kind: "chapter" },
    ],
    targetLanguage: "zh-CN",
    glossaryCount: 4,
  })
  assert.match(notice, /Anthropic/)
  assert.match(notice, /2 个正文段落/)
  assert.match(notice, /1 个章节标题/)
  assert.match(notice, /术语表 4 条/)
  assert.match(notice, /不含账号序列号、令牌或本地凭据/)
  assert.doesNotMatch(notice, /sk-|Bearer|token=/i)
  assert.equal(ledger.providerLabel("assistant"), "系统智能助手")
  assert.equal(ledger.providerLabel("gemini"), "Google Gemini")
  assert.equal(ledger.providerLabel("unknown"), "自定义接口")
  assert.match(ledger.translationSendScopeNotice({
    provider: "assistant", title: "t", caption: "", blocks: [],
    targetLanguage: "ja", glossaryCount: 0,
  }), /系统智能助手/)
})

test("对齐校验回退：不以逐句对齐对外宣称", () => {
  const blocks = [{ id: "c1", original: "a" }, { id: "c2", original: "b" }]
  assert.equal(ledger.translationAlignmentWarnings(blocks, { c1: { status: "done" }, c2: { status: "done" } }).length, 0)
  const partial = ledger.translationAlignmentWarnings(blocks, { c1: { status: "done" }, c2: { status: "error" } })
  assert.equal(partial.length, 1)
  assert.match(partial.join(" "), /保留原文占位/)
  const missing = ledger.translationAlignmentWarnings(blocks, { c1: { status: "done" } })
  assert.equal(missing.length, 2)
  assert.match(missing.join(" "), /按块对照（非逐句对齐）/)
  assert.equal(ledger.translationAlignmentWarnings(null, null).length, 0)
})

/* ───────────────────────── 二、双语导出 ───────────────────────── */

function snapshot(overrides = {}) {
  return {
    translatedTitle: "译题",
    translatedCaption: "译介",
    total: 2,
    done: 2,
    failed: 0,
    blocks: {
      "chapter-1": { status: "done", translation: "译章" },
      "chunk-2": { status: "done", translation: "第一段\n译文" },
    },
    ...overrides,
  }
}

const bilingualChunks = [
  { type: "chapter", id: "chapter-1", title: "原章" },
  { type: "newpage", id: "page-2", page: 2 },
  { type: "text", id: "chunk-2", text: "原文" },
  { type: "pixivimage", id: "px-1", illustId: 5 },
]

test("双语导出保留结构并成对输出原文与译文", () => {
  const text = novelExport.buildBilingualNovelSource(bilingualChunks, snapshot())
  assert.equal(text, "[chapter:原章 ／ 译章]\n\n[newpage]\n\n原文\n\n第一段\n译文\n\n[pixivimage:5]")
  const translatedFirst = novelExport.buildBilingualNovelSource(bilingualChunks, snapshot(), { translationFirst: true })
  assert.match(translatedFirst, /\[chapter:译章 ／ 原章\]/)
  assert.match(translatedFirst, /第一段\n译文\n\n原文/)
  assert.equal(novelExport.buildBilingualNovelSource(bilingualChunks, null), null)
})

test("双语导出回退：缺少任一段落译文即拒绝导出（不输出半双语文档）", () => {
  const partial = snapshot({ blocks: {
    "chapter-1": { status: "done", translation: "译章" },
    "chunk-2": { status: "error", error: "超时" },
  }, done: 1, failed: 1 })
  assert.equal(novelExport.buildBilingualNovelSource(bilingualChunks, partial), null)
  assert.match(novelExport.bilingualExportIssue(partial, false), /1 个段落/)
  assert.match(novelExport.bilingualExportIssue(null, false), /请先完成/)
  assert.equal(novelExport.bilingualExportIssue(snapshot(), false), null)
  // 章节标题缺失时仍可导出（退化为仅译文标题）
  const withoutChapter = snapshot({ blocks: {
    "chapter-1": { status: "done", translation: "译章" },
    "chunk-2": { status: "done", translation: "译" },
  } })
  assert.match(
    novelExport.buildBilingualNovelSource([{ type: "chapter", id: "chapter-1" }, { type: "text", id: "chunk-2", text: "" }], withoutChapter),
    /\[chapter:译章\]/
  )
})

/* ───────────────────────── 三、接线：译文缓存按指纹失效 ───────────────────────── */

function setupTranslation(userID = 1001, profileOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-translation-"))
  const FileManager = {
    documentsDirectory: root,
    iCloudDocumentsDirectory: `${root}-icloud`,
    appGroupDocumentsDirectory: `${root}-group`,
    isiCloudEnabled: false,
    existsSync: (p) => fs.existsSync(p),
    createDirectorySync: (p) => fs.mkdirSync(p, { recursive: true }),
    readAsStringSync: (p) => fs.readFileSync(p, "utf8"),
    writeAsStringSync: (p, c) => fs.writeFileSync(p, c, "utf8"),
    readDirectorySync: (p) => fs.readdirSync(p),
    statSync: (p) => ({ size: fs.statSync(p).size, type: "NSFileTypeRegular" }),
    removeSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    renameSync: (from, to) => fs.renameSync(from, to),
    isDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
  }
  const profile = {
    protocol: "openai-chat",
    endpoint: "https://api.example.com",
    model: "model-a",
    temperature: 0.2,
    ...profileOverrides,
  }
  const globals = {
    FileManager,
    Data: { fromRawString: (value) => ({ raw: value }) },
    Crypto: {
      sha256: (data) => ({
        toHexString: () => crypto.createHash("sha256").update(data.raw).digest("hex"),
      }),
    },
    AbortController: class {
      constructor() { this.signal = { aborted: false } }
      abort() { this.signal.aborted = true }
    },
  }
  const safeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadModule("Pix-Scripting/src/store/dataDirectory.ts", {
    "../api/session": { session: { userID } },
    "./safeFile": safeFile,
  }, globals)
  const aiService = {
    isAIAvailable: () => true,
    translateNovelPassage: async () => { throw new Error("测试中不得触发真实模型调用") },
    generateNovelTranslationContext: async () => { throw new Error("测试中不得触发真实模型调用") },
    getNovelTranslationThinkingNotice: () => "",
    splitNovelPassageIntoThree: () => null,
    validateNovelTranslation: () => {},
  }
  const customAI = {
    loadCustomAIProfile: () => ({ general: profile }),
    isCustomAIConfigured: () => true,
    getEffectiveGeneralEndpoint: (config) => config.endpoint,
  }
  const translation = loadModule("Pix-Scripting/src/store/novelTranslation.ts", {
    "./novelTranslationLedger": ledger,
    scripting: { AbortController: globals.AbortController },
    "../api/aiService": aiService,
    "./customAI": customAI,
    "../api/aiAdapters": { resolveGeneralAIConfigRoute: (item) => item },
    "./dataDirectory": dataDirectory,
    "./safeFile": safeFile,
  }, globals)
  return { root, translation, profile, globals, safeFile, dataDirectory, customAI, aiService }
}

const input = {
  novelId: 777,
  title: "标题",
  caption: "简介",
  text: "第一段原文。\n\n第二段原文。",
  targetLanguage: "zh-CN",
  seriesId: null,
  blocks: [
    { id: "chunk-1", text: "第一段原文。" },
    { id: "chunk-2", text: "第二段原文。" },
  ],
}

/** 会话构造本身不落盘；先切换一次显示模式以写出缓存骨架（真实使用中亦如此） */
function primeCache(session) {
  session.setMode("translated")
  session.setMode("original")
  return session
}

function cacheFilePath(root, userID = 1001, novelId = 777) {
  return `${root}/Pix-Scripting/NovelTranslations/users/${userID}/${novelId}.json`
}

test("接线：缓存文件按小说与账号落盘，重启后译文可复用", () => {
  const first = setupTranslation()
  const session = primeCache(first.translation.getNovelTranslationSession(input))
  const initial = session.getSnapshot()
  assert.equal(initial.total, 2)
  assert.equal(initial.done, 0)
  assert.equal(initial.mode, "original")

  // 会话初始化即写入缓存骨架（含源指纹与模型指纹）
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(first.root), "utf8"))
  assert.equal(stored.version, 2)
  assert.equal(stored.model.length, 64)
  assert.equal(typeof stored.source, "string")

  // 重启后（同一模型配置）译文应被识别为已完成
  stored.blocks = {
    "chunk-1": { source: stored.blocks["chunk-1"].source, translation: "第一段译文。" },
    "chunk-2": { source: stored.blocks["chunk-2"].source, translation: "第二段译文。" },
  }
  fs.writeFileSync(cacheFilePath(first.root), JSON.stringify(stored), "utf8")
  first.translation.discardNovelTranslationSessions()
  const restarted = first.translation.getNovelTranslationSession(input).getSnapshot()
  assert.equal(restarted.done, 2)
  assert.equal(restarted.blocks["chunk-1"].translation, "第一段译文。")
  assert.equal(restarted.blocks["chunk-1"].status, "done")
})

test("接线：源正文改动或模型配置变化后旧译文失效而非静默复用", () => {
  const first = setupTranslation()
  primeCache(first.translation.getNovelTranslationSession(input))
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(first.root), "utf8"))
  stored.blocks = {
    "chunk-1": { source: stored.blocks["chunk-1"].source, translation: "第一段译文。" },
    "chunk-2": { source: stored.blocks["chunk-2"].source, translation: "第二段译文。" },
  }
  fs.writeFileSync(cacheFilePath(first.root), JSON.stringify(stored), "utf8")

  // 正文被修改：块 id 不变但内容变化
  first.translation.discardNovelTranslationSessions()
  const changedSource = { ...input, text: "第一段原文改。\n\n第二段原文。",
    blocks: [{ id: "chunk-1", text: "第一段原文改。" }, { id: "chunk-2", text: "第二段原文。" }] }
  const afterEdit = first.translation.getNovelTranslationSession(changedSource).getSnapshot()
  assert.equal(afterEdit.blocks["chunk-1"].translation, undefined)
  assert.equal(afterEdit.blocks["chunk-1"].status, "pending")
  assert.equal(afterEdit.blocks["chunk-2"].translation, "第二段译文。") // 未改动的段落仍复用
  assert.equal(afterEdit.done, 1)

  // 模型/提示词配置改变：第二套配置的缓存文件与第一套不同（model 指纹参与路径键）
  const second = setupTranslation()
  primeCache(second.translation.getNovelTranslationSession(input))
  const other = setupTranslation(1001, { model: "model-b" })
  const otherSession = primeCache(other.translation.getNovelTranslationSession(input))
  assert.equal(otherSession.getSnapshot().done, 0)
  const otherStored = JSON.parse(fs.readFileSync(cacheFilePath(other.root), "utf8"))
  assert.equal(otherStored.model.length, 64)
  assert.notEqual(otherStored.model, JSON.parse(fs.readFileSync(cacheFilePath(second.root), "utf8")).model)
})

test("接线：清空缓存不影响离线书库与阅读进度目录", () => {
  const ctx = setupTranslation()
  primeCache(ctx.translation.getNovelTranslationSession(input))
  assert.ok(fs.existsSync(cacheFilePath(ctx.root)))
  const usage = ctx.translation.novelTranslationCacheUsage()
  assert.equal(usage.count, 1)
  assert.ok(usage.bytes > 0)

  // 阅读进度与离线书库属于其它目录，清空译文缓存不得触及
  const progressFile = `${ctx.root}/Pix-Scripting/History/users/1001/novel_progress.json`
  fs.mkdirSync(path.dirname(progressFile), { recursive: true })
  fs.writeFileSync(progressFile, "[]", "utf8")
  const offlineFile = `${ctx.root}/Pix-Scripting/NovelOffline/users/1001/episodes/9.json`
  fs.mkdirSync(path.dirname(offlineFile), { recursive: true })
  fs.writeFileSync(offlineFile, "{}", "utf8")

  ctx.translation.clearNovelTranslationCache()
  assert.equal(fs.existsSync(cacheFilePath(ctx.root)), false)
  assert.equal(ctx.translation.novelTranslationCacheUsage().count, 0)
  assert.ok(fs.existsSync(progressFile))
  assert.ok(fs.existsSync(offlineFile))
})

test("接线负向：翻译请求未经真实网络，会话暂停不产生额外 AI 调用", async () => {
  const ctx = setupTranslation()
  const session = ctx.translation.getNovelTranslationSession(input)
  session.setMode("translated")
  assert.equal(session.getSnapshot().mode, "translated")
  session.pause()
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(ctx.root), "utf8"))
  assert.equal(stored.mode, "translated")
  session.clear()
  assert.equal(session.getSnapshot().done, 0)
  assert.equal(session.getSnapshot().mode, "original")
})

test("接线：源改动后段落计入失效（stale），旧译文不静默复用", () => {
  const ctx = setupTranslation()
  primeCache(ctx.translation.getNovelTranslationSession(input))
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(ctx.root), "utf8"))
  stored.blocks = {
    "chunk-1": { source: stored.blocks["chunk-1"].source, translation: "第一段译文。", model: stored.model },
    "chunk-2": { source: "过期的源指纹", translation: "第二段旧译文", model: stored.model },
  }
  fs.writeFileSync(cacheFilePath(ctx.root), JSON.stringify(stored), "utf8")
  ctx.translation.discardNovelTranslationSessions()

  const session = ctx.translation.getNovelTranslationSession(input)
  const snapshot = session.getSnapshot()
  assert.equal(snapshot.done, 1)
  assert.equal(snapshot.stale, 1)
  assert.equal(snapshot.blocks["chunk-2"].translation, undefined, "失效段落不得复用旧译文")
  assert.equal(snapshot.blocks["chunk-2"].status, "pending")
  assert.deepEqual(session.pendingBlockIds(), ["chunk-2"])
})

test("接线：术语表可编辑锁定，锁定后进入 prompt 且不再自动生成", () => {
  const ctx = setupTranslation()
  const session = ctx.translation.getNovelTranslationSession(input)
  session.setGlossary("人物｜琳｜琳（Rin）", true)
  let snapshot = session.getSnapshot()
  assert.equal(snapshot.glossaryLocked, true)
  assert.equal(snapshot.glossaryCount, 1)
  assert.match(snapshot.glossary, /琳（Rin）/)
  assert.equal(snapshot.glossaryStatus, "ready")

  // 锁定状态随缓存落盘；重启后仍然锁定
  const stored = JSON.parse(fs.readFileSync(cacheFilePath(ctx.root), "utf8"))
  assert.equal(stored.glossaryLocked, true)
  assert.match(stored.glossary, /琳（Rin）/)
  ctx.translation.discardNovelTranslationSessions()
  const restarted = ctx.translation.getNovelTranslationSession(input).getSnapshot()
  assert.equal(restarted.glossaryLocked, true)
  assert.equal(restarted.glossaryCount, 1)

  // 非法/空内容不会造成锁定状态悬空
  session.setGlossary("这不是合法术语行", true)
  snapshot = session.getSnapshot()
  assert.equal(snapshot.glossaryLocked, false)
  assert.equal(snapshot.glossaryStatus, "skipped")
})

test("接线：发送范围与对齐提示不含凭据，且明确按块对照", () => {
  const ctx = setupTranslation()
  const session = ctx.translation.getNovelTranslationSession(input)
  const notice = session.sendScopeNotice("anthropic")
  assert.match(notice, /Anthropic/)
  assert.match(notice, /2 个正文段落/)
  assert.doesNotMatch(notice, /sk-|Bearer|api[_-]?key/i)
  const warnings = session.alignmentWarnings()
  assert.equal(warnings.length, 1)
  assert.match(warnings.join(" "), /保留原文占位/)

  // 原文块与译文块不一一对应时，明确给出按块对照的回退提示
  const mismatch = ledger.translationAlignmentWarnings(
    [{ id: "c1", original: "a" }, { id: "c2", original: "b" }],
    { c1: {} }
  )
  assert.equal(mismatch.length, 2)
  assert.match(mismatch.join(" "), /按块对照（非逐句对齐）/)
})
