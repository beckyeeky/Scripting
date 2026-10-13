const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadModule(file, mocks = {}, globals = {}) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
  }, { filename: absolute })
  return module.exports
}

// 重试等待用同步假定时器，保证测试即时完成
const instantTimerGlobals = { setTimeout: (fn) => { fn(); return 0 }, clearTimeout() {} }

/* ------------------------------------------------------------------ *
 * 一、下载失败分类与有限重试：鉴权／权限失败不得盲目重试
 * ------------------------------------------------------------------ */

function loadDownloadHelper(outcomes) {
  const calls = []
  const mod = loadModule("Pix-Scripting/src/downloader/downloadHelper.ts", {
    "../api/client": {
      downloadBinary: async () => null,
      downloadBinaryDetailed: async (url) => {
        calls.push(url)
        if (outcomes.length === 0) return { data: null, status: 500, failure: "http", message: "HTTP 500" }
        return outcomes.shift()
      },
    },
    "../image/imageLoader": {},
    "../store/settings": {},
  }, { ...instantTimerGlobals, console: { log() {} } })
  return { mod, calls }
}

const ok = (url) => ({ data: { size: 4, url }, status: 200, failure: "none" })
const http = (status) => ({ data: null, status, failure: "http", message: `HTTP ${status}` })

test("下载状态码分类：鉴权／权限／缺失不可重试，限流与 5xx 可重试", () => {
  const { mod } = loadDownloadHelper([])
  assert.deepEqual(
    [
      mod.classifyHttpStatus(401).kind,
      mod.classifyHttpStatus(401).retryable,
      mod.classifyHttpStatus(403).kind,
      mod.classifyHttpStatus(403).retryable,
      mod.classifyHttpStatus(404).kind,
      mod.classifyHttpStatus(410).retryable,
      mod.classifyHttpStatus(429).retryable,
      mod.classifyHttpStatus(500).retryable,
      mod.classifyHttpStatus(400).kind,
      mod.classifyHttpStatus(400).retryable,
    ],
    ["auth", false, "permission", false, "notFound", false, true, true, "invalid", false]
  )
})

test("错误分类：取消／账号变更／权限失败不重试，超时与网络错误可重试", () => {
  const { mod } = loadDownloadHelper([])
  const abort = Object.assign(new Error("任务已取消"), { name: "TaskAbortError" })
  const confined = Object.assign(new Error("该作品受限制"), { status: 403 })
  assert.equal(mod.classifyDownloadError(abort).kind, "cancelled")
  assert.equal(mod.classifyDownloadError(abort).retryable, false)
  assert.equal(mod.classifyDownloadError(new Error("账号已变化，请返回原账号后重新导出译文")).kind, "auth")
  assert.equal(mod.classifyDownloadError(confined).kind, "permission")
  assert.equal(mod.classifyDownloadError(new Error("请求超时，请检查网络后重试")).retryable, true)
  assert.equal(mod.classifyDownloadError(new Error("网络错误：连接中断")).retryable, true)
  assert.equal(mod.classifyDownloadError(new Error("无法获取章节正文")).retryable, false)
})

test("单张图片：5xx 允许有限重试，403 只请求一次", async () => {
  const transient = loadDownloadHelper([http(500), ok("https://i.test/a.jpg")])
  const first = await transient.mod.fetchImageBinaryWithResult("https://i.test/a.jpg", 2)
  assert.ok(first.data)
  assert.equal(transient.calls.length, 2)

  const denied = loadDownloadHelper([http(403), http(403)])
  const second = await denied.mod.fetchImageBinaryWithResult("https://i.test/b.jpg", 2)
  assert.equal(second.data, null)
  assert.equal(second.failure.kind, "permission")
  assert.equal(denied.calls.length, 1)
})

test("受限重试执行器：瞬时故障重试成功，权限失败立即抛出", async () => {
  const { mod } = loadDownloadHelper([])
  let attempts = 0
  const value = await mod.runWithLimitedRetry(async () => {
    attempts++
    if (attempts === 1) throw new Error("请求超时，请稍后重试")
    return "ok"
  }, { attempts: 2 })
  assert.equal(value, "ok")
  assert.equal(attempts, 2)

  let deniedAttempts = 0
  await assert.rejects(
    mod.runWithLimitedRetry(async () => {
      deniedAttempts++
      throw Object.assign(new Error("禁止访问"), { status: 403 })
    }, { attempts: 2 }),
    /禁止访问/
  )
  assert.equal(deniedAttempts, 1)
})

/* ------------------------------------------------------------------ *
 * 二、EPUB 缺章缺图：书内标注 + 无悬空引用 + 明确报告
 * ------------------------------------------------------------------ */

