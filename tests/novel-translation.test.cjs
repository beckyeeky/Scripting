const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const crypto = require("node:crypto")
const ts = require("typescript")

function loadModule(file, mocks, globals = {}) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, { fileName: absolute, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    URL, ...globals,
  }, { filename: absolute })
  return module.exports
}

function loadExportedFunction(file, name, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const declaration = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
  assert.ok(declaration, `${name} 未找到`)
  const js = ts.transpileModule(declaration.getText(ast).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(`${js}\n${name}`, globals)
}

const thinkingPath = "Pix-Scripting/src/api/aiAdapters/translationThinking.ts"
const thinking = loadModule(thinkingPath, {
  "../../store/customAI": { getEffectiveGeneralEndpoint: (config) => config.endpoint },
})

function control(protocol, endpoint, model) {
  const value = thinking.translationThinkingControl({ protocol, endpoint, model })
  return { status: value.status, payload: JSON.parse(JSON.stringify(value.payload)) }
}

test("只对确认支持的模型发送关闭思考参数", () => {
  assert.deepEqual(control("openai-chat", "https://api.deepseek.com", "deepseek-flash"),
    { status: "disabled", payload: { thinking: { type: "disabled" } } })
  assert.deepEqual(control("openai-responses", "https://api.deepseek.com", "deepseek-flash"),
    { status: "disabled", payload: { reasoning: { effort: "none" } } })
  assert.deepEqual(control("openai-chat", "https://api.openai.com", "gpt-5.2"),
    { status: "disabled", payload: { reasoning_effort: "none" } })
  assert.deepEqual(control("openai-chat", "https://api.openai.com", "gpt-5"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("openai-chat", "https://api.openai.com", "gpt-5.2-pro"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("openai-chat", "https://openrouter.ai", "deepseek/deepseek-r1"),
    { status: "disabled", payload: { reasoning: { enabled: false } } })
  assert.deepEqual(control("gemini", "https://generativelanguage.googleapis.com", "gemini-2.5-flash"),
    { status: "disabled", payload: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } } })
  assert.deepEqual(control("gemini", "https://generativelanguage.googleapis.com", "gemini-2.5-pro"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("gemini", "https://generativelanguage.googleapis.com", "gemini-2.5-flash-image"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-opus-5"),
    { status: "disabled", payload: { thinking: { type: "disabled" } } })
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-opus-5-5"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("openai-chat", "https://api.deepseek.com.evil.test", "deepseek-flash"),
    { status: "unavailable", payload: {} })
})

async function adapterPayload(file, method, config, disableThinking = true) {
  let payload
  const parser = () => ({ text: "译文", reasoning: "", images: [], done: true })
  const adapter = loadModule(`Pix-Scripting/src/api/aiAdapters/${file}.ts`, {
    scripting: { fetch: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true } } },
    "../../store/customAI": {
      cleanAIEndpoint: (value) => value,
      getEffectiveGeneralEndpoint: (value) => value.endpoint,
    },
    "./sseParser": {
      createLinkedAbortController: () => ({ controller: new AbortController(), cleanup() {} }),
      parseSSEStream: async (_response, onMessage) => onMessage({ data: "{}", event: "message" }),
    },
    "./responseParsers": {
      parseOpenAIChatPayload: parser,
      parseOpenAIResponsesPayload: parser,
      parseGeminiPayload: parser,
      parseAnthropicPayload: parser,
    },
    "./translationThinking": thinking,
  })
  await adapter[method](config, { messages: [{ role: "user", content: "翻译" }], disableThinking })
  return payload
}

test("翻译请求实际下发关闭参数，其他 AI 请求不受影响", async () => {
  const base = { apiKey: "secret", noKeyRequired: false, temperature: 0.5 }
  const deepseek = { ...base, protocol: "openai-chat", endpoint: "https://api.deepseek.com", model: "deepseek-flash" }
  const chat = await adapterPayload("openaiChat", "requestOpenAIChat", deepseek)
  assert.deepEqual(chat.thinking, { type: "disabled" })
  const ordinary = await adapterPayload("openaiChat", "requestOpenAIChat", deepseek, false)
  assert.equal(ordinary.thinking, undefined)
  const responses = await adapterPayload("openaiResponses", "requestOpenAIResponses",
    { ...deepseek, protocol: "openai-responses" })
  assert.deepEqual(responses.reasoning, { effort: "none" })
  const gemini = await adapterPayload("gemini", "requestGemini",
    { ...base, protocol: "gemini", endpoint: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" })
  assert.deepEqual(gemini.generationConfig.thinkingConfig, { thinkingBudget: 0 })
  const claude = await adapterPayload("anthropic", "requestAnthropic",
    { ...base, protocol: "anthropic", endpoint: "https://api.anthropic.com", model: "claude-opus-5" })
  assert.deepEqual(claude.thinking, { type: "disabled" })
})

test("长段拆分仍保留换行与 Pixiv 链接占位符", async () => {
  const passage = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    executeUniversalAI: async (request) => request.messages[0].content.split("占位符：\n")[1],
  })
  const link = "[[jumpuri:来源 > https://example.com]]"
  assert.equal(await passage(`前文${link}后文`, { title: "测试" }), `前文${link}后文`)
  const long = `${"甲".repeat(1700)}\n${"乙".repeat(1700)}`
  assert.equal(await passage(long, { title: "测试" }), long)
})

