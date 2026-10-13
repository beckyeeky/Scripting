import { pixivHistoryDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"
import { notifyLocalMutation } from "./historySync"

export interface NovelReadingProgress {
  novelID: number
  page: number
  chunkId?: string
  updatedAt: number
  /** 正文/解析版本（新增，旧记录缺失） */
  contentVersion?: string
  /** 块内字符偏移（新增） */
  offset?: number
  /** 可恢复文本锚点（新增） */
  quote?: string
  /** 记录时的块序号（新增） */
  chunkIndex?: number
  /** 最高已读位置：与 page/chunkId 分离，回看旧内容时不会回退 */
  highestPage?: number
  highestChunkId?: string
  highestOffset?: number
  highestQuote?: string
  highestChunkIndex?: number
  highestUpdatedAt?: number
}

/** recordNovelProgress 的附加锚点信息（全部可选，保持旧调用签名可用） */
export interface NovelProgressAnchorUpdate {
  contentVersion?: string
  offset?: number
  quote?: string
  chunkIndex?: number
}

const PROGRESS_FILE_NAME = "novel_progress.json"
const DEBOUNCE_DELAY_MS = 500

let progressCache: Map<number, NovelReadingProgress> | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 进度变化订阅：离线书库等 UI 需要据此刷新「在读/已读」筛选，而不必轮询磁盘
const progressListeners = new Set<(novelID: number) => void>()

export function onNovelProgressChanged(listener: (novelID: number) => void): () => void {
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}

function notifyProgressChanged(novelID: number): void {
  for (const listener of progressListeners) {
    try {
      listener(novelID)
    } catch (error: any) {
      console.warn("novel progress listener failed:", error?.message ?? error)
    }
  }
}

export function clearNovelProgressMemoryCache(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  isDirty = false
  progressCache = null
}

function progressFilePath(userId?: string | number | null): string {
  return `${pixivHistoryDirectory(userId ?? session.userID)}/${PROGRESS_FILE_NAME}`
}

function optionalPositiveInt(value: unknown): number | undefined {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : undefined
}

function parseStoredProgress(item: any): NovelReadingProgress | null {
  if (!item || typeof item.novelID !== "number" || item.novelID <= 0) return null
  return {
    novelID: item.novelID,
    page: Math.max(1, Number(item.page) || 1),
    chunkId: typeof item.chunkId === "string" ? item.chunkId : undefined,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
    contentVersion: typeof item.contentVersion === "string" ? item.contentVersion : undefined,
    offset: optionalPositiveInt(item.offset),
    quote: typeof item.quote === "string" && item.quote ? item.quote : undefined,
    chunkIndex: optionalPositiveInt(item.chunkIndex),
    highestPage: optionalPositiveInt(item.highestPage),
    highestChunkId: typeof item.highestChunkId === "string" ? item.highestChunkId : undefined,
    highestOffset: optionalPositiveInt(item.highestOffset),
    highestQuote: typeof item.highestQuote === "string" && item.highestQuote ? item.highestQuote : undefined,
    highestChunkIndex: optionalPositiveInt(item.highestChunkIndex),
    highestUpdatedAt: optionalPositiveInt(item.highestUpdatedAt),
  }
}

function loadProgressSync(): Map<number, NovelReadingProgress> {
  if (progressCache !== null) return progressCache
  const path = progressFilePath()
  const map = new Map<number, NovelReadingProgress>()
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const content = FileManager.readAsStringSync(path)
      if (content && content.trim().length > 0) {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const entry = parseStoredProgress(item)
            if (entry) map.set(entry.novelID, entry)
          }
        }
      }
    }
  } catch (err) {
    console.warn("load novel progress failed:", err)
  }
  progressCache = map
  return progressCache
}

export async function prepareNovelProgressStorage(): Promise<void> {
  const path = progressFilePath()
  const dir = path.substring(0, path.lastIndexOf("/"))
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
}

export function getAllNovelProgressMap(): Map<number, NovelReadingProgress> {
  return loadProgressSync()
}

export function replaceNovelProgressMap(map: Map<number, NovelReadingProgress>, persist = true): void {
  progressCache = new Map(map)
  if (persist) {
    flushNovelProgress()
    persistSync(progressCache)
  }
}

export function getNovelProgress(novelID: number): NovelReadingProgress | undefined {
  if (!novelID || novelID <= 0) return undefined
  const map = loadProgressSync()
  return map.get(novelID)
}

