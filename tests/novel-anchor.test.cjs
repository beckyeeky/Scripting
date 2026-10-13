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

const anchor = loadModule("Pix-Scripting/src/store/novelAnchor.ts")

function chunks() {
  return [
    { id: "chapter-1", type: "chapter", title: "第一章 开端", page: 1 },
    { id: "chunk-1", type: "text", text: "第一页的第一段文字，包含一个非常独特的句子：月光洒在窗台上。", page: 1 },
    { id: "chunk-2", type: "text", text: "第一页的第二段文字，用于验证块内偏移。", page: 1 },
    { id: "page-2", type: "newpage", page: 2 },
    { id: "chunk-3", type: "text", text: "第二页的段落，尾部有一句结束语。", page: 2 },
  ]
}

const fullText = chunks()
  .map((c) => (c.type === "chapter" ? `[chapter:${c.title}]` : c.type === "newpage" ? "[newpage]" : c.text))
  .join("\n\n")
const currentVersion = anchor.computeNovelContentVersion(fullText)

test("内容版本随正文或解析版本变化", () => {
  const a = anchor.computeNovelContentVersion("同一正文")
  const b = anchor.computeNovelContentVersion("同一正文")
  const c = anchor.computeNovelContentVersion("同一正文！")
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^v2-\d+-[0-9a-f]{8}$/)
  const bumped = anchor.computeNovelContentVersion("同一正文", 3)
  assert.notEqual(a, bumped)
})

test("精确恢复：块、偏移与文本锚点一致时命中 exact", () => {
  const list = chunks()
  const text = list[1].text
  const offset = text.indexOf("月光")
  const saved = anchor.createNovelAnchor({
    novelId: 1, page: 1, chunkId: "chunk-1", chunkIndex: 1, chunkText: text,
    contentVersion: currentVersion, offset,
  })
  assert.equal(saved.quote, "月光洒在窗台上。")
  const resolved = anchor.resolveNovelAnchor(saved, list, { contentVersion: currentVersion })
  assert.equal(resolved.matched, "exact")
  assert.equal(resolved.chunkId, "chunk-1")
  assert.equal(resolved.offset, offset)
  assert.equal(resolved.contentChanged, false)
})

test("正文变化后按文本锚点重新定位（不静默跳回开头）", () => {
  const list = chunks()
  const offset = list[1].text.indexOf("月光")
  const saved = anchor.createNovelAnchor({
    novelId: 1, page: 1, chunkId: "chunk-1", chunkIndex: 1, chunkText: list[1].text,
    contentVersion: currentVersion, offset,
  })
  // 正文被编辑：块 id 变化、目标句前后插入新内容
  const edited = [
    { id: "chapter-a", type: "chapter", title: "第一章 开端", page: 1 },
    { id: "chunk-a", type: "text", text: "新增前言。\n第一页的第一段文字，包含一个非常独特的句子：月光洒在窗台上。", page: 1 },
    { id: "chunk-3", type: "text", text: "第二页的段落，尾部有一句结束语。", page: 2 },
  ]
  const editedVersion = anchor.computeNovelContentVersion(
    edited.map((c) => (c.type === "chapter" ? `[chapter:${c.title}]` : c.text)).join("\n\n")
  )
  const resolved = anchor.resolveNovelAnchor(saved, edited, { contentVersion: editedVersion })
  assert.equal(resolved.matched, "quote")
  assert.equal(resolved.chunkId, "chunk-a")
  assert.equal(resolved.contentChanged, true)
  assert.ok(resolved.offset > 0)
  assert.match(edited[1].text.slice(resolved.offset, resolved.offset + 2), /月光/)
})

test("块 id 丢失且文本锚点找不到时按块序号就近回退", () => {
  const list = chunks()
  const saved = {
    novelId: 1, page: 1, chunkId: "chunk-legacy", chunkIndex: 4,
    contentVersion: "v2-0-deadbeef", updatedAt: 1,
  }
  const resolved = anchor.resolveNovelAnchor(saved, list, { contentVersion: currentVersion })
  assert.equal(resolved.matched, "nearest")
  assert.equal(resolved.chunkId, "chunk-3")
  assert.equal(resolved.contentChanged, true)
})

test("只有旧式 page/chunkId 的记录仍可恢复（向后兼容）", () => {
  const list = chunks()
  const byChunk = anchor.resolveNovelAnchor(
    { novelID: 1, page: 1, chunkId: "chunk-2", updatedAt: 1 },
    list
  )
  assert.equal(byChunk.matched, "chunk")
  assert.equal(byChunk.chunkId, "chunk-2")

  const byPage = anchor.resolveNovelAnchor({ novelID: 1, page: 2, updatedAt: 1 }, list)
  assert.equal(byPage.matched, "page")
  assert.equal(byPage.chunkId, "page-2")
  assert.equal(byPage.page, 2)
})

test("解析结果页号随块所在页返回，空锚点回开头", () => {
  const list = chunks()
  const resolved = anchor.resolveNovelAnchor(
    { novelId: 1, page: 1, chunkId: "chunk-3", updatedAt: 1 },
    list,
    { contentVersion: currentVersion }
  )
  assert.equal(resolved.page, 2)
  const start = anchor.resolveNovelAnchor(null, list, { contentVersion: currentVersion })
  assert.equal(start.matched, "start")
  assert.equal(start.chunkId, null)
  const empty = anchor.resolveNovelAnchor(null, [], {})
  assert.equal(empty.matched, "empty")
})

test("文本锚点支持空白归一化后的模糊命中", () => {
  const list = [{ id: "c1", type: "text", text: "前半句\n月光 洒在窗台上。后半句", page: 1 }]
  const saved = {
    novelId: 1, page: 1, chunkId: "c1", contentVersion: "stale",
    quote: "月光 洒在窗台上。", offset: 0, updatedAt: 1,
  }
  const resolved = anchor.resolveNovelAnchor(saved, list, { contentVersion: currentVersion })
  assert.equal(resolved.matched, "quote")
  assert.ok(resolved.offset >= 0)
  assert.equal(list[0].text.slice(resolved.offset, resolved.offset + 2), "月光")
})

test("恢复提示覆盖全部命中类型", () => {
  assert.match(anchor.describeAnchorMatch("exact"), /上次阅读位置/)
  assert.match(anchor.describeAnchorMatch("quote"), /原文片段/)
  assert.match(anchor.describeAnchorMatch("nearest"), /段落结构/)
  assert.match(anchor.describeAnchorMatch("page"), /页码/)
  assert.equal(anchor.isExactAnchorMatch("exact"), true)
  assert.equal(anchor.isExactAnchorMatch("quote"), false)
})

test("anchorFromProgress 归一化缺省值", () => {
  const value = anchor.anchorFromProgress({ novelID: 7, page: 0, offset: -3, updatedAt: 9 })
  assert.equal(value.novelId, 7)
  assert.equal(value.page, 1)
  assert.equal(value.offset, 0)
  assert.equal(value.updatedAt, 9)
})