test("WebView 在相同正文块内切换译文和原文，不改块标识", () => {
  const build = loadExportedFunction("Pix-Scripting/src/ui/NovelReader.tsx", "buildNovelTranslationPatchScript", {
    formatPixivRubyToHtml: (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  })
  const block = { id: "chunk-1", html: "<p>原文</p>", getAttribute(name) { return name === "data-chunk-id" ? this.id : null },
    get innerHTML() { return this.html }, set innerHTML(value) { this.html = value },
    getBoundingClientRect: () => ({ left: 0, top: 100 }) }
  const document = { querySelectorAll: () => [block], getElementById: () => block }
  const window = { scrollBy() {} }
  const snapshot = { mode: "translated", blocks: { "chunk-1": { id: "chunk-1", status: "done", translation: "译文 <ok>" } } }
  vm.runInNewContext(build(snapshot, "chunk-1"), { document, window, requestAnimationFrame: (callback) => callback() })
  assert.equal(block.html, '<p class="paragraph">译文 &lt;ok&gt;</p>')
  vm.runInNewContext(build({ ...snapshot, mode: "original" }, "chunk-1"),
    { document, window, requestAnimationFrame: (callback) => callback() })
  assert.equal(block.html, "<p>原文</p>")
  assert.equal(block.id, "chunk-1")
})

function createStoreFixture(options = {}) {
  const files = new Map()
  let uid = "100"
  let model = "model-a"
  let key = "SECRET-DO-NOT-CACHE"
  let translationCalls = 0
  let active = 0
  let maxActive = 0
  let summaryCalls = 0
  const events = []
  const passage = async (text) => {
    events.push(`passage:${text}`)
    translationCalls++
    active++
    maxActive = Math.max(maxActive, active)
    try {
      if (options.translate) return await options.translate(text)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return `译：${text}`
    } finally { active-- }
  }
  const context = async (_title, _text, needs) => {
    if (needs.summary) {
      summaryCalls++
      events.push("summary-start")
      await new Promise((resolve) => setTimeout(resolve, 2))
      events.push("summary-end")
      return { summary: "人物与背景摘要" }
    }
    if (options.glossary) return { glossary: options.glossary(_title) }
    return { glossary: "人物｜Alice｜爱丽丝\n地点｜Town｜城镇" }
  }
  const config = () => ({ general: { protocol: "openai-chat", endpoint: "https://api.deepseek.com",
    model, apiKey: key, temperature: 0.3 } })
  const module = loadModule("Pix-Scripting/src/store/novelTranslation.ts", {
    scripting: { AbortController },
    "../api/aiService": {
      isAIAvailable: () => true, translateNovelPassage: passage,
      generateNovelTranslationContext: context,
      getNovelTranslationThinkingNotice: () => "已请求关闭思考",
    },
    "./customAI": {
      loadCustomAIProfile: config, isCustomAIConfigured: () => true,
      getEffectiveGeneralEndpoint: (value) => value.endpoint,
    },
    "../api/aiAdapters": { resolveGeneralAIConfigRoute: (value) => value },
    "./dataDirectory": { pixivDataDirectory: () => "/cache", resolveEffectiveUID: () => uid },
    "./safeFile": { recoverFile: () => {}, writeTextSafely: (file, value) => files.set(file, value) },
  }, {
    Data: { fromRawString: (value) => Buffer.from(value) },
    Crypto: { sha256: (value) => ({ toHexString: () => crypto.createHash("sha256").update(value).digest("hex") }) },
    FileManager: {
      existsSync: (file) => files.has(file) || [...files.keys()].some((name) => name.startsWith(`${file}/`)),
      readAsStringSync: (file) => files.get(file),
      readDirectorySync: (dir) => [...files.keys()].filter((name) => name.startsWith(`${dir}/`)).map((name) => name.slice(dir.length + 1)),
      isDirectorySync: () => false,
      statSync: (file) => ({ size: files.get(file).length }),
      removeSync: (file) => files.delete(file),
    },
  })
  return { module, files, setUID: (value) => uid = value, setModel: (value) => model = value,
    setKey: (value) => key = value, getCalls: () => translationCalls,
    getMaxActive: () => maxActive, getSummaryCalls: () => summaryCalls, getEvents: () => events }
}

test("摘要先于双请求并发，缓存按账号/模型/原文隔离且不保存密钥", async () => {
  const f = createStoreFixture()
  const input = { novelId: 7, title: "第一话", text: "Alice in Town", seriesId: 99,
    blocks: [{ id: "a", text: "Alice" }, { id: "b", text: "Town" }, { id: "c", text: "next" }] }
  const session = f.module.getNovelTranslationSession(input)
  await session.start()
  assert.equal(session.getSnapshot().done, 3)
  assert.equal(session.getSnapshot().summaryStatus, "ready")
  assert.equal(session.getSnapshot().glossaryCount, 2)
  assert.equal(f.getSummaryCalls(), 1)
  assert.equal(f.getMaxActive(), 2)
  assert.ok(f.getEvents().indexOf("summary-end") < f.getEvents().findIndex((event) => event.startsWith("passage:")))
  const saved = f.files.get("/cache/NovelTranslations/users/100/7.json")
  assert.ok(saved)
  assert.equal(saved.includes("SECRET-DO-NOT-CACHE"), false)
  f.module.discardNovelTranslationSessions()
  assert.equal(f.module.getNovelTranslationSession(input).getSnapshot().done, 3)
  f.setUID("200")
  assert.equal(f.module.getNovelTranslationSession(input).getSnapshot().done, 0)
  f.setUID("100")
  f.setModel("model-b")
  const differentModel = f.module.getNovelTranslationSession(input).getSnapshot()
  assert.equal(differentModel.done, 0)
  assert.equal(differentModel.seriesGlossaryCount, 0)
  f.setModel("model-a")
  const changed = { ...input, text: "Alice in Town revised", blocks: [{ id: "a", text: "Alice" }, { id: "b", text: "Town!" }] }
  const revised = f.module.getNovelTranslationSession(changed).getSnapshot()
  assert.equal(revised.blocks.a.status, "done")
  assert.equal(revised.blocks.b.status, "pending")
  assert.equal(revised.summaryStatus, "pending")
  assert.equal(f.getCalls(), 3)
})

test("系列既有译名优先，清理仅删除当前账号缓存", async () => {
  const f = createStoreFixture({ glossary: (title) => title === "第二话"
    ? "人物｜Alice｜艾莉丝\n地点｜Castle｜城堡" : "人物｜Alice｜爱丽丝\n地点｜Town｜城镇" })
  const input = { novelId: 1, title: "第一话", text: "Alice in Town", seriesId: 77,
    blocks: [{ id: "a", text: "Alice" }] }
  await f.module.getNovelTranslationSession(input).start()
  const second = { ...input, novelId: 2, title: "第二话", text: "Alice returns" }
  const next = f.module.getNovelTranslationSession(second)
  assert.equal(next.getSnapshot().seriesGlossaryCount, 2)
  await next.start()
  assert.match(next.getSnapshot().glossary, /Alice｜爱丽丝/)
  assert.doesNotMatch(next.getSnapshot().glossary, /Alice｜艾莉丝/)
  assert.equal(next.getSnapshot().glossaryCount, 3)
  f.setUID("200")
  await f.module.getNovelTranslationSession(input).start()
  f.setUID("100")
  f.module.clearNovelTranslationCache()
  assert.equal(f.files.has("/cache/NovelTranslations/users/100/1.json"), false)
  assert.equal(f.files.has("/cache/NovelTranslations/users/200/1.json"), true)
})

test("小说系列信息晚于正文到达时，会建立含系列术语的新会话", () => {
  const f = createStoreFixture()
  const input = { novelId: 9, title: "新章节", text: "Alice", blocks: [{ id: "a", text: "Alice" }] }
  const initial = f.module.getNovelTranslationSession(input)
  const withSeries = f.module.getNovelTranslationSession({ ...input, seriesId: 33 })
  assert.notEqual(initial, withSeries)
  assert.equal(withSeries.getSnapshot().glossaryStatus, "pending")
})

test("暂停后迟到结果不入库；继续与单块重试保留其他已完成段落", async () => {
  let release
  const slow = new Promise((resolve) => { release = resolve })
  let slowCalls = 0
  let badCalls = 0
  const f = createStoreFixture({ translate: async (text) => {
    if (text === "slow") {
      slowCalls++
      if (slowCalls === 1) await slow
    }
    if (text === "bad" && ++badCalls === 1) throw new Error("模拟翻译失败")
    return `译：${text}`
  } })
  const input = { novelId: 3, title: "测试", text: "slow bad",
    blocks: [{ id: "a", text: "slow" }, { id: "b", text: "bad" }] }
  const session = f.module.getNovelTranslationSession(input)
  const firstRun = session.start(["a"])
  for (let attempt = 0; attempt < 100 && session.getSnapshot().blocks.a.status !== "running"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.equal(session.getSnapshot().blocks.a.status, "running")
  session.pause()
  release()
  await firstRun
  assert.equal(session.getSnapshot().blocks.a.status, "pending")
  assert.equal(session.getSnapshot().done, 0)
  await session.start()
  assert.equal(session.getSnapshot().blocks.a.status, "done")
  assert.equal(session.getSnapshot().blocks.b.status, "error")
  await session.retry("b")
  assert.equal(session.getSnapshot().done, 2)
  assert.equal(session.getSnapshot().failed, 0)
  assert.equal(slowCalls, 2)
})
