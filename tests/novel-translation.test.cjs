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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
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
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-sonnet-5-5"),
    { status: "disabled", payload: { thinking: { type: "between_tools" } } })
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-opus-5-5"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-fable-5"),
    { status: "unavailable", payload: {} })
  assert.deepEqual(control("anthropic", "https://api.anthropic.com", "claude-opus-4-8"),
    { status: "disabled", payload: {} })
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
  const sonnet = await adapterPayload("anthropic", "requestAnthropic",
    { ...base, protocol: "anthropic", endpoint: "https://api.anthropic.com", model: "claude-sonnet-5-5" })
  assert.deepEqual(sonnet.thinking, { type: "between_tools" })
})

test("长段拆分仍保留换行与 Pixiv 链接占位符", async () => {
  const passage = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: (target) => target === "en" ? "natural English" : "简体中文",
    validateNovelTranslation() {},
    executeUniversalAI: async (request) => request.messages[0].content.split("占位符：\n")[1],
  })
  const link = "[[jumpuri:来源 > https://example.com]]"
  assert.equal(await passage(`前文${link}后文`, { title: "测试" }), `前文${link}后文`)
  const long = `${"甲".repeat(1700)}\n${"乙".repeat(1700)}`
  assert.equal(await passage(long, { title: "测试" }), long)
  const blankLines = `${"甲".repeat(1700)}\n\n\n${"乙".repeat(1700)}`
  assert.equal(await passage(blankLines, { title: "测试" }), blankLines)
  const crossingLink = `${"甲".repeat(1790)}[[jumpuri:来源 > https://example.com]]${"乙".repeat(1000)}`
  assert.equal(await passage(crossingLink, { title: "测试" }), crossingLink)
  const requested = []
  const sentencePassage = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: (target) => target === "en" ? "natural English" : "简体中文",
    validateNovelTranslation() {},
    executeUniversalAI: async (request) => {
      const source = request.messages[0].content.split("占位符：\n")[1]
      requested.push(source)
      return source
    },
  })
  const sentence = `${"甲".repeat(1000)}。${"乙".repeat(2000)}`
  assert.equal(await sentencePassage(sentence, { title: "测试" }), sentence)
  assert.equal(requested[0], `${"甲".repeat(1000)}。`)
})

test("链接占位符重复或错序时拒绝译文，避免破坏原文导航", async () => {
  const wrong = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: () => "简体中文",
    validateNovelTranslation() {},
    executeUniversalAI: async () => "__PIXIV_LINK_1__ __PIXIV_LINK_0__",
  })
  await assert.rejects(wrong("[[jumpuri:甲 > https://example.com/a]] [[jumpuri:乙 > https://example.com/b]]",
    { title: "测试" }), /链接占位符/)
  const duplicate = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: () => "简体中文",
    validateNovelTranslation() {},
    executeUniversalAI: async () => "__PIXIV_LINK_0__ __PIXIV_LINK_0__",
  })
  await assert.rejects(duplicate("[[jumpuri:甲 > https://example.com/a]]", { title: "测试" }), /链接占位符/)
  const invented = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: () => "简体中文",
    validateNovelTranslation() {},
    executeUniversalAI: async () => "__PIXIV_LINK_0__ __PIXIV_LINK_9__",
  })
  await assert.rejects(invented("[[jumpuri:甲 > https://example.com/a]]", { title: "测试" }), /原文不存在/)
})

test("译文质量检查拦截漏译、模型寒暄与重复输出", () => {
  const validate = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "validateNovelTranslation", {
    translationQualityError: (reason) => { throw new Error(`译文质量检查失败：${reason}`) },
  })
  assert.throws(() => validate("あ".repeat(100), "太短", "zh-CN"), /译文过短/)
  assert.throws(() => validate("This is source text ".repeat(5), "译文：这是结果", "zh-CN"), /额外说明/)
  assert.throws(() => validate("This is source text ".repeat(5), "This is source text ".repeat(5), "zh-CN"), /完全相同/)
  const repeated = ["这是足够长的一行重复译文", "这是足够长的一行重复译文", "这是足够长的一行重复译文"].join("\n")
  assert.throws(() => validate("あ".repeat(120), repeated, "zh-CN"), /重复内容/)
  assert.doesNotThrow(() => validate("あ".repeat(100), "这是自然且完整的中文译文。".repeat(5), "zh-CN"))
})

