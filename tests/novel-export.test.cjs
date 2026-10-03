const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
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
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: absolute })
  return module.exports
}

const novelExport = loadModule("Pix-Scripting/src/store/novelExport.ts")

function snapshot(overrides = {}) {
  return {
    translatedTitle: "译题",
    translatedCaption: "译介",
    total: 2,
    done: 2,
    failed: 0,
    blocks: {
      "chapter-1": { status: "done", translation: "译章" },
      "chunk-2": { status: "done", translation: "第一段\n第二段" },
    },
    ...overrides,
  }
}

test("只有完整译文才能导出", () => {
  assert.equal(novelExport.novelTranslationExportIssue(null, false), "请先完成本篇小说翻译")
  assert.match(novelExport.novelTranslationExportIssue(snapshot({ done: 1 }), false), /1\/2/)
  assert.match(novelExport.novelTranslationExportIssue(snapshot({ failed: 1 }), false), /1 个段落/)
  assert.match(novelExport.novelTranslationExportIssue(snapshot({ translatedCaption: undefined }), true), /译文简介/)
  assert.equal(novelExport.novelTranslationExportIssue(snapshot(), true), null)
})

test("译文源文本保留章节、分页、插图和跳页结构", () => {
  const chunks = [
    { type: "chapter", id: "chapter-1", title: "原章" },
    { type: "newpage", id: "page-2", page: 2 },
    { type: "text", id: "chunk-2", text: "原文" },
    { type: "uploadedimage", id: "up-9", imageId: "9" },
    { type: "pixivimage", id: "px-123-2", illustId: 123, page: 2 },
    { type: "jump", id: "jump-3", page: 3 },
  ]
  assert.equal(novelExport.buildTranslatedNovelSource(chunks, snapshot()), [
    "[chapter:译章]",
    "[newpage]",
    "第一段\n第二段",
    "[uploadedimage:9]",
    "[pixivimage:123-2]",
    "[jump:3]",
  ].join("\n\n"))
  assert.equal(novelExport.buildTranslatedNovelSource(chunks,
    snapshot({ blocks: { ...snapshot().blocks, "chunk-2": { status: "pending" } } })), null)
})

test("全文复制和 TXT 内容包含作品信息与正文", () => {
  const text = novelExport.buildNovelPlainTextDocument({
    title: "译题", author: "作者", caption: "译介", sourceUrl: "https://example.test/1", text: "正文",
  })
  assert.match(text, /^译题\n\n作者：作者/)
  assert.match(text, /简介：\n译介/)
  assert.match(text, /—— 正文 ——\n\n正文\n$/)
})

test("TXT 导出使用小说目录、安全写入并刷新下载管理器", () => {
  let written
  let notified = 0
  const exporter = loadModule("Pix-Scripting/src/downloader/novelTextExporter.ts", {
    "./directoryResolver": {
      getCategoryDirectory: () => "/documents/Novels",
      sanitizeFileName: (value) => value.replace(/\//g, "_"),
    },
    "./downloadFileManager": { notifyDownloadFilesChanged: () => { notified++ } },
    "../store/safeFile": { writeTextSafely: (file, content) => { written = { file, content } } },
  }, { console })
  const result = exporter.exportNovelToText({ title: "A/B", author: "C", content: "全文" })
  assert.equal(result, "/documents/Novels/A_B_C.txt")
  assert.deepEqual(written, { file: result, content: "全文\n" })
  assert.equal(notified, 1)
  assert.equal(exporter.exportNovelToText({ title: "空", author: "C", content: "   " }), null)
})
