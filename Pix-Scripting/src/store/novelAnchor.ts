/**
 * 小说阅读定位锚点（纯逻辑，无原生依赖）
 *
 * 目标：在「页码 + 块 id」之外，再保存**正文/解析版本**与**段内偏移或可恢复文本锚点**，
 * 使正文或解析规则变化后仍能安全回退，且不破坏旧数据（旧记录只有 page/chunkId 也能读）。
 *
 * 设计要点：
 * - 锚点始终保存 `page` 与可选 `chunkId`，因此 1.7.13.4 之前的记录仍可解析；
 * - `contentVersion` 变化 ⇒ 视为正文/解析版本已变，走安全回退（quote → 邻近块 → 页码）；
 * - `offset` 为块内原始字符偏移；`quote` 为块内一小段原文，用于正文变化后重新定位；
 * - 解析结果返回 `matched` 与 `contentChanged`，供 UI 决定是否提示与滚动校正。
 */

/** 解析规则版本：章节/换页/插图标记的切分规则变化时递增，旧锚点按新规则重解析 */
export const NOVEL_PARSE_VERSION = 2
export const NOVEL_ANCHOR_VERSION = 1

/** 正文中用于重新定位的文本锚点最大长度 */
const QUOTE_LENGTH = 40

export type NovelAnchorMatch =
  | "exact" // 块 id、版本与偏移均吻合
  | "quote" // 块 id 丢失或版本变化后，按文本锚点在其它块中重新找到
  | "chunk" // 只有块 id 可用（旧记录或偏移/文本锚点失效）
  | "nearest" // 块 id 丢失，按记录时块序号回退到邻近块
  | "page" // 仅剩页码，回退到该页起始块
  | "start" // 无有效信息，回到开头
  | "empty" // 没有正文块

export interface NovelReadingAnchor {
  novelId: number
  page: number
  chunkId?: string
  /** 正文指纹 + 解析版本；与当前值不一致表示正文或解析规则已变化 */
  contentVersion?: string
  /** 块内字符偏移，0 表示块首 */
  offset?: number
  /** 可恢复文本锚点（块内原文片段） */
  quote?: string
  /** 记录时的块序号，chunkId 丢失时按此就近回退 */
  chunkIndex?: number
  updatedAt: number
}

/** 解析锚点时使用的最小块结构，避免依赖 UI 层的具体类型 */
export interface AnchorChunkLike {
  id: string
  type: string
  text?: string
  page?: number
  title?: string
}

export interface NovelAnchorResolution {
  chunkId: string | null
  chunkIndex: number
  page: number
  offset: number
  quote?: string
  matched: NovelAnchorMatch
  /** 正文/解析版本已变化（仅在锚点带版本时判断） */
  contentChanged: boolean
}

/**
 * 确定性字符串哈希（FNV-1a 32 位 → 8 位十六进制）。
 * 不依赖 Crypto 原生接口，便于纯逻辑测试与跨平台一致。
 */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** 正文内容版本 = 解析版本 + 正文长度 + 正文指纹，正文任意变化都会失效 */
export function computeNovelContentVersion(text: string, parseVersion: number = NOVEL_PARSE_VERSION): string {
  const raw = typeof text === "string" ? text : ""
  return `v${parseVersion}-${raw.length}-${stableHash(raw)}`
}

/** 锚点所依赖的块文本：正文块取 text，章节块取标题 */
export function anchorTextOf(chunk: AnchorChunkLike | null | undefined): string {
  if (!chunk) return ""
  if (chunk.type === "chapter") return chunk.title ?? ""
  return chunk.text ?? ""
}

/** 块的页码（缺省按 1 计） */
export function anchorPageOf(chunk: AnchorChunkLike | null | undefined, fallback = 1): number {
  const page = chunk?.page
  return typeof page === "number" && page > 0 ? page : fallback
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** 从块内 offset 位置起，跳过后置空白后截取一段原文作为文本锚点 */
export function quoteFromText(text: string, offset: number, length = QUOTE_LENGTH): string {
  if (!text) return ""
  const start = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, text.length - 1))
  let cursor = start
  while (cursor < text.length && /\s/.test(text[cursor])) cursor++
  if (cursor >= text.length) return ""
  const slice = text.slice(cursor, cursor + Math.max(0, length))
  const collapsed = slice.replace(/\s+/g, " ").trim()
  return collapsed || ""
}