/**
 * 最高已读位置与当前进度分离：回看旧内容只更新 current，不影响 highest。
 * 旧记录没有 highest* 字段时以当前进度兜底，保证筛选/进度展示不出现空洞。
 */
export function getNovelHighestProgress(novelID: number): {
  page: number
  chunkId?: string
  offset?: number
  quote?: string
  chunkIndex?: number
  updatedAt?: number
} | null {
  const progress = getNovelProgress(novelID)
  if (!progress) return null
  return {
    page: progress.highestPage ?? progress.page,
    chunkId: progress.highestChunkId ?? progress.chunkId,
    offset: progress.highestOffset ?? progress.offset,
    quote: progress.highestQuote ?? progress.quote,
    chunkIndex: progress.highestChunkIndex ?? progress.chunkIndex,
    updatedAt: progress.highestUpdatedAt ?? progress.updatedAt,
  }
}

/** 是否读过（只要有当前或最高进度即视为已读） */
export function hasNovelReadingProgress(novelID: number): boolean {
  const progress = getNovelProgress(novelID)
  if (!progress) return false
  return progress.page > 1 || (progress.highestPage ?? 1) > 1 || Boolean(progress.chunkId)
}

function persistSync(map: Map<number, NovelReadingProgress>): boolean {
  try {
    const list = Array.from(map.values())
    writeTextSafely(progressFilePath(), JSON.stringify(list), (raw) => {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error("阅读进度格式错误")
    })
    isDirty = false
    return true
  } catch (error: any) {
    console.warn("novel progress persist error:", error?.message ?? error)
    return false
  }
}

export function flushNovelProgress(): boolean {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!isDirty || !progressCache) return true
  return persistSync(progressCache)
}

/**
 * 记录阅读进度。
 * @param anchor 可选的正文版本与段内偏移/文本锚点（新增，旧调用可省略）
 */
export function recordNovelProgress(
  novelID: number,
  page: number,
  chunkId?: string,
  immediate = false,
  anchor?: NovelProgressAnchorUpdate
): void {
  if (!novelID || novelID <= 0) return
  const map = loadProgressSync()
  const existing = map.get(novelID)
  const nextPage = Math.max(1, page)
  const contentVersion = anchor?.contentVersion ?? existing?.contentVersion
  const offset = typeof anchor?.offset === "number" ? Math.max(0, Math.floor(anchor.offset)) : existing?.offset
  const quote = anchor?.quote || existing?.quote
  const chunkIndex = typeof anchor?.chunkIndex === "number" ? anchor.chunkIndex : existing?.chunkIndex

  if (
    existing &&
    existing.page === nextPage &&
    existing.chunkId === chunkId &&
    existing.contentVersion === contentVersion &&
    existing.offset === offset &&
    existing.quote === quote &&
    existing.chunkIndex === chunkIndex
  ) {
    return
  }

  const currentHighest = existing?.highestPage ?? existing?.page ?? 0
  const highestGrew = nextPage >= currentHighest
  const entry: NovelReadingProgress = {
    novelID,
    page: nextPage,
    chunkId,
    updatedAt: Date.now(),
    contentVersion,
    offset,
    quote,
    chunkIndex,
  }
  if (highestGrew) {
    entry.highestPage = nextPage
    entry.highestChunkId = chunkId ?? existing?.highestChunkId
    entry.highestOffset = offset
    entry.highestQuote = quote
    entry.highestChunkIndex = chunkIndex
    entry.highestUpdatedAt = Date.now()
  } else if (existing) {
    // 回看旧内容：保留既有最高已读位置
    entry.highestPage = existing.highestPage ?? existing.page
    entry.highestChunkId = existing.highestChunkId ?? existing.chunkId
    entry.highestOffset = existing.highestOffset ?? existing.offset
    entry.highestQuote = existing.highestQuote ?? existing.quote
    entry.highestChunkIndex = existing.highestChunkIndex ?? existing.chunkIndex
    entry.highestUpdatedAt = existing.highestUpdatedAt ?? existing.updatedAt
  }

  map.set(novelID, entry)
  isDirty = true
  notifyLocalMutation()
  notifyProgressChanged(novelID)

  if (immediate) {
    flushNovelProgress()
    return
  }

  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushNovelProgress()
  }, DEBOUNCE_DELAY_MS)
}

export function clearNovelProgress(novelID?: number): void {
  const map = loadProgressSync()
  if (novelID) {
    map.delete(novelID)
  } else {
    map.clear()
  }
  isDirty = true
  notifyLocalMutation()
  flushNovelProgress()
  notifyProgressChanged(novelID ?? 0)
}
