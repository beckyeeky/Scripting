/**
 * Pixiv 小说行内语法解析（纯函数，无宿主依赖）
 *
 * 支持（严格对齐 pixiv 官方「pixiv小説記法」）：
 *   [b:文本] 加粗      [i:文本] 斜体
 *   [[rb:汉字 > 假名]] 注音
 *   [[emphasismark:文字 > ﹅]] 着重号（傍点）
 *   [[jumpuri:标题 > URL]] 链接
 *
 * 官方未提供下划线/删除线/字号标签，因此这里不解析 [u:]/[s:]/[big:]/[small:]，
 * 避免把正文里原本应原样显示的方括号内容误当成样式。
 */

export type NovelInlineTagName = "b" | "i"

export type NovelInlineAttributes = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  big?: boolean
  small?: boolean
}

export type NovelStyledRun = {
  text: string
  attrs: NovelInlineAttributes
}

type NovelInlineNode =
  | { type: "text"; value: string }
  | { type: "tag"; name: NovelInlineTagName; children: NovelInlineNode[] }
  | { type: "ruby"; base: string; reading: string }
  | { type: "emphasis"; text: string; mark: string }
  | { type: "link"; title: string; url: string }

const DECORATION_OPEN = /^\[(b|i)\s*:/i
const RUBY_PATTERN = /^\[\[rb:\s*([^\r\n>\]]+?)\s*(?:>|&gt;)\s*([^\]\r\n]+?)\s*\]\]/i
const EMPHASIS_PATTERN = /^\[\[emphasismark:\s*([^\r\n>\]]+?)\s*(?:>|&gt;)\s*([^\]\r\n]*?)\s*\]\]/i
const LINK_PATTERN = /^\[\[jumpuri:\s*([^\r\n>\]]+?)\s*(?:>|&gt;)\s*([^\]\r\n]+?)\s*\]\]/i
const DEFAULT_EMPHASIS_MARK = "﹅"

const HTML_TAGS: Record<NovelInlineTagName, string> = {
  b: "strong",
  i: "em",
}

function lowerStartsWith(source: string, prefix: string): boolean {
  return source.slice(0, prefix.length).toLowerCase() === prefix
}

/** 找到装饰标签对应的收尾 `]`；跳过嵌套标签与 `[[...]]` 双括号块。 */
function findDecorationClose(text: string, start: number): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    if (text[i] === "[") {
      if (text[i + 1] === "[") {
        const end = text.indexOf("]]", i + 2)
        if (end !== -1) {
          i = end + 2
          continue
        }
      }
      const open = DECORATION_OPEN.exec(text.slice(i))
      if (open) {
        depth += 1
        i += open[0].length
        continue
      }
      i += 1
      continue
    }
    if (text[i] === "]") {
      if (depth === 0) return i
      depth -= 1
      i += 1
      continue
    }
    i += 1
  }
  return -1
}

function parseInlineNodes(text: string): NovelInlineNode[] {
  const nodes: NovelInlineNode[] = []
  let buffer = ""
  let i = 0

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", value: buffer })
      buffer = ""
    }
  }

  while (i < text.length) {
    const rest = text.slice(i)

    if (lowerStartsWith(rest, "[[rb:")) {
      const match = RUBY_PATTERN.exec(rest)
      if (match) {
        flush()
        nodes.push({ type: "ruby", base: match[1].trim(), reading: match[2].trim() })
        i += match[0].length
        continue
      }
    }

    if (lowerStartsWith(rest, "[[emphasismark:")) {
      const match = EMPHASIS_PATTERN.exec(rest)
      if (match) {
        flush()
        nodes.push({
          type: "emphasis",
          text: match[1].trim(),
          mark: match[2].trim() || DEFAULT_EMPHASIS_MARK,
        })
        i += match[0].length
        continue
      }
    }

    if (lowerStartsWith(rest, "[[jumpuri:")) {
      const match = LINK_PATTERN.exec(rest)
      if (match) {
        flush()
        nodes.push({ type: "link", title: match[1].trim(), url: match[2].trim() })
        i += match[0].length
        continue
      }
    }

    const open = DECORATION_OPEN.exec(rest)
    if (open) {
      const name = open[1].toLowerCase() as NovelInlineTagName
      const innerStart = i + open[0].length
      const close = findDecorationClose(text, innerStart)
      if (close !== -1) {
        flush()
        nodes.push({ type: "tag", name, children: parseInlineNodes(text.slice(innerStart, close)) })
        i = close + 1
        continue
      }
    }

    buffer += text[i]
    i += 1
  }

  flush()
  return nodes
}