/** 把「归一化文本」中的偏移映射回原始文本偏移（空白折叠后的近似位置） */
function mapNormalizedOffset(raw: string, target: number): number {
  if (target <= 0) return 0
  let count = 0
  let cursor = 0
  let inSpace = false
  for (; cursor < raw.length; cursor++) {
    const ch = raw[cursor]
    const isSpace = /\s/.test(ch)
    if (isSpace) {
      if (inSpace) continue
      inSpace = true
    } else {
      inSpace = false
    }
    if (count === target) return cursor
    count++
  }
  return raw.length
}

/**
 * 在正文中查找文本锚点。
 * 先做原文精确查找（正文未变时命中块首），再做空白归一化查找（解析规则变化时兜底）。
 * 返回块内偏移；未命中返回 -1。
 */
export function locateQuote(text: string, quote: string | null | undefined): number {
  if (!text || !quote || !quote.trim()) return -1
  const exact = text.indexOf(quote)
  if (exact >= 0) return exact
  const normalizedQuote = normalizeWhitespace(quote)
  if (!normalizedQuote) return -1
  const normalizedText = text.replace(/\s+/g, " ")
  const at = normalizedText.indexOf(normalizedQuote)
  if (at < 0) return -1
  return mapNormalizedOffset(text, at)
}

/** 构造阅读锚点；chunkText 用于自动生成文本锚点，避免调用方重复实现 */
export function createNovelAnchor(input: {
  novelId: number
  page: number
  chunkId?: string | null
  chunkIndex?: number | null
  chunkText?: string | null
  contentVersion?: string | null
  offset?: number | null
  updatedAt?: number
}): NovelReadingAnchor {
  const chunkText = typeof input.chunkText === "string" ? input.chunkText : ""
  const offset = typeof input.offset === "number" && input.offset > 0
    ? Math.min(Math.floor(input.offset), Math.max(0, chunkText.length))
    : 0
  const anchor: NovelReadingAnchor = {
    novelId: input.novelId,
    page: Math.max(1, Math.floor(input.page) || 1),
    chunkId: input.chunkId || undefined,
    contentVersion: input.contentVersion || undefined,
    offset,
    chunkIndex: typeof input.chunkIndex === "number" && input.chunkIndex >= 0 ? input.chunkIndex : undefined,
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : Date.now(),
  }
  const quote = quoteFromText(chunkText, offset)
  if (quote) anchor.quote = quote
  return anchor
}

/** 判断锚点是否与当前正文/解析版本一致 */
export function isAnchorCurrent(
  anchor: NovelReadingAnchor | null | undefined,
  text: string,
  parseVersion: number = NOVEL_PARSE_VERSION
): boolean {
  if (!anchor || !anchor.contentVersion) return false
  return anchor.contentVersion === computeNovelContentVersion(text, parseVersion)
}


/** 在全部块中按文本锚点查找块序号；找不到返回 -1 */
function findChunkIndexByQuote(list: AnchorChunkLike[], quote: string | null | undefined): number {
  if (!quote || !quote.trim()) return -1
  for (let index = 0; index < list.length; index++) {
    if (locateQuote(anchorTextOf(list[index]), quote) >= 0) return index
  }
  return -1
}

/**
 * 解析锚点 → 可用的定位信息。
 * 顺序：精确（块 id + 版本 + 偏移/文本锚点）→ 文本锚点（版本变化）→ 块 id → 邻近块 → 页码 → 开头。
 */
