const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("../node_modules/typescript")

function loadTsModule(absPath) {
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
  const ctx = {
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id.startsWith(".")) {
        const base = path.resolve(path.dirname(absPath), id)
        for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return loadTsModule(cand)
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

const metadataPath = path.resolve(
  __dirname,
  "../src/app/features/novel/novelExportMetadata.ts",
)

/** vm 内创建的对象/数组来自另一 realm，转成本 realm 的普通值再比较 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test("resolveNovelExportMetadata：详情优先，详情缺失才回退路由，最后才是占位作者", () => {
  const {
    resolveNovelExportMetadata,
    NOVEL_EXPORT_FALLBACK_AUTHOR,
  } = loadTsModule(metadataPath)

  const fromDetail = resolveNovelExportMetadata({
    detail: {
      user: { id: 7, name: "  作者甲  " },
      tags: [{ name: "SF" }, { name: "R-18" }, { name: "SF" }, { name: "  " }],
      x_restrict: 0,
    },
    route: { author: "路由作者", tags: ["路由标签"], isR18: false },
  })
  assert.deepEqual(plain(fromDetail), {
    author: "作者甲",
    authorId: 7,
    tags: ["SF", "R-18"],
    isR18: true,
  })

  // 详情存在但没有标签：标签回退到路由；作者仍用详情
  const emptyDetailTags = resolveNovelExportMetadata({
    detail: { user: { id: 8, name: "作者乙" }, tags: [], x_restrict: 0 },
    route: { tags: [" 标签一 ", "标签一", "标签二"] },
  })
  assert.equal(emptyDetailTags.author, "作者乙")
  assert.deepEqual(plain(emptyDetailTags.tags), ["标签一", "标签二"])
  assert.equal(emptyDetailTags.isR18, false)

  // 详情缺失（离线/旧路由）：使用路由携带的真实作者与标签
  const fromRoute = resolveNovelExportMetadata({
    detail: null,
    route: { author: " 路由作者 ", tags: ["标签A", "标签B"], isR18: true },
  })
  assert.deepEqual(plain(fromRoute), {
    author: "路由作者",
    tags: ["标签A", "标签B"],
    isR18: true,
  })
  assert.equal(fromRoute.authorId, undefined)

  // 旧调用完全没带元数据：才回退到旧占位，不编造作者
  const legacy = resolveNovelExportMetadata({})
  assert.deepEqual(plain(legacy), {
    author: NOVEL_EXPORT_FALLBACK_AUTHOR,
    tags: [],
    isR18: false,
  })
  assert.equal(legacy.authorId, undefined)
})

test("isNovelR18 同时识别 x_restrict 与 R-18/R18 标签；normalizeNovelTagNames 去空去重保序", () => {
  const { isNovelR18, normalizeNovelTagNames } = loadTsModule(metadataPath)

  assert.equal(isNovelR18({ x_restrict: 1, tags: [] }), true)
  assert.equal(isNovelR18({ x_restrict: 0, tags: [{ name: "r18" }] }), true)
  assert.equal(isNovelR18({ x_restrict: 0, tags: [{ name: "R-18G" }] }), true)
  assert.equal(isNovelR18({ x_restrict: 0, tags: [{ name: "全年齢" }] }), false)
  assert.equal(isNovelR18(null), false)

  assert.deepEqual(
    plain(normalizeNovelTagNames([" b ", "a", "b", "", null, { name: "c" }, { name: "" }])),
    ["b", "a", "c"],
  )
})

test("novelReader 路由声明可选 author/tags/isR18，兼容旧调用", () => {
  const typesSource = fs.readFileSync(
    path.resolve(__dirname, "../src/app/navigation/types.ts"),
    "utf8",
  )
  const readerBlock = typesSource.slice(
    typesSource.indexOf('name: "novelReader"'),
    typesSource.indexOf("| { name: \"user\""),
  )
  assert.match(readerBlock, /\n\s+author\?: string/)
  assert.match(readerBlock, /\n\s+tags\?: string\[\]/)
  assert.match(readerBlock, /\n\s+isR18\?: boolean/)
  // 全部为可选字段：旧调用不传也能通过类型检查
  assert.ok(!/\n\s+author: string/.test(readerBlock))
  assert.ok(!/\n\s+tags: string\[\]/.test(readerBlock))
  assert.ok(!/\n\s+isR18: boolean/.test(readerBlock))
})

test("详情页打开阅读器与导出都使用真实作者/标签/R18；阅读器不再硬编码 Pixiv", () => {
  const detailSource = fs.readFileSync(
    path.resolve(__dirname, "../src/app/features/novel/NovelDetailScreen.tsx"),
    "utf8",
  )
  const readerSource = fs.readFileSync(
    path.resolve(__dirname, "../src/app/features/novel/NovelReaderScreen.tsx"),
    "utf8",
  )

  // 详情页：进入阅读器时携带元数据
  assert.ok(detailSource.includes("resolveNovelExportMetadata({ detail })"))
  assert.ok(detailSource.includes("author: exportMeta.author"))
  assert.ok(detailSource.includes("tags: exportMeta.tags"))
  assert.ok(detailSource.includes("isR18: exportMeta.isR18"))

  // 详情页导出：EPUB/TXT 都用解析后的作者，不再 `|| "Pixiv"`
  assert.ok(!detailSource.includes('detail?.user?.name || "Pixiv"'))
  assert.ok(!detailSource.includes("isR18: (detail?.x_restrict ?? 0) > 0"))

  // 阅读器：导出读取路由元数据，彻底移除硬编码作者
  assert.ok(readerSource.includes("resolveNovelExportMetadata({ route: props })"))
  assert.ok(readerSource.includes("author: exportMeta.author"))
  assert.ok(readerSource.includes("tags: exportMeta.tags"))
  assert.ok(readerSource.includes("isR18: exportMeta.isR18"))
  assert.ok(!readerSource.includes('author: "Pixiv"'))
  assert.ok(!readerSource.includes('author: "",'))

  // 系列切换时把当前/新章节的元数据继续传下去
  assert.ok(readerSource.includes("author: nextAuthor"))
  assert.ok(readerSource.includes("tags: nextTags"))
  assert.ok(readerSource.includes("isR18: nextIsR18"))
})

test("详情页离线保存同时持久化正文插图，并按真实结果提示", () => {
  const detailSource = fs.readFileSync(
    path.resolve(__dirname, "../src/app/features/novel/NovelDetailScreen.tsx"),
    "utf8",
  )
  const saveBlock = detailSource.slice(
    detailSource.indexOf("const handleSaveOffline"),
    detailSource.indexOf("const handleExport"),
  )
  assert.ok(saveBlock.includes("buildOfflineImageTasks({"))
  assert.ok(saveBlock.includes("persistOfflineImages({"))
  assert.ok(saveBlock.includes("offlineImageSummaryText(summary)"))
  assert.ok(saveBlock.includes("summary.failed > 0"))
  assert.ok(saveBlock.includes("正文已离线"), "正文成功但插图失败时必须诚实区分")
})

test("翻译面板折叠展示 summaryError / glossaryError / alignmentWarnings", () => {
  const sheetSource = fs.readFileSync(
    path.resolve(__dirname, "../src/app/features/novel/NovelTranslationSheet.tsx"),
    "utf8",
  )
  assert.ok(sheetSource.includes("snap?.summaryError"))
  assert.ok(sheetSource.includes("snap?.glossaryError"))
  assert.ok(sheetSource.includes("translation.alignmentWarnings"))
  assert.ok(sheetSource.includes("setShowDetails"))
  assert.ok(sheetSource.includes("showDetails ?"))
})