test("失败重试三分时保护 Pixiv 标记并原样保留接缝", () => {
  const tokenizeNovelPassageForSplit = loadExportedFunction(
    "Pix-Scripting/src/api/aiService.ts", "tokenizeNovelPassageForSplit"
  )
  const splitBoundaryPriority = loadExportedFunction(
    "Pix-Scripting/src/api/aiService.ts", "splitBoundaryPriority"
  )
  const findNovelSplitBoundary = loadExportedFunction(
    "Pix-Scripting/src/api/aiService.ts", "findNovelSplitBoundary", { splitBoundaryPriority }
  )
  const split = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "splitNovelPassageIntoThree", {
    tokenizeNovelPassageForSplit,
    findNovelSplitBoundary,
  })
  const marker = "[[jumpuri:来源 > https://example.com]]"
  const source = `${"甲".repeat(55)}  \n${marker}\n\n${"乙".repeat(55)}。${"丙".repeat(55)}`
  const result = split(source)
  assert.ok(result)
  assert.equal(result.parts.join("|").split(marker).length, 2)
  assert.equal(result.parts[0] + result.separators[0] + result.parts[1] +
    result.separators[1] + result.parts[2], source)
})

test("章节标题和目标语言会进入单块翻译提示词", async () => {
  let prompt = ""
  const passage = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "translateNovelPassage", {
    novelTranslationTargetName: () => "natural, idiomatic English",
    validateNovelTranslation() {},
    executeUniversalAI: async (request) => {
      prompt = `${request.systemPrompt}\n${request.messages[0].content}`
      return "The First Encounter"
    },
  })
  assert.equal(await passage("初めての出会い", {
    title: "作品", kind: "chapter", targetLanguage: "en",
  }), "The First Encounter")
  assert.match(prompt, /章节标题/)
  assert.match(prompt, /natural, idiomatic English/)
})

test("长篇摘要和术语表同时参考开头、中段、结尾", async () => {
  const sampleNovelContext = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "sampleNovelContext")
  const parseTaggedNovelContext = loadExportedFunction(
    "Pix-Scripting/src/api/aiService.ts", "parseTaggedNovelContext"
  )
  const prompts = []
  const systemPrompts = []
  const generate = loadExportedFunction("Pix-Scripting/src/api/aiService.ts", "generateNovelTranslationContext", {
    sampleNovelContext,
    parseTaggedNovelContext,
    novelTranslationTargetName: (target) => target === "en" ? "natural English" : "简体中文",
    executeUniversalAI: async (request) => {
      assert.equal(request.temperature, 0.2)
      prompts.push(request.messages[0].content)
      systemPrompts.push(request.systemPrompt)
      return prompts.length === 1
        ? "<TITLE>测试译名</TITLE><CAPTION>简介译文</CAPTION><SUMMARY>摘要</SUMMARY>"
        : "人物｜Alice｜爱丽丝"
    },
  })
  const long = `${"甲".repeat(5900)}中段人物${"乙".repeat(5900)}结尾人物`
  const context = await generate("测试", "原文简介", long, {
    summary: true, glossary: true, targetLanguage: "en",
  })
  assert.equal(context.translatedTitle, "测试译名")
  assert.equal(context.translatedCaption, "简介译文")
  assert.equal(context.summary, "摘要")
  assert.equal(context.glossary, "人物｜Alice｜爱丽丝")
  assert.equal(prompts.length, 2)
  for (const prompt of prompts) {
    assert.match(prompt, /【开头节选】/)
    assert.match(prompt, /中段人物/)
    assert.match(prompt, /结尾人物/)
    assert.ok(prompt.length < 9300)
  }
  for (const prompt of systemPrompts) assert.match(prompt, /natural English/)
})

