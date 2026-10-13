/**
 * 小说正文检索（纯逻辑）
 *
 * 支持：命中列表（块 + 块内偏移）、上下文片段、上一下一命中循环、命中 → 阅读锚点（跳转并高亮）。
 * 只在正文/章节块内检索，插图与跳页标记不参与，避免产生无法定位的命中。
 */
import { quoteFromText, type AnchorChunkLike, type NovelReadingAnchor } from "./novelAnchor"

export interface NovelSearchHit {
  chunkId: string
  chunkIndex: number
  page: number
  /** 命中区间（块内原始字符偏移） */
  matchStart: number
  matchEnd: number
  /** 上下文：命中前/命中/命中后，供列表显示 */
  before: string
  match: string
  after: string
}

export interface NovelSearchOptions {
  caseSensitive?: boolean
  /** 命中前后各保留多少个字符（默认 18） */
  contextChars?: number
  /** 最多返回多少条命中（默认 200，避免超长正文卡顿） */
  maxHits?: number
}

const DEFAULT_CONTEXT = 18
const DEFAULT_MAX_HITS = 200

function isSearchable(chunk: AnchorChunkLike): boolean {
  return chunk.type === "text" || chunk.type === "chapter"
}

/** 命中文本：正文块用 text，章节块用 title */
function searchableText(chunk: AnchorChunkLike): string {
  return chunk.type === "chapter" ? chunk.title ?? "" : chunk.text ?? ""
}

function pageOf(chunk: AnchorChunkLike, fallback: number): number {
  return typeof chunk.page === "number" && chunk.page > 0 ? chunk.page : fallback
}

/** 在全部正文块中检索关键词，返回带上下文的命中列表 */
export function searchNovelChunks(
  chunks: AnchorChunkLike[] | null | undefined,
  query: string,
  options: NovelSearchOptions = {}
): NovelSearchHit[] {
  const list = Array.isArray(chunks) ? chunks : []
  const keyword = typeof query === "string" ? query : ""
  if (!keyword.trim() || list.length === 0) return []

  const caseSensitive = Boolean(options.caseSensitive)
  const contextChars = Math.max(0, Math.floor(options.contextChars ?? DEFAULT_CONTEXT))
  const maxHits = Math.max(1, Math.floor(options.maxHits ?? DEFAULT_MAX_HITS))
  const needle = caseSensitive ? keyword : keyword.toLowerCase()

  const hits: NovelSearchHit[] = []
  let page = 1
  for (let index = 0; index < list.length && hits.length < maxHits; index++) {
    const chunk = list[index]
    if (chunk.type === "newpage") {
      page = pageOf(chunk, page + 1)
      continue
    }
    if (!isSearchable(chunk)) continue
    const text = searchableText(chunk)
    if (!text) continue
    const haystack = caseSensitive ? text : text.toLowerCase()
    let from = 0
    while (hits.length < maxHits) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      const end = at + needle.length
      hits.push({
        chunkId: chunk.id,
        chunkIndex: index,
        page: pageOf(chunk, page),
        matchStart: at,
        matchEnd: end,
        before: text.slice(Math.max(0, at - contextChars), at),
        match: text.slice(at, end),
        after: text.slice(end, end + contextChars),
      })
      from = end > at ? end : at + 1
    }
  }
  return hits
}

/** 命中 → 阅读锚点（跳转并高亮用；quote 取命中处原文，保证正文变动后可恢复） */
export function anchorFromSearchHit(
  hit: NovelSearchHit,
  novelId: number,
  chunk: AnchorChunkLike | null | undefined,
  contentVersion?: string | null,
  updatedAt?: number
): NovelReadingAnchor {
  const text = chunk ? searchableText(chunk) : ""
  const quote = quoteFromText(text, hit.matchStart) || hit.match
  return {
    novelId,
    page: hit.page,
    chunkId: hit.chunkId,
    contentVersion: contentVersion || undefined,
    offset: hit.matchStart,
    quote: quote || undefined,
    chunkIndex: hit.chunkIndex,
    updatedAt: typeof updatedAt === "number" ? updatedAt : Date.now(),
  }
}

/**
 * 上一下一命中：direction 为 1（下一）/ -1（上一）。
 * 越界时循环回到另一端；命中为空返回 -1。
 */
export function stepHitIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : total - 1
  const next = current + direction
  if (next < 0) return total - 1
  if (next >= total) return 0
  return next
}

/** 检索结果摘要，用于面板标题 */
export function searchSummary(hits: NovelSearchHit[], currentIndex: number, query: string): string {
  if (!query.trim()) return "输入关键词检索本篇正文"
  if (hits.length === 0) return `未找到「${query}」`
  const position = currentIndex >= 0 ? currentIndex + 1 : 0
  return `「${query}」· 第 ${position}/${hits.length} 处命中`
}

/** 命中在整篇正文中的顺序键，便于排序与去重 */
export function hitOrderKey(hit: NovelSearchHit): number {
  return hit.chunkIndex * 1_000_000 + hit.matchStart
}

/* ───────────────────────── 跳转反馈（原生 / WebView 能力差异） ───────────────────────── */

/** 当前正文引擎：WebView（竖向排版）支持片段高亮；原生 SwiftUI 节点树只能定位到段 */
export type ReaderEngineKind = "webview" | "native"

/**
 * 跳转反馈文案。
 *
 * 重要：只有 WebView 引擎实现了 `mark.novel-hit-mark` 片段高亮；
 * 原生排版引擎只能滚动到命中所在段落，UI 不得对原生引擎宣称「已高亮」。
 */
export function jumpFeedbackText(
  engine: ReaderEngineKind,
  match: string,
  options: { page?: number; index?: number; total?: number; from?: "outline" | "search" } = {}
): string {
  const short = (match ?? "").trim().slice(0, 12)
  const position =
    typeof options.index === "number" && typeof options.total === "number" && options.total > 0
      ? `第 ${options.index + 1}/${options.total} 处`
      : ""
  if (options.from === "outline") {
    return engine === "webview" ? "已跳转到目录位置" : "已跳转到目录位置（原生排版不显示章节片段高亮）"
  }
  const head = position ? `已定位${position}` : "已定位到命中位置"
  if (!short) return head
  if (engine === "webview") return `${head}：${short}（已高亮命中片段）`
  return `${head}：${short}（原生排版引擎只定位到段落，不显示片段高亮）`
}

/** 面板内提示：说明当前引擎的检索跳转能力，避免对原生引擎承诺高亮 */
export function searchHighlightHint(engine: ReaderEngineKind): string {
  return engine === "webview"
    ? "输入关键词后按「下一处」逐条跳转，命中片段会在正文中高亮显示。"
    : "输入关键词后按「下一处」逐条跳转；当前为原生排版引擎，只能定位到命中段落，不显示片段高亮（切换竖向排版可高亮）。"
}


/** 按阅读顺序排序并去重（同一块同一偏移只保留一条） */
export function normalizeHits(hits: NovelSearchHit[] | null | undefined): NovelSearchHit[] {
  if (!Array.isArray(hits) || hits.length === 0) return []
  const seen = new Set<string>()
  const unique: NovelSearchHit[] = []
  for (const hit of hits) {
    const key = `${hit.chunkId}#${hit.matchStart}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(hit)
  }
  return unique.sort((a, b) => hitOrderKey(a) - hitOrderKey(b))
}
