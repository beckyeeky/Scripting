/**
 * 小说目录（纯逻辑）
 *
 * 只从**本篇**的正文块构建目录，绝不把系列内其它话的章节混入本话目录。
 * 系列级目录由 buildSeriesEpisodeList 单独构建，二者数据结构不同、调用点分离。
 */
import type { AnchorChunkLike } from "./novelAnchor"

export type NovelOutlineKind = "chapter" | "newpage"

export interface NovelOutlineEntry {
  id: string
  kind: NovelOutlineKind
  /** 章节标题；newpage 条目为空 */
  title: string
  page: number
  /** 在原文块序列中的序号，用于判断当前阅读位置落在哪个条目之后 */
  chunkIndex: number
}

export interface SeriesEpisodeOutlineEntry {
  novelId: number
  title: string
  episodeNumber?: number | null
}

/**
 * 从**当前话**的正文块构建目录。
 * chapter 块给出标题；newpage 块给出页码分隔。其余块（正文/插图/跳页）不产生目录项。
 */
export function buildEpisodeOutline(chunks: AnchorChunkLike[] | null | undefined): NovelOutlineEntry[] {
  if (!Array.isArray(chunks)) return []
  const entries: NovelOutlineEntry[] = []
  let page = 1
  chunks.forEach((chunk, index) => {
    if (chunk.type === "newpage") {
      page = typeof chunk.page === "number" && chunk.page > 0 ? chunk.page : page + 1
      entries.push({ id: chunk.id, kind: "newpage", title: "", page, chunkIndex: index })
    } else if (chunk.type === "chapter") {
      entries.push({ id: chunk.id, kind: "chapter", title: (chunk.title ?? "").trim(), page, chunkIndex: index })
    }
  })
  return entries
}

/** 目录中是否需要展示（多于一项才有意义） */
export function hasUsableOutline(entries: NovelOutlineEntry[] | null | undefined): boolean {
  return Array.isArray(entries) && entries.length > 0
}

/**
 * 找到当前阅读块对应的目录项：取 chunkIndex 不大于目标的最后一个条目。
 * 用于目录面板高亮「当前章节」。目标块在首个目录项之前时返回 null。
 */
export function activeOutlineEntry(
  entries: NovelOutlineEntry[] | null | undefined,
  target: { chunkIndex?: number | null; page?: number | null } | null | undefined
): NovelOutlineEntry | null {
  if (!Array.isArray(entries) || entries.length === 0 || !target) return null
  const index = typeof target.chunkIndex === "number" ? target.chunkIndex : -1
  if (index >= 0) {
    let found: NovelOutlineEntry | null = null
    for (const entry of entries) {
      if (entry.chunkIndex <= index) found = entry
      else break
    }
    return found
  }
  const page = typeof target.page === "number" ? target.page : 0
  if (page > 0) {
    let found: NovelOutlineEntry | null = null
    for (const entry of entries) {
      if (entry.page <= page) found = entry
      else break
    }
    return found
  }
  return null
}

/** 目录项显示标题：章节用标题，换页用「第 N 页」 */
export function outlineEntryLabel(entry: NovelOutlineEntry): string {
  if (entry.kind === "chapter") return entry.title || "未命名章节"
  return `第 ${entry.page} 页`
}

/** 系列级目录：与本篇目录分离，只描述其它话，不参与本篇目录渲染 */
export function buildSeriesEpisodeList(
  episodes: Array<{ novelId: number; title?: string | null; episodeNumber?: number | null }> | null | undefined
): SeriesEpisodeOutlineEntry[] {
  if (!Array.isArray(episodes)) return []
  return episodes
    .filter((item) => item && typeof item.novelId === "number" && item.novelId > 0)
    .map((item) => ({
      novelId: item.novelId,
      title: (item.title ?? "").trim() || `作品 ${item.novelId}`,
      episodeNumber: item.episodeNumber ?? null,
    }))
}

/**
 * 校验：本篇目录中不得出现系列其它话的条目。
 * 仅当目录项的 id 出现在「非本篇」块集合时才判定为混入。
 */
export function outlineLeaksSeriesContent(
  episodeOutline: NovelOutlineEntry[] | null | undefined,
  foreignChunkIds: Iterable<string> | null | undefined
): boolean {
  if (!Array.isArray(episodeOutline) || !foreignChunkIds) return false
  const foreign = new Set(foreignChunkIds)
  return episodeOutline.some((entry) => foreign.has(entry.id))
}