test("WebView 在相同正文块内切换译文和原文，不改块标识", () => {
  const build = loadExportedFunction("Pix-Scripting/src/ui/NovelReader.tsx", "buildNovelTranslationPatchScript", {
    formatPixivRubyToHtml: (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  })
  const block = { id: "chunk-1", html: "<p>原文</p>", getAttribute(name) { return name === "data-chunk-id" ? this.id : null },
    get innerHTML() { return this.html }, set innerHTML(value) { this.html = value },
    getBoundingClientRect: () => ({ left: 0, top: 100 }) }
  const chapterTitle = { textContent: "第一章" }
  const chapter = { id: "chapter-1", getAttribute(name) { return name === "data-chunk-id" ? this.id : null },
    querySelector: () => chapterTitle }
  const title = { textContent: "原题" }
  const document = {
    querySelector: () => title,
    querySelectorAll: (selector) => selector === ".text-chunk-block" ? [block]
      : selector === ".chapter-block" ? [chapter] : [],
    getElementById: () => block,
  }
  const window = { scrollBy() {} }
  const snapshot = { mode: "translated", translatedTitle: "译题",
    blocks: {
      "chunk-1": { id: "chunk-1", kind: "text", status: "done", translation: "译文 <ok>" },
      "chapter-1": { id: "chapter-1", kind: "chapter", status: "done", translation: "第一章译文" },
    } }
  vm.runInNewContext(build(snapshot, "chunk-1"), { document, window, requestAnimationFrame: (callback) => callback() })
  assert.equal(block.html, '<p class="paragraph">译文 &lt;ok&gt;</p>')
  assert.equal(title.textContent, "译题")
  assert.equal(chapterTitle.textContent, "第一章译文")
  vm.runInNewContext(build({ ...snapshot, mode: "original" }, "chunk-1"),
    { document, window, requestAnimationFrame: (callback) => callback() })
  assert.equal(block.html, "<p>原文</p>")
  assert.equal(title.textContent, "原题")
  assert.equal(chapterTitle.textContent, "第一章")
  assert.equal(block.id, "chunk-1")
})

test("多页小说默认连续显示，并能为每个正文块建立页码索引", () => {
  const indexPages = loadExportedFunction("Pix-Scripting/src/ui/NovelReader.tsx", "indexNovelChunkPages")
  assert.deepEqual(JSON.parse(JSON.stringify(indexPages([
    { id: "chunk-0", type: "text" },
    { id: "page-2", type: "newpage", page: 2 },
    { id: "chapter-1", type: "chapter" },
    { id: "chunk-3", type: "text" },
  ]))), { "chunk-0": 1, "page-2": 2, "chapter-1": 2, "chunk-3": 2 })
  const settingsSource = fs.readFileSync(path.join(__dirname, "..",
    "Pix-Scripting/src/store/novelReaderSettings.ts"), "utf8")
  assert.match(settingsSource, /pageDisplayMode:\s*"continuous"/)
  assert.match(settingsSource, /translationTargetLanguage:\s*"zh-CN"/)
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
  const passage = async (text, requestOptions) => {
    events.push(`passage:${text}`)
    translationCalls++
    active++
    maxActive = Math.max(maxActive, active)
    try {
      if (options.translate) return await options.translate(text, requestOptions)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return `译：${text}`
    } finally { active-- }
  }
  const context = async (_title, _caption, _text, needs) => {
    if (needs.summary) {
      summaryCalls++
      events.push("summary-start")
      if (options.summary) return { translatedTitle: `译：${_title}`,
        translatedCaption: _caption ? `译：${_caption}` : undefined, summary: await options.summary() }
      await new Promise((resolve) => setTimeout(resolve, 2))
      events.push("summary-end")
      return { translatedTitle: `译：${_title}`,
        translatedCaption: _caption ? `译：${_caption}` : undefined, summary: "人物与背景摘要" }
    }
    if (options.glossary) return { glossary: await options.glossary(_title) }
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
      validateNovelTranslation: options.validateTranslation ?? (() => {}),
      splitNovelPassageIntoThree: options.splitRetry ?? ((text) => {
        const size = Math.floor(text.length / 3)
        if (size < 1) return null
        return { parts: [text.slice(0, size), text.slice(size, size * 2), text.slice(size * 2)],
          separators: ["", ""] }
      }),
    },
    "./customAI": {
      loadCustomAIProfile: config, isCustomAIConfigured: () => true,
      getEffectiveGeneralEndpoint: (value) => value.endpoint,
    },
    "../api/aiAdapters": { resolveGeneralAIConfigRoute: (value) => value },
    "./dataDirectory": { pixivDataDirectory: () => "/cache", resolveEffectiveUID: () => uid },
    "./safeFile": { recoverFile: () => {}, writeTextSafely: (file, value) => {
      if (options.writeError?.(file)) throw new Error("模拟磁盘写入失败")
      files.set(file, value)
    } },
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
  const input = { novelId: 7, title: "第一话", caption: "原文简介", text: "Alice in Town", seriesId: 99,
    blocks: [{ id: "a", text: "Alice" }, { id: "b", text: "Town" }, { id: "c", text: "next" }] }
  const session = f.module.getNovelTranslationSession(input)
  await session.start()
  assert.equal(session.getSnapshot().done, 3)
  assert.equal(session.getSnapshot().summaryStatus, "ready")
  assert.equal(session.getSnapshot().translatedTitle, "译：第一话")
  assert.equal(session.getSnapshot().translatedCaption, "译：原文简介")
  assert.equal(session.getSnapshot().glossaryCount, 2)
  assert.equal(f.getSummaryCalls(), 1)
  assert.equal(f.getMaxActive(), 2)
  assert.ok(f.getEvents().indexOf("summary-end") < f.getEvents().findIndex((event) => event.startsWith("passage:")))
  const saved = f.files.get("/cache/NovelTranslations/users/100/7.json")
  assert.ok(saved)
  assert.equal(saved.includes("SECRET-DO-NOT-CACHE"), false)
  f.module.discardNovelTranslationSessions()
  const restored = f.module.getNovelTranslationSession(input).getSnapshot()
  assert.equal(restored.done, 3)
  assert.equal(restored.translatedTitle, "译：第一话")
  assert.equal(restored.translatedCaption, "译：原文简介")
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

test("简介变化会使同步生成的译名、摘要和正文译文一起失效", async () => {
  const f = createStoreFixture()
  const input = { novelId: 17, title: "标题", caption: "旧简介", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  await f.module.getNovelTranslationSession(input).start()
  const updated = f.module.getNovelTranslationSession({ ...input, caption: "新简介" })
  assert.equal(updated.getSnapshot().done, 0)
  assert.equal(updated.getSnapshot().summaryStatus, "pending")
  await updated.start()
  assert.equal(updated.getSnapshot().translatedCaption, "译：新简介")
  assert.equal(f.getSummaryCalls(), 2)
  assert.equal(f.getCalls(), 2)
})

test("正文完成后仍可单独重试失败的译名、简介与摘要", async () => {
  let attempts = 0
  const f = createStoreFixture({ summary: async () => {
    if (++attempts === 1) throw new Error("模拟摘要失败")
    return "恢复后的摘要"
  } })
  const input = { novelId: 18, title: "标题", caption: "简介", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  const session = f.module.getNovelTranslationSession(input)
  await session.start()
  assert.equal(session.getSnapshot().done, 1)
  assert.equal(session.getSnapshot().summaryStatus, "error")
  await session.start([])
  assert.equal(session.getSnapshot().done, 1)
  assert.equal(session.getSnapshot().summaryStatus, "ready")
  assert.equal(session.getSnapshot().summary, "恢复后的摘要")
  assert.equal(f.getCalls(), 1)
})

test("原块失败后仅三分一次，子段失败不会递归拆分", async () => {
  let calls = 0
  const source = "失敗する長い段落。".repeat(12)
  const success = createStoreFixture({ translate: async (text) => {
    calls++
    if (calls === 1) throw new Error("译文质量检查失败：译文过短")
    return `译：${text}`
  } })
  const input = { novelId: 30, title: "三分重试", caption: "", text: source,
    targetLanguage: "zh-CN", blocks: [{ id: "a", text: source, kind: "text" }] }
  const recovered = success.module.getNovelTranslationSession(input)
  await recovered.start()
  assert.equal(recovered.getSnapshot().done, 1)
  assert.equal(success.getCalls(), 4)

  let childCalls = 0
  const failure = createStoreFixture({ translate: async (text) => {
    childCalls++
    if (childCalls === 1 || childCalls === 3) throw new Error("模拟失败")
    return `译：${text}`
  } })
  const failed = failure.module.getNovelTranslationSession({ ...input, novelId: 31 })
  await failed.start()
  assert.equal(failed.getSnapshot().failed, 1)
  assert.equal(failure.getCalls(), 3)
})

test("章节标题参与翻译，目标语言使用独立缓存文件", async () => {
  const kinds = []
  const f = createStoreFixture({ translate: async (text, options) => {
    kinds.push(`${options.kind}:${options.targetLanguage}`)
    return `译：${text}`
  } })
  const base = { novelId: 32, title: "章节与语言", caption: "", text: "[chapter: 序章]\nAlice",
    seriesId: null, blocks: [
      { id: "chapter-1", text: "序章", kind: "chapter" },
      { id: "chunk-1", text: "Alice", kind: "text" },
    ] }
  const chinese = f.module.getNovelTranslationSession({ ...base, targetLanguage: "zh-CN" })
  await chinese.start()
  assert.equal(chinese.getSnapshot().done, 2)
  assert.ok(kinds.includes("chapter:zh-CN"))
  assert.ok(f.files.has("/cache/NovelTranslations/users/100/32.json"))

  const english = f.module.getNovelTranslationSession({ ...base, targetLanguage: "en" })
  assert.equal(english.getSnapshot().done, 0)
  await english.start()
  assert.ok(kinds.includes("chapter:en"))
  assert.ok(f.files.has("/cache/NovelTranslations/users/100/32-en.json"))

  f.module.discardNovelTranslationSessions()
  assert.equal(f.module.getNovelTranslationSession({ ...base, targetLanguage: "zh-CN" }).getSnapshot().done, 2)
})

test("升级旧缓存时保留正文译文，只补生成标题和简介", async () => {
  const f = createStoreFixture()
  const input = { novelId: 19, title: "标题", caption: "简介", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  await f.module.getNovelTranslationSession(input).start()
  const cachePath = "/cache/NovelTranslations/users/100/19.json"
  const legacy = JSON.parse(f.files.get(cachePath))
  delete legacy.captionFingerprint
  delete legacy.translatedTitle
  delete legacy.translatedCaption
  f.files.set(cachePath, JSON.stringify(legacy))
  f.module.discardNovelTranslationSessions()
  const migrated = f.module.getNovelTranslationSession(input)
  assert.equal(migrated.getSnapshot().done, 1)
  assert.equal(migrated.getSnapshot().summaryStatus, "pending")
  await migrated.start([])
  assert.equal(migrated.getSnapshot().translatedTitle, "译：标题")
  assert.equal(migrated.getSnapshot().translatedCaption, "译：简介")
  assert.equal(f.getCalls(), 1)
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

test("正文未变但分块结构改变时，新会话使用新块而非旧内存视图", () => {
  const f = createStoreFixture()
  const input = { novelId: 10, title: "分块测试", text: "Alice Town",
    blocks: [{ id: "a", text: "Alice Town" }] }
  const old = f.module.getNovelTranslationSession(input)
  const changed = f.module.getNovelTranslationSession({ ...input,
    blocks: [{ id: "a", text: "Alice" }, { id: "b", text: "Town" }] })
  assert.notEqual(old, changed)
  assert.equal(changed.getSnapshot().total, 2)
  assert.equal(changed.getSnapshot().blocks.a.original, "Alice")
  assert.equal(changed.getSnapshot().blocks.b.original, "Town")
})

test("标题变化使摘要和正文译文失效，防止沿用旧提示词结果", async () => {
  const f = createStoreFixture()
  const input = { novelId: 16, title: "旧标题", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  await f.module.getNovelTranslationSession(input).start()
  const updated = f.module.getNovelTranslationSession({ ...input, title: "新标题" })
  assert.equal(updated.getSnapshot().done, 0)
  assert.equal(updated.getSnapshot().summaryStatus, "pending")
  await updated.start()
  assert.equal(f.getSummaryCalls(), 2)
  assert.equal(f.getCalls(), 2)
  assert.equal(updated.getSnapshot().done, 1)
})

test("同系列章节并发完成时合并术语，不因完成顺序丢词", async () => {
  let releaseFirst
  let firstWaiting
  const waiting = new Promise((resolve) => { firstWaiting = resolve })
  const holdFirst = new Promise((resolve) => { releaseFirst = resolve })
  const f = createStoreFixture({ glossary: async (title) => {
    if (title === "第一话") {
      firstWaiting()
      await holdFirst
      return "人物｜Alice｜爱丽丝"
    }
    return "地点｜Town｜城镇"
  } })
  const first = f.module.getNovelTranslationSession({ novelId: 11, title: "第一话", text: "Alice",
    seriesId: 88, blocks: [{ id: "a", text: "Alice" }] })
  const second = f.module.getNovelTranslationSession({ novelId: 12, title: "第二话", text: "Town",
    seriesId: 88, blocks: [{ id: "a", text: "Town" }] })
  const firstRun = first.start()
  await waiting
  await second.start()
  releaseFirst()
  await firstRun
  const saved = JSON.parse(f.files.get("/cache/NovelTranslations/users/100/series-88.json"))
  assert.match(saved.glossary, /Alice｜爱丽丝/)
  assert.match(saved.glossary, /Town｜城镇/)
  assert.equal(first.getSnapshot().glossaryCount, 2)
})

test("同篇小说改换系列时重新生成术语，不沿用旧系列词表", async () => {
  let glossaryCalls = 0
  const f = createStoreFixture({ glossary: () => ++glossaryCalls === 1
    ? "人物｜Alice｜爱丽丝" : "人物｜Alice｜艾莉丝" })
  const input = { novelId: 13, title: "换系列", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  await f.module.getNovelTranslationSession({ ...input, seriesId: 91 }).start()
  const next = f.module.getNovelTranslationSession({ ...input, seriesId: 92 })
  assert.equal(next.getSnapshot().summaryStatus, "ready")
  assert.equal(next.getSnapshot().glossaryStatus, "pending")
  assert.equal(next.getSnapshot().glossaryCount, 0)
  await next.start(["a"])
  assert.equal(glossaryCalls, 2)
  assert.match(next.getSnapshot().glossary, /Alice｜艾莉丝/)
  assert.doesNotMatch(next.getSnapshot().glossary, /Alice｜爱丽丝/)
})

test("单篇或系列缓存写入失败不阻断正文翻译，并显示数据未落盘提示", async () => {
  for (const failedPath of ["/15.json", "/series-93.json"]) {
    const f = createStoreFixture({ writeError: (path) => path.endsWith(failedPath) })
    const input = { novelId: 15, title: "存储失败", text: "Alice", seriesId: 93,
      blocks: [{ id: "a", text: "Alice" }, { id: "b", text: "Town" }] }
    const session = f.module.getNovelTranslationSession(input)
    await session.start()
    assert.equal(session.getSnapshot().done, 2)
    assert.equal(session.getSnapshot().running, false)
    assert.match(session.getSnapshot().message, /缓存写入失败/)
    assert.equal(f.getCalls(), 2)
  }
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

test("摘要生成中进入后台再恢复时，旧摘要不得覆盖新请求", async () => {
  let releaseOld
  let oldStarted
  const oldReady = new Promise((resolve) => { oldStarted = resolve })
  const oldResult = new Promise((resolve) => { releaseOld = resolve })
  let calls = 0
  const f = createStoreFixture({ summary: () => {
    if (++calls === 1) {
      oldStarted()
      return oldResult
    }
    return "恢复后的摘要"
  } })
  const input = { novelId: 14, title: "恢复测试", text: "Alice",
    blocks: [{ id: "a", text: "Alice" }] }
  const session = f.module.getNovelTranslationSession(input)
  const firstRun = session.start()
  await oldReady
  f.module.pauseAllNovelTranslations()
  assert.equal(session.getSnapshot().running, false)
  assert.equal(session.getSnapshot().summaryStatus, "pending")
  f.module.resumeMinimizedNovelTranslations()
  for (let attempt = 0; attempt < 100 && session.getSnapshot().done === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.equal(session.getSnapshot().done, 1)
  releaseOld("旧摘要")
  await firstRun
  assert.equal(session.getSnapshot().summary, "恢复后的摘要")
  assert.equal(JSON.parse(f.files.get("/cache/NovelTranslations/users/100/14.json")).summary, "恢复后的摘要")
})

test("App 真正进后台时暂停，回前台恢复；脚本最小化时不提前恢复", () => {
  let sceneListener
  let resumeListener
  let minimized = false
  let pauses = 0
  let resumes = 0
  loadModule("Pix-Scripting/index.tsx", {
    scripting: {
      AppEvents: { scenePhase: { addListener(listener) { sceneListener = listener }, removeListener() {} } },
      Navigation: { present: () => new Promise(() => {}) },
      Script: {
        queryParameters: null, widgetParameter: null,
        onResume(listener) { resumeListener = listener }, onMinimize() {}, enableMinimize() {},
        isMinimized: () => minimized, exit() {},
      },
    },
    "./src/ui/appRoot": { RootView() {} },
    "./src/bootstrap": { bootstrapStorage: async () => {}, cleanupAppResources() {},
      flushAllCaches() {}, seedIfRoute() {}, startBackgroundServices() {} },
    "./src/store/historySync": { triggerResumeSync() {} },
    "./src/store/routeNavigation": { requestPixivRoute() {} },
    "./src/downloader/downloadTaskManager": { DownloadTaskManager: { checkPendingSignals() {} } },
    "./src/store/novelTranslation": {
      discardNovelTranslationSessions() {}, pauseAllNovelTranslations() { pauses++ },
      resumeMinimizedNovelTranslations() { resumes++ },
    },
    "./src/api/session": { session: { onAuthChanged: () => () => {} } },
    "./src/store/dataDirectory": { resolveEffectiveUID: () => "100" },
    "./src/store/customAI": { onCustomAIConfigChanged: () => () => {} },
  }, { React: { createElement: () => ({}) } })
  assert.equal(typeof sceneListener, "function")
  sceneListener("background")
  assert.equal(pauses, 1)
  minimized = true
  sceneListener("active")
  assert.equal(resumes, 0)
  resumeListener({ resumeFromMinimized: true })
  assert.equal(resumes, 1)
  minimized = false
  sceneListener("background")
  sceneListener("active")
  assert.equal(pauses, 2)
  assert.equal(resumes, 2)
})