function loadNovelExporter(options = {}) {
  const files = new Map()
  const dirs = new Set()
  const published = []
  const reports = []
  const requestedImages = []

  const FileManager = {
    createDirectorySync: (p) => { dirs.add(p) },
    writeAsStringSync: (p, content) => { files.set(p, content) },
    writeAsDataSync: (p, data) => { files.set(p, data) },
    existsSync: (p) => dirs.has(p) || files.has(p),
    removeSync: (p) => { files.delete(p); dirs.delete(p) },
    zip: async (_dir, zipPath) => { files.set(zipPath, "zip-bytes") },
  }

  const downloadHelper = {
    fetchImageBinaryWithResult: async (url) => {
      requestedImages.push(url)
      if (url === options.failingImageUrl) {
        return {
          data: null,
          failure: { kind: "permission", message: "HTTP 403", status: 403, retryable: false },
        }
      }
      return { data: { size: 8, url }, failure: null }
    },
    fetchImageBinaryWithRetry: async () => ({ size: 8 }),
    runConcurrentTasks: async (items, _limit, task) => {
      const results = []
      for (let i = 0; i < items.length; i++) results[i] = await task(items[i], i)
      return results
    },
    yieldToMainThread: async () => {},
    yieldIfExceeded: async (start) => start,
    createThrottledProgress: () => ({ notify() {}, flush() {} }),
    sniffImageDimensions: () => null,
    describeDownloadFailure: (failure) =>
      failure ? `${failure.message}${failure.status ? `（HTTP ${failure.status}）` : ""}` : "未知原因",
  }

  const mod = loadModule("Pix-Scripting/src/downloader/epubExporter.ts", {
    "./downloadHelper": downloadHelper,
    "./directoryResolver": {
      getCategoryDirectory: (category) => (category === "temp" ? "/documents/temp" : "/documents/Novels"),
      sanitizeFileName: (name) => String(name).replace(/[/\\:]/g, "_"),
    },
    "./downloadFileManager": { notifyDownloadFilesChanged() {} },
    "../store/safeFile": {
      publishPreparedFile: (src, dest) => { published.push(dest); files.set(dest, files.get(src)) },
    },
    "../api/session": { session: { call: (fn) => fn("token") } },
    "../api/pixiv": { illustrationDetail: async () => undefined },
    "../image/imageLoader": { imageUrlOf: () => null, pageThumbUrlOf: () => null },
    "../ui/components/formatUtils": {
      htmlToPlainText: (value) => String(value ?? "").replace(/<[^>]*>/g, ""),
    },
  }, {
    FileManager,
    Data: { fromBase64String: () => ({}) },
    WebViewController: function () {
      return { loadHTML: async () => {}, addScriptMessageHandler: async () => {}, dispose() {} }
    },
  })

  return { mod, files, published, reports, requestedImages, dirs }
}

const baseNovel = {
  id: 10,
  title: "系列",
  author: "作者",
  authorId: 42,
  seriesTitle: "系列",
  seriesDescription: "系列简介",
  chapters: [
    { id: 1, title: "第 1 话", text: "正文一\n[uploadedimage:9]\n[newpage]\n正文二", images: { 9: "https://i.test/ill9.jpg" } },
    { id: 2, title: "第 2 话", text: "正文三", images: { 9: "https://i.test/ill9.jpg" } },
  ],
}

test("插图下载失败：不写入悬空资源、书内标注缺图并给出部分导出报告", async () => {
  const harness = loadNovelExporter({ failingImageUrl: "https://i.test/ill9.jpg" })
  let report = null
  const filePath = await harness.mod.exportNovelToEpub({
    ...baseNovel,
    expectedChapters: 3,
    missingChapters: [{ index: 3, title: "第 3 话", reason: "HTTP 403" }],
    onIntegrityReport: (value) => { report = value },
    targetDir: "/documents/Novels",
  })

  assert.ok(filePath, "仍然要产出可读的部分 EPUB")
  assert.match(filePath, /_缺1章/)
  assert.match(filePath, /_缺1图/)
  assert.ok(harness.published.includes(filePath), "打包结果必须发布到目标路径")

  // 失败图片不得落盘，也不得出现在 manifest 或正文里
  const allFiles = [...harness.files.keys()]
  assert.ok(!allFiles.some((file) => file.endsWith("ill_9.jpg")), "失败图片不得落盘")
  const opf = [...harness.files.entries()].find(([key]) => key.endsWith("content.opf"))[1]
  assert.ok(!String(opf).includes("images/ill_9.jpg"), "manifest 不得引用缺失图片")
  assert.match(String(opf), /【部分导出/)

  const firstPageHtml = [...harness.files.entries()]
    .find(([key, value]) => key.endsWith("chap_1_p1.xhtml") && typeof value === "string")[1]
  assert.ok(!firstPageHtml.includes("images/ill_9.jpg"), "正文不得留下悬空图片引用")
  assert.match(firstPageHtml, /本次为部分导出/)
  assert.match(firstPageHtml, /第 3 话《第 3 话》（HTTP 403）/)
  assert.match(firstPageHtml, /9（HTTP 403（HTTP 403））/)

  assert.ok(report, "必须回报完整性报告")
  assert.equal(report.expectedChapters, 3)
  assert.equal(report.exportedChapters, 2)
  assert.equal(report.missingChapters.length, 1)
  assert.equal(report.missingImages.length, 1)
  assert.equal(report.missingImages[0].key, "9")
  assert.equal(report.isPartial, true)
})

test("全部内容获取成功时不出现部分导出标注，保持完整成功语义", async () => {
  const harness = loadNovelExporter({})
  let report = null
  const filePath = await harness.mod.exportNovelToEpub({
    ...baseNovel,
    expectedChapters: 2,
    onIntegrityReport: (value) => { report = value },
    targetDir: "/documents/Novels",
  })
  assert.ok(filePath)
  assert.ok(!filePath.includes("_缺"))
  assert.equal(harness.files.has("/documents/Novels/系列 - 系列.epub"), true)
  const opf = [...harness.files.entries()].find(([key]) => key.endsWith("content.opf"))[1]
  assert.ok(!String(opf).includes("部分导出"))
  assert.match(String(opf), /images\/ill_9\.jpg/)
  const firstPageHtml = [...harness.files.entries()]
    .find(([key, value]) => key.endsWith("chap_1_p1.xhtml") && typeof value === "string")[1]
  assert.ok(!firstPageHtml.includes("本次为部分导出"))
  assert.match(firstPageHtml, /images\/ill_9\.jpg/)
  assert.deepEqual(
    { expected: report.expectedChapters, exported: report.exportedChapters, partial: report.isPartial },
    { expected: 2, exported: 2, partial: false }
  )
})