export function escapeNovelHtml(text: string): string {
  if (!text) return ""
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderNodesToText(nodes: NovelInlineNode[]): string {
  let out = ""
  for (const node of nodes) {
    if (node.type === "text") out += node.value
    else if (node.type === "ruby") out += `${node.base}(${node.reading})`
    else if (node.type === "emphasis") out += node.text
    else if (node.type === "link") out += node.title
    else out += renderNodesToText(node.children)
  }
  return out
}

function renderNodesToHtml(nodes: NovelInlineNode[]): string {
  let out = ""
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeNovelHtml(node.value)
      continue
    }
    if (node.type === "ruby") {
      out += `<ruby>${escapeNovelHtml(node.base)}<rt>${escapeNovelHtml(node.reading)}</rt></ruby>`
      continue
    }
    if (node.type === "emphasis") {
      const mark = node.mark.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")
      const style = `text-emphasis: "${mark}"; -webkit-text-emphasis: "${mark}";`
      out += `<span class="novel-emphasis" style="${escapeNovelHtml(style)}">${escapeNovelHtml(node.text)}</span>`
      continue
    }
    if (node.type === "link") {
      const call = `javascript:handleLinkClick(${JSON.stringify(node.url)})`
      out += `<a href="${escapeNovelHtml(call)}">${escapeNovelHtml(node.title)}</a>`
      continue
    }
    const tag = HTML_TAGS[node.name]
    out += `<${tag}>${renderNodesToHtml(node.children)}</${tag}>`
  }
  return out
}

function collectRuns(nodes: NovelInlineNode[], inherited: NovelInlineAttributes, runs: NovelStyledRun[]): void {
  const push = (text: string, attrs: NovelInlineAttributes) => {
    if (!text) return
    const previous = runs[runs.length - 1]
    if (previous && sameAttributes(previous.attrs, attrs)) previous.text += text
    else runs.push({ text, attrs })
  }

  for (const node of nodes) {
    if (node.type === "text") {
      push(node.value, inherited)
    } else if (node.type === "ruby") {
      push(`${node.base}(${node.reading})`, inherited)
    } else if (node.type === "emphasis") {
      push(node.text, inherited)
    } else if (node.type === "link") {
      push(node.title, { ...inherited, underline: true })
    } else {
      const next: NovelInlineAttributes = { ...inherited }
      if (node.name === "b") next.bold = true
      else if (node.name === "i") next.italic = true
      collectRuns(node.children, next, runs)
    }
  }
}

function sameAttributes(a: NovelInlineAttributes, b: NovelInlineAttributes): boolean {
  return !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    !!a.big === !!b.big &&
    !!a.small === !!b.small
}

function hasVisibleAttributes(attrs: NovelInlineAttributes): boolean {
  return !!(attrs.bold || attrs.italic || attrs.underline || attrs.strike)
}

/** 正文里是否出现了需要特殊渲染的标记。 */
export function hasNovelInlineMarkup(rawText: string): boolean {
  if (!rawText) return false
  return /\[(?:b|i)\s*:|\[\[(?:rb|emphasismark|jumpuri):/i.test(rawText)
}

/** 纯文本：去掉装饰标记，注音转为 `汉字(假名)`，链接只保留标题。 */
export function formatNovelInlineText(rawText: string): string {
  if (!rawText || !hasNovelInlineMarkup(rawText)) return rawText
  return renderNodesToText(parseInlineNodes(rawText))
}

/** WebView 正文：装饰标签转为 HTML，注音转为 <ruby>。 */
export function formatNovelInlineHtml(rawText: string): string {
  if (!rawText) return ""
  if (!hasNovelInlineMarkup(rawText)) return escapeNovelHtml(rawText)
  return renderNodesToHtml(parseInlineNodes(rawText))
}

/**
 * 原生 Text 富文本：返回可直接用于 `styledText.content` 的分段数组。
 * 没有任何装饰时返回 null，调用方继续走普通文本路径。
 */
export function buildNovelStyledContent(
  rawText: string
): (string | { content: (string | object)[]; bold?: boolean; italic?: boolean; underlineStyle?: "single"; strikethroughStyle?: "single" })[] | null {
  if (!rawText || !hasNovelInlineMarkup(rawText)) return null
  const runs: NovelStyledRun[] = []
  collectRuns(parseInlineNodes(rawText), {}, runs)
  if (!runs.some((run) => hasVisibleAttributes(run.attrs))) return null

  const content: (string | { content: (string | object)[]; bold?: boolean; italic?: boolean; underlineStyle?: "single"; strikethroughStyle?: "single" })[] = []
  for (const run of runs) {
    if (!hasVisibleAttributes(run.attrs)) {
      content.push(run.text)
      continue
    }
    const styled: { content: (string | object)[]; bold?: boolean; italic?: boolean; underlineStyle?: "single"; strikethroughStyle?: "single" } = {
      content: [run.text],
    }
    if (run.attrs.bold) styled.bold = true
    if (run.attrs.italic) styled.italic = true
    if (run.attrs.underline) styled.underlineStyle = "single"
    if (run.attrs.strike) styled.strikethroughStyle = "single"
    content.push(styled)
  }
  return content
}
