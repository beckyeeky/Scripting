const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function evaluate(source, file, mocks = {}, globals = {}) {
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    console: { log() {}, warn() {}, error() {} },
    require(id) {
      if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`)
      return mocks[id]
    },
    ...globals,
  }, { filename: file })
  return module.exports
}
const load = (file, mocks = {}, globals = {}) =>
  evaluate(fs.readFileSync(file, "utf8"), file, mocks, globals)

const instantTimers = { setTimeout: (fn) => { fn(); return 0 }, clearTimeout() {} }

// 真实重试／分类实现（仅替换网络边界）
const downloadHelper = load("Pix-Scripting/src/downloader/downloadHelper.ts", {
  "../api/client": { downloadBinary: async () => null, downloadBinaryDetailed: async () => ({ data: null, status: 500, failure: "http" }) },
  "../image/imageLoader": {},
  "../store/settings": {},
}, { ...instantTimers })

const readerFile = "Pix-Scripting/src/ui/NovelReader.tsx"
const readerSource = fs.readFileSync(readerFile, "utf8")
const reader = evaluate(
  readerSource.slice(readerSource.indexOf("export function escapeHtml"), readerSource.indexOf("function getLocalImageDataUrl")),
  readerFile
)
const novelExport = load("Pix-Scripting/src/store/novelExport.ts")

function seriesHarness({
  failures = {},
  emptyText = [],
  transient = {},
  cancelAt = null,
  coverFail = false,
  imagesMissing = [{ key: "9", reason: "HTTP 403" }],
} = {}) {
  const exported = []
  const taskErrors = []
  const taskSummaries = []
  const calls = []
  let cancelled = false
  const novels = [2, 1].map((id) => ({
    id,
    title: `原题${id}`,
    caption: `简介${id}`,
    series: { series_order: id },
    user: { name: "作者" },
  }))
  const sourceText = "[chapter:原章]\n原文正文\n[newpage]\n[uploadedimage:9]"

  const token = {
    isCancelled: false,
    isPaused: false,
    checkOrWait: async () => {
      if (cancelled) {
        const error = new Error("任务已取消")
        error.name = "TaskAbortError"
        throw error
      }
    },
  }

  const mocks = {
    "../api/pixiv": {
      novelSeries: async () => ({ novel_series_detail: { title: "系列" }, novels: novels.slice(0, 1), next_url: "next" }),
      nextNovelSeries: async () => ({ novels: novels.slice(1) }),
      novelViewerData: async (id) => {
        calls.push(id)
        if (cancelAt === id) cancelled = true
        const failure = failures[id]
        if (failure) {
          const remaining = transient[id]
          if (remaining === undefined) throw new Error(failure)
          if (remaining > 0) {
            transient[id] = remaining - 1
            throw new Error(failure)
          }
        }
        if (emptyText.includes(id)) return { text: "", textEmbeddedImages: {} }
        return {
          text: sourceText,
          coverUrl: coverFail ? "https://i.test/cover.jpg" : undefined,
          textEmbeddedImages: { 9: { urls: { original: "https://i.test/ill.jpg" } } },
        }
      },
    },
    "../api/session": { session: { call: (fn) => fn("fixture-token") } },
    "../image/imageLoader": {},
    "../store/settings": {},
    "./cbzExporter": {},
    "./epubExporter": {
      exportNovelToEpub: async (options) => {
        exported.push(options)
        const missingChapters = options.missingChapters ?? []
        options.onIntegrityReport?.({
          expectedChapters: options.expectedChapters ?? options.chapters.length,
          exportedChapters: options.chapters.length,
          missingChapters,
          totalImages: 1,
          exportedImages: imagesMissing.length > 0 ? 0 : 1,
          missingImages: imagesMissing,
          coverRequested: Boolean(options.coverUrl),
          coverExported: !coverFail,
          isPartial: missingChapters.length > 0 || imagesMissing.length > 0,
        })
        return "/fixture/系列.epub"
      },
    },
    "./downloadHelper": downloadHelper,
    "./StageProgressPipeline": {
      StageProgressPipeline: class {
        reportPrepare() {}
        reportDownload() {}
        reportPack() {}
        reportComplete() {}
      },
    },
    "./downloadTaskManager": {
      DownloadTaskManager: {
        submitTask: async (task) => {
          try {
            const result = await task.runner(token, {}, { completedIndices: [] }, () => {})
            taskSummaries.push(result?.summary)
          } catch (error) {
            taskErrors.push(error)
          }
          return "fixture-task"
        },
      },
    },
    "../ui/NovelReader": reader,
    "../api/aiService": { cleanHtmlCaption: (value) => value || "" },
    "../store/novelExport": novelExport,
    "../store/dataDirectory": { resolveEffectiveUID: () => "fixture-user" },
    "../store/novelReaderSettings": { loadNovelReaderSettings: () => ({ translationTargetLanguage: "en" }) },
    "../store/novelTranslation": { getNovelTranslationSession: () => ({ getSnapshot: () => null }) },
  }

  const downloader = load("Pix-Scripting/src/downloader/seriesDownloader.ts", mocks)
  return {
    download: (options) => downloader.downloadEntireNovelSeries(10, "系列", undefined, options),
    exported,
    taskErrors,
    taskSummaries,
    calls,
  }
}

test("单章正文失败时仍导出其余章节，并明确报告缺章与缺图", async () => {
  const harness = seriesHarness({ failures: { 2: "正文请求失败" } })
  const filePath = await harness.download()
  assert.equal(filePath, "/fixture/系列.epub")
  assert.equal(harness.exported.length, 1)
  const options = harness.exported[0]
  assert.deepEqual(Array.from(options.chapters, (chapter) => chapter.id), [1])
  assert.equal(options.expectedChapters, 2)
  assert.deepEqual(
    Array.from(options.missingChapters, (issue) => `${issue.index}|${issue.title}|${issue.reason}`),
    ["2|原题2|正文请求失败"]
  )
  // 任务摘要必须明确报告部分导出，不能给出错误的完整成功提示
  assert.equal(harness.taskSummaries.length, 1)
  assert.match(harness.taskSummaries[0], /部分导出/)
  assert.match(harness.taskSummaries[0], /成功 1\/2 章/)
  assert.match(harness.taskSummaries[0], /第 2 话/)
  assert.match(harness.taskSummaries[0], /缺图 1 张/)
})

test("正文为空的章节按失败记录，不再被静默忽略", async () => {
  const harness = seriesHarness({ emptyText: [2] })
  const filePath = await harness.download()
  assert.equal(filePath, "/fixture/系列.epub")
  const options = harness.exported[0]
  assert.deepEqual(Array.from(options.chapters, (chapter) => chapter.id), [1])
  assert.equal(options.missingChapters.length, 1)
  assert.match(options.missingChapters[0].reason, /正文/)
})

test("瞬时网络故障走有限重试并恢复为完整导出", async () => {
  const harness = seriesHarness({
    failures: { 2: "请求超时，请检查网络后重试" },
    transient: { 2: 1 },
    imagesMissing: [],
  })
  const filePath = await harness.download()
  assert.equal(filePath, "/fixture/系列.epub")
  assert.equal(harness.calls.filter((id) => id === 2).length, 2, "瞬时故障应重试一次")
  const options = harness.exported[0]
  assert.deepEqual(Array.from(options.chapters, (chapter) => chapter.id), [1, 2])
  assert.equal(options.missingChapters.length, 0)
  assert.match(harness.taskSummaries[0], /导出成功/)
  assert.doesNotMatch(harness.taskSummaries[0], /部分导出/)
})

test("权限类失败不做盲目重试", async () => {
  const harness = seriesHarness({ failures: { 2: "该作品受限制，无权访问" } })
  await harness.download()
  assert.equal(harness.calls.filter((id) => id === 2).length, 1)
  assert.equal(harness.exported[0].missingChapters.length, 1)
})

test("取消必须向上传播，绝不把取消当成缺章继续导出", async () => {
  const harness = seriesHarness({ cancelAt: 2 })
  const filePath = await harness.download()
  assert.equal(filePath, null)
  assert.equal(harness.exported.length, 0, "取消后不得生成部分 EPUB")
  assert.equal(harness.taskErrors.length, 1)
  assert.equal(harness.taskErrors[0].name, "TaskAbortError")
})

test("全部章节失败时报错包含预期章节与首个失败原因", async () => {
  const harness = seriesHarness({ failures: { 1: "正文请求失败", 2: "正文请求失败" } })
  const filePath = await harness.download()
  assert.equal(filePath, null)
  assert.equal(harness.exported.length, 0)
  assert.equal(harness.taskErrors.length, 1)
  assert.match(harness.taskErrors[0].message, /无法获取章节正文内容：全部 2 话均失败/)
  assert.match(harness.taskErrors[0].message, /第 1 话《原题1》/)
})
