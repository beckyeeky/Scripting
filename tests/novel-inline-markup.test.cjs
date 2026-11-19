/**
 * Pixiv 小说行内标记渲染回归
 *
 * 正文里的官方 [b:] / [i:] 标记必须本地渲染成样式，
 * 不能把标记原样显示给读者；同时不得破坏已有的注音与 jumpuri 链接。
 */
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const ROOT = path.join(__dirname, "..")
const MODULE = "Pix-Scripting/src/ui/novelInlineMarkup.ts"

function loadModule() {
  const source = fs.readFileSync(path.join(ROOT, MODULE), "utf8")
  const js = ts.transpileModule(source, {
    fileName: MODULE,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (id) => { throw new Error(`不应有外部依赖：${id}`) },
    console: { log() {}, warn() {}, error() {} },
    JSON, String, Boolean, Array, Object, RegExp, Error,
  }, { filename: path.join(ROOT, MODULE) })
  return module.exports
}

const {
  formatNovelInlineHtml,
  formatNovelInlineXHtml,
  formatNovelInlineText,
  buildNovelStyledContent,
  hasNovelInlineMarkup,
} = loadModule()

test("[b:] 渲染为加粗而不是原样输出", () => {
  const html = formatNovelInlineHtml("[b:『トラップ・ヴォーパルス(Trap Vorpals)』]")
  assert.equal(html, "<strong>『トラップ・ヴォーパルス(Trap Vorpals)』</strong>")
  assert.ok(!html.includes("[b:"))
})

test("装饰标签与前后正文混排", () => {
  const html = formatNovelInlineHtml("前文[b:粗体]后文")
  assert.equal(html, "前文<strong>粗体</strong>后文")
})

test("嵌套的 [b:[i:...]] 正确闭合", () => {
  const html = formatNovelInlineHtml("[b:粗体[i:斜体]仍然]")
  assert.equal(html, "<strong>粗体<em>斜体</em>仍然</strong>")
})

test("非官方标签原样输出，不误当成样式", () => {
  assert.equal(formatNovelInlineHtml("[u:下划线]"), "[u:下划线]")
  assert.equal(formatNovelInlineHtml("[s:删除线]"), "[s:删除线]")
  assert.equal(formatNovelInlineHtml("[big:大]"), "[big:大]")
  assert.equal(hasNovelInlineMarkup("[small:小]"), false)
})

test("注音仍在装饰内部正常渲染", () => {
  const html = formatNovelInlineHtml("[b:[[rb: 漢字 > かんじ ]]]")
  assert.equal(html, "<strong><ruby>漢字<rt>かんじ</rt></ruby></strong>")
})

test("jumpuri 链接可以出现在加粗内部", () => {
  const html = formatNovelInlineHtml("[b:[[jumpuri: 标题 > https://example.com ]]]")
  assert.equal(
    html,
    '<strong><a href="javascript:handleLinkClick(&quot;https://example.com&quot;)">标题</a></strong>'
  )
})

test("正文里的尖括号被转义，不会注入标签", () => {
  const html = formatNovelInlineHtml("[b:<script>alert(1)</script>]")
  assert.ok(!html.includes("<script>"))
  assert.ok(html.includes("&lt;script&gt;"))
})

test("未闭合的标记按普通文本处理，不吞掉后文", () => {
  const html = formatNovelInlineHtml("[b:没有闭合的加粗")
  assert.equal(html, "[b:没有闭合的加粗")
})

test("着重号 [[emphasismark:文字 > ﹅]] 渲染为 text-emphasis", () => {
  const html = formatNovelInlineHtml("[[emphasismark:意識 > ﹅]]")
  assert.equal(
    html,
    '<span class="novel-emphasis" style="text-emphasis: &quot;﹅&quot;; -webkit-text-emphasis: &quot;﹅&quot;;">意識</span>'
  )
})

