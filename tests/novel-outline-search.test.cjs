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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require(id) { if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`); return mocks[id] },
    ...globals,
  }, { filename: absolute })
  return module.exports
}

const outline = loadModule("Pix-Scripting/src/store/novelOutline.ts")
const anchor = loadModule("Pix-Scripting/src/store/novelAnchor.ts")
const search = loadModule("Pix-Scripting/src/store/novelSearch.ts", { "./novelAnchor": anchor })

function chunks() {
  return [
    { id: "chapter-1", type: "chapter", title: "第一章 月下", page: 1 },
    { id: "chunk-1", type: "text", text: "月光洒在窗台上，她想起那句话。", page: 1 },
    { id: "chunk-2", type: "text", text: "风起了，月光被云遮住。", page: 1 },
    { id: "page-2", type: "newpage", page: 2 },
    { id: "chapter-2", type: "chapter", title: "第二章 归途", page: 2 },
    { id: "chunk-3", type: "text", text: "她在归途上又看见了月光。", page: 2 },
  ]
}

test("目录只由本篇 chapter/newpage 构建", () => {
  const entries = outline.buildEpisodeOutline(chunks())
  // 跨 vm realm 的结构用 JSON 比较，避免原型链差异导致的假失败
  assert.equal(
    JSON.stringify(entries.map((item) => [item.kind, item.title, item.page, item.chunkIndex])),
    JSON.stringify([
      ["chapter", "第一章 月下", 1, 0],
      ["newpage", "", 2, 3],
      ["chapter", "第二章 归途", 2, 4],
    ])
  )
  assert.equal(outline.hasUsableOutline(entries), true)
  assert.equal(outline.hasUsableOutline([]), false)
  assert.equal(outline.hasUsableOutline(null), false)
})

test("目录不会混入系列其它话的条目", () => {
  const episodeOutline = outline.buildEpisodeOutline(chunks())
  // 系列其它话的块（不属于本篇）——即便存在也不得出现在本篇目录中
  const foreignChunkIds = ["chapter-f1", "page-f9", "chunk-f3"]
  assert.equal(outline.outlineLeaksSeriesContent(episodeOutline, foreignChunkIds), false)
  assert.equal(
    outline.outlineLeaksSeriesContent(
      [...episodeOutline, { id: "chapter-f1", kind: "chapter", title: "番外", page: 3, chunkIndex: 9 }],
      foreignChunkIds
    ),
    true
  )
  const series = outline.buildSeriesEpisodeList([
    { novelId: 2, title: "第二话", episodeNumber: 2 },
    { novelId: 1, title: "第一话", episodeNumber: 1 },
    { novelId: 0, title: "无效" },
  ])
  assert.equal(series.length, 2)
  assert.equal(series[0].novelId, 2)
  assert.equal(series[1].title, "第一话")
})

test("目录高亮定位到当前阅读块之前最近的条目", () => {
  const entries = outline.buildEpisodeOutline(chunks())
  assert.equal(outline.activeOutlineEntry(entries, { chunkIndex: 2 })?.title, "第一章 月下")
  assert.equal(outline.activeOutlineEntry(entries, { chunkIndex: 4 })?.title, "第二章 归途")
  assert.equal(outline.activeOutlineEntry(entries, { chunkIndex: 5 })?.title, "第二章 归途")
  assert.equal(outline.activeOutlineEntry(entries, { chunkIndex: -1 }), null)
  assert.equal(outline.activeOutlineEntry(entries, { page: 2 })?.title, "第二章 归途")
  assert.equal(outline.outlineEntryLabel({ id: "page-2", kind: "newpage", title: "", page: 2, chunkIndex: 3 }), "第 2 页")
  assert.equal(outline.outlineEntryLabel({ id: "c", kind: "chapter", title: "", page: 1, chunkIndex: 0 }), "未命名章节")
})

test("正文检索返回上下文与顺序键", () => {
  const hits = search.searchNovelChunks(chunks(), "月光", { contextChars: 4 })
  assert.equal(hits.length, 3)
  assert.equal(hits[0].chunkId, "chunk-1")
  assert.equal(hits[0].chunkIndex, 1)
  assert.equal(hits[0].page, 1)
  assert.equal(hits[0].match, "月光")
  assert.equal(hits[0].before, "")
  assert.equal(hits[0].after, "洒在窗台")
  assert.equal(hits[2].chunkId, "chunk-3")
  assert.equal(hits[2].page, 2)
  assert.ok(search.hitOrderKey(hits[0]) < search.hitOrderKey(hits[2]))
})

test("检索命中上一下一循环，并输出摘要", () => {
  const hits = search.searchNovelChunks(chunks(), "月光")
  assert.equal(search.stepHitIndex(-1, hits.length, 1), 0)
  assert.equal(search.stepHitIndex(0, hits.length, 1), 1)
  assert.equal(search.stepHitIndex(hits.length - 1, hits.length, 1), 0)
  assert.equal(search.stepHitIndex(0, hits.length, -1), hits.length - 1)
  assert.equal(search.stepHitIndex(-1, hits.length, -1), hits.length - 1)
  assert.equal(search.stepHitIndex(0, 0, 1), -1)
  assert.match(search.searchSummary(hits, 1, "月光"), /第 2\/3 处命中/)
  assert.match(search.searchSummary([], -1, "不存在"), /未找到/)
  assert.match(search.searchSummary(hits, -1, ""), /输入关键词/)
})

test("命中可转为锚点，正文改动后仍能靠原文片段恢复", () => {
  const list = chunks()
  const hits = search.searchNovelChunks(list, "归途上")
  assert.equal(hits.length, 1)
  const saved = search.anchorFromSearchHit(hits[0], 42, list[hits[0].chunkIndex], "v2-1-abc")
  assert.equal(saved.novelId, 42)
  assert.equal(saved.chunkId, "chunk-3")
  assert.equal(saved.page, 2)
  assert.equal(saved.offset, hits[0].matchStart)
  assert.ok(saved.quote.includes("归途上"))

  const relocated = anchor.resolveNovelAnchor(saved, [
    { id: "chunk-new", type: "text", text: "新的前言。" + list[5].text, page: 2 },
  ], { contentVersion: "v2-999-zzz" })
  assert.equal(relocated.matched, "quote")
  assert.equal(relocated.chunkId, "chunk-new")
})

test("检索范围只含正文与章节块，忽略插图与跳页标记", () => {
  const list = [
    { id: "up-1", type: "uploadedimage", imageId: "月光插图" },
    { id: "px-1", type: "pixivimage", illustId: 999 },
    { id: "jump-1", type: "jump", page: 3 },
    { id: "c1", type: "text", text: "真正的月光在这里。", page: 1 },
  ]
  const hits = search.searchNovelChunks(list, "月光")
  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunkId, "c1")
  assert.equal(search.searchNovelChunks(list, "   ").length, 0)
  assert.equal(search.searchNovelChunks(null, "月光").length, 0)
})

test("检索区分大小写选项与命中上限", () => {
  const list = [{ id: "c1", type: "text", text: "Moon moon MOON", page: 1 }]
  assert.equal(search.searchNovelChunks(list, "moon").length, 3)
  assert.equal(search.searchNovelChunks(list, "moon", { caseSensitive: true }).length, 1)
  assert.equal(search.searchNovelChunks(list, "moon", { maxHits: 2 }).length, 2)
})

test("命中规范化：排序并去重", () => {
  const raw = [
    { chunkId: "b", chunkIndex: 1, page: 1, matchStart: 5, matchEnd: 7, before: "", match: "月光", after: "" },
    { chunkId: "a", chunkIndex: 0, page: 1, matchStart: 2, matchEnd: 4, before: "", match: "月光", after: "" },
    { chunkId: "b", chunkIndex: 1, page: 1, matchStart: 5, matchEnd: 7, before: "", match: "月光", after: "" },
  ]
  const normalized = search.normalizeHits(raw)
  assert.equal(normalized.length, 2)
  assert.equal(normalized.map((hit) => hit.chunkId).join(","), "a,b")
  assert.equal(search.normalizeHits(null).length, 0)
})

test("译文模式下目录与正文检索自动切换为已完成且未失效的译文", () => {
  const list = chunks()
  const translated = {
    mode: "translated",
    translatedTitle: "译文标题",
    blocks: {
      "chapter-1": { id: "chapter-1", status: "done", translation: "第一章 译名" },
      "chunk-1": { id: "chunk-1", status: "done", translation: "星光照在窗台上。" },
      "chunk-2": { id: "chunk-2", status: "done", stale: true, translation: "失效的星光译文" },
      "chunk-3": { id: "chunk-3", status: "pending", translation: "未完成的星光" },
    },
  }

  assert.equal(search.resolveOutlineTitle("原标题", translated), "译文标题")
  assert.equal(search.resolveOutlineTitle("原标题", { ...translated, mode: "original" }), "原标题")

  const resolved = search.resolveSearchableChunks(list, translated)
  const outlineEntries = outline.buildEpisodeOutline(resolved)
  assert.equal(outlineEntries[0].title, "第一章 译名")
  assert.equal(outlineEntries[2].title, "第二章 归途")

  const hits = search.searchNovelChunks(resolved, "星光")
  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunkId, "chunk-1")
  assert.equal(search.searchNovelChunks(resolved, "失效").length, 0)

  const originalResolved = search.resolveSearchableChunks(list, { ...translated, mode: "original" })
  assert.equal(originalResolved, list)
})

test("NovelOutlineSearchSheet 在译文模式检索使用 styledText（无嵌套 Text）", () => {
  let stateSlot
  let cursor = 0
  const stateValues = []
  const hooks = {
    useState(initial) {
      const idx = cursor++
      if (!(idx in stateValues)) stateValues[idx] = typeof initial === "function" ? initial() : initial
      return [stateValues[idx], (next) => {
        stateValues[idx] = typeof next === "function" ? next(stateValues[idx]) : next
      }]
    },
    useMemo(factory) { return factory() },
    useCallback(fn) { return fn },
  }
  const sheetModule = loadModule("Pix-Scripting/src/ui/NovelOutlineSearchSheet.tsx", {
    scripting: {
      Button: "Button", Divider: "Divider", HStack: "HStack", Image: "Image", NavigationStack: "NavigationStack",
      Picker: "Picker", ScrollView: "ScrollView", Spacer: "Spacer", Text: "Text", TextField: "TextField", VStack: "VStack",
      ...hooks,
    },
    "./components/glass": { appGlass: (s) => s, appInteractiveGlass: (s) => s },
    "./components/pageChrome": { sheetDetents: () => [], sheetTopBar: () => ({}) },
    "../platform/haptics": { triggerHaptic() {} },
    "../store/novelOutline": outline,
    "../store/novelSearch": search,
  }, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  })

  const renderTree = () => {
    cursor = 0
    return sheetModule.NovelOutlineSearchSheet({
      title: "原标题",
      chunks: chunks(),
      translation: {
        mode: "translated",
        translatedTitle: "译文篇名",
        blocks: {
          "chapter-1": { id: "chapter-1", status: "done", translation: "第一章 译名" },
          "chunk-1": { id: "chunk-1", status: "done", translation: "星光洒在窗台上。" },
        },
      },
      onJump: () => {},
    })
  }

  let tree = renderTree()
  const collectTexts = (node, list = []) => {
    if (!node || typeof node !== "object") return list
    if (Array.isArray(node)) { node.forEach((n) => collectTexts(n, list)); return list }
    if (node.type === "Text") list.push(node)
    Object.values(node.props ?? {}).forEach((v) => collectTexts(v, list))
    return list
  }
  const initialTexts = collectTexts(tree).map((n) => JSON.stringify(n.props.children)).join("|")
  assert.match(initialTexts, /译文篇名/)
  assert.match(initialTexts, /第一章 译名/)

  // 切换到“搜正文”页签并输入译文关键词
  stateValues[0] = "search"
  stateValues[1] = "星光"
  stateSlot = renderTree()
  const hitTextNodes = collectTexts(stateSlot).filter((n) => n.props.styledText)
  assert.equal(hitTextNodes.length, 1, "命中条目应通过 styledText 高亮")
  const styledContent = JSON.parse(JSON.stringify(hitTextNodes[0].props.styledText.content))
  assert.equal(styledContent[1].content, "星光")
  for (const textNode of collectTexts(stateSlot)) {
    const childTexts = collectTexts(textNode.props.children)
    assert.equal(childTexts.length, 0, "Text 组件内部不得再嵌套 Text 元素")
  }
})