export function resolveNovelAnchor(
  anchor: NovelReadingAnchor | null | undefined,
  chunks: AnchorChunkLike[] | null | undefined,
  options: { contentVersion?: string } = {}
): NovelAnchorResolution {
  const list = Array.isArray(chunks) ? chunks : []
  const basePage = anchor && typeof anchor.page === "number" && anchor.page > 0 ? anchor.page : 1
  if (list.length === 0) {
    return { chunkId: null, chunkIndex: -1, page: basePage, offset: 0, matched: "empty", contentChanged: false }
  }
  if (!anchor) {
    return { chunkId: null, chunkIndex: -1, page: basePage, offset: 0, matched: "start", contentChanged: false }
  }

  const contentChanged = Boolean(
    anchor.contentVersion && options.contentVersion && anchor.contentVersion !== options.contentVersion
  )

  const indexById = new Map<string, number>()
  list.forEach((chunk, index) => indexById.set(chunk.id, index))

  const byChunkId = anchor.chunkId ? indexById.get(anchor.chunkId) : undefined
  const result = (chunkIndex: number, matched: NovelAnchorMatch, offset = 0): NovelAnchorResolution => {
    const chunk = list[chunkIndex]
    const text = anchorTextOf(chunk)
    const clamped = Math.min(Math.max(0, offset), Math.max(0, text.length))
    const quote = quoteFromText(text, clamped)
    return {
      chunkId: chunk?.id ?? null,
      chunkIndex,
      page: anchorPageOf(chunk, basePage),
      offset: clamped,
      quote: quote || undefined,
      matched,
      contentChanged,
    }
  }

  // 1) 块 id 仍存在
  if (typeof byChunkId === "number") {
    const text = anchorTextOf(list[byChunkId])
    if (anchor.quote) {
      const located = locateQuote(text, anchor.quote)
      if (located >= 0) return result(byChunkId, contentChanged ? "quote" : "exact", located)
      if (!contentChanged && typeof anchor.offset === "number") {
        // 正文未变但文本锚点未命中：仍信任偏移（可能锚点截断于空白）
        return result(byChunkId, "exact", anchor.offset)
      }
      // 版本已变且本块内找不到文本锚点：先按全文文本锚点找回，再回退到本块
      const elsewhere = findChunkIndexByQuote(list, anchor.quote)
      if (elsewhere >= 0) return result(elsewhere, "quote", locateQuote(anchorTextOf(list[elsewhere]), anchor.quote))
    } else if (typeof anchor.offset === "number") {
      return result(byChunkId, contentChanged ? "chunk" : "exact", anchor.offset)
    }
    return result(byChunkId, "chunk", 0)
  }

  // 2) 块 id 丢失/变化：按文本锚点在全部正文块中重新定位
  const found = findChunkIndexByQuote(list, anchor.quote)
  if (found >= 0) return result(found, "quote", locateQuote(anchorTextOf(list[found]), anchor.quote))

  // 3) 按记录时的块序号就近回退
  if (typeof anchor.chunkIndex === "number" && anchor.chunkIndex >= 0) {
    const index = Math.min(anchor.chunkIndex, list.length - 1)
    return result(index, "nearest", 0)
  }

  // 4) 仅剩页码：回退到该页起始块
  const pageChunk = list.findIndex((chunk) => anchorPageOf(chunk, basePage) >= basePage)
  if (pageChunk >= 0) return result(pageChunk, "page", 0)

  // 5) 开头
  return { chunkId: null, chunkIndex: -1, page: basePage, offset: 0, matched: "start", contentChanged }
}

/** 面向用户的中文提示：说明本次恢复的置信度 */
export function describeAnchorMatch(match: NovelAnchorMatch): string {
  switch (match) {
    case "exact":
      return "已回到上次阅读位置"
    case "quote":
      return "正文或排版已更新，已按原文片段定位到对应位置"
    case "chunk":
      return "已回到上次阅读的段落"
    case "nearest":
      return "段落结构已变化，已定位到就近位置"
    case "page":
      return "已定位到上次阅读的页码"
    case "start":
      return "已回到开头"
    case "empty":
      return "还没有正文可定位"
    default:
      return ""
  }
}

/** 恢复是否精确（用于 UI 决定是否提示用户） */
export function isExactAnchorMatch(match: NovelAnchorMatch): boolean {
  return match === "exact"
}

/**
 * 续读恢复提示：精确命中与「回到开头」不打扰用户；
 * 其余情况给出一句说明（正文/解析版本变化时额外说明原因），
 * 使「定位目录搜索 → 续读」链路的状态对用户可见。
 */
export function anchorRestoreNotice(
  match: NovelAnchorMatch,
  contentChanged: boolean = false
): string | undefined {
  if (match === "exact" || match === "start" || match === "empty") return undefined
  const base = describeAnchorMatch(match)
  return contentChanged ? `${base}（正文或排版已更新）` : base
}

/** 进度记录 → 锚点（归一化并补齐缺省值） */
export function anchorFromProgress(progress: {
  novelID: number
  page: number
  chunkId?: string
  contentVersion?: string
  offset?: number
  quote?: string
  chunkIndex?: number
  updatedAt?: number
}): NovelReadingAnchor {
  return {
    novelId: progress.novelID,
    page: Math.max(1, Math.floor(progress.page) || 1),
    chunkId: progress.chunkId || undefined,
    contentVersion: progress.contentVersion || undefined,
    offset: typeof progress.offset === "number" ? Math.max(0, Math.floor(progress.offset)) : undefined,
    quote: progress.quote || undefined,
    chunkIndex: typeof progress.chunkIndex === "number" ? progress.chunkIndex : undefined,
    updatedAt: typeof progress.updatedAt === "number" ? progress.updatedAt : Date.now(),
  }
}