test("着重号可以嵌在装饰标签内，纯文本模式只保留文字", () => {
  const html = formatNovelInlineHtml("[b:[[emphasismark:意識 > ﹅]]は]") 
  assert.ok(html.startsWith("<strong><span class=\"novel-emphasis\""))
  assert.ok(html.endsWith("</span>は</strong>"))
  assert.equal(formatNovelInlineText("[b:[[emphasismark:意識 > ﹅]]は]"), "意識は")
  assert.equal(buildNovelStyledContent("[[emphasismark:意識 > ﹅]]"), null)
})

test("着重号未给标记时默认用 ﹅", () => {
  const html = formatNovelInlineHtml("[[emphasismark:意識 >]]")
  assert.ok(html.includes("﹅"))
  assert.ok(html.includes("novel-emphasis"))
})

test("普通正文不触发解析，输出与输入一致（已转义）", () => {
  const text = "普通的一句正文，带 [1] 注释。"
  assert.equal(hasNovelInlineMarkup(text), false)
  assert.equal(formatNovelInlineHtml(text), text)
  assert.equal(formatNovelInlineText(text), text)
  assert.equal(buildNovelStyledContent(text), null)
})

test("纯文本模式去掉标记，保留内容与注音括号", () => {
  assert.equal(formatNovelInlineText("[b:加粗]和[[rb: 漢字 > かんじ ]]"), "加粗和漢字(かんじ)")
})

test("原生富文本拆出带样式的分段", () => {
  const content = buildNovelStyledContent("普通[b:加粗]普通")
  // VM 数组/对象具有独立原型，转换到当前 realm 后比较实际数据。
  assert.deepEqual(JSON.parse(JSON.stringify(content)), [
    "普通",
    { content: ["加粗"], bold: true },
    "普通",
  ])
})

test("相邻同样式片段合并，避免碎片化", () => {
  const content = buildNovelStyledContent("[b:甲][b:乙]")
  // VM 数组/对象具有独立原型，转换到当前 realm 后比较实际数据。
  assert.deepEqual(JSON.parse(JSON.stringify(content)), [{ content: ["甲乙"], bold: true }])
})

test("全角与双方括号 [b:]/[i:] 统一解析渲染并保持纯文本与富文本一致", () => {
  assert.equal(hasNovelInlineMarkup("［b：全角加粗］"), true)
  assert.equal(hasNovelInlineMarkup("[[i:双方括号斜体]]"), true)
  assert.equal(formatNovelInlineHtml("［b：全角加粗］"), "<strong>全角加粗</strong>")
  assert.equal(formatNovelInlineHtml("［［i：双全角斜体］］"), "<em>双全角斜体</em>")
  assert.equal(
    formatNovelInlineHtml("[[b:[[rb:漢字 > かんじ]]]]"),
    "<strong><ruby>漢字<rt>かんじ</rt></ruby></strong>"
  )
  assert.equal(formatNovelInlineText("［b：全角］[[i:斜体]]"), "全角斜体")
  assert.deepEqual(JSON.parse(JSON.stringify(buildNovelStyledContent("［b：重点］"))), [
    { content: ["重点"], bold: true },
  ])
})

test("EPUB XHTML 输出使用标准 href 链接并完整保留加粗、斜体与着重号", () => {
  const xhtml = formatNovelInlineXHtml(
    "[[jumpuri:首页 > https://example.com/?a=1&b=2]] [b:加粗] [i:斜体] [[emphasismark:着重 > ﹅]]"
  )
  assert.match(xhtml, /<a href="https:\/\/example\.com\/\?a=1&amp;b=2">首页<\/a>/)
  assert.doesNotMatch(xhtml, /javascript:handleLinkClick/)
  assert.match(xhtml, /<strong>加粗<\/strong>/)
  assert.match(xhtml, /<em>斜体<\/em>/)
  assert.match(xhtml, /class="novel-emphasis"/)
})
