import { migrateLocalToCloudIfNeeded, pixivPixivisionBookmarkDirectory } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { session } from "../api/session"

export interface PixivisionBookmarkItem {
  id: number
  title: string
  thumbnailURL?: string
  category?: string
  categoryLabel?: string
  publishedAt?: string
  tags?: string[]
  bookmarkedAt: number
}

const PIXIVISION_BOOKMARKS_FILE_NAME = "pixivision_bookmarks.json"

let cachedBookmarks: PixivisionBookmarkItem[] | null = null
const listeners = new Set<() => void>()

export function clearPixivisionBookmarksCache(): void {
  cachedBookmarks = null
  emitChanged()
}

function bookmarksFilePath(userId?: string | number | null): string {
  return `${pixivPixivisionBookmarkDirectory(userId ?? session.userID)}/${PIXIVISION_BOOKMARKS_FILE_NAME}`
}

export async function preparePixivisionBookmarksStorage(
  userId?: string | number | null
): Promise<void> {
  if (!FileManager.isiCloudEnabled) return
  const path = bookmarksFilePath(userId)
  migrateLocalToCloudIfNeeded(path)
  if (
    !FileManager.existsSync(path) ||
    !FileManager.isFileStoredIniCloud(path) ||
    FileManager.isiCloudFileDownloaded(path)
  ) {
    return
  }
  try {
    await FileManager.downloadFileFromiCloud(path)
  } catch {
    // 忽略下载异常
  }
}

export async function syncPixivisionBookmarksFromCloud(
  userId?: string | number | null
): Promise<boolean> {
  if (!FileManager.isiCloudEnabled) return false
  await preparePixivisionBookmarksStorage(userId)
  const path = bookmarksFilePath(userId)
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) return false
    const text = FileManager.readAsStringSync(path)
    if (!text || !text.trim()) return false
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return false
    const next = parsed.filter(
      (item) => item && typeof item.id === "number" && item.id > 0
    ) as PixivisionBookmarkItem[]
    if (cachedBookmarks && JSON.stringify(cachedBookmarks) === JSON.stringify(next)) {
      return false
    }
    cachedBookmarks = next
    emitChanged()
    return true
  } catch {
    return false
  }
}

function emitChanged(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch {
      // 避免个别监听器异常中断广播
    }
  }
}

export function onPixivisionBookmarksChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function loadPixivisionBookmarks(userId?: string | number | null): PixivisionBookmarkItem[] {
  if (cachedBookmarks !== null) {
    return cachedBookmarks
  }
  const path = bookmarksFilePath(userId)
  migrateLocalToCloudIfNeeded(path)
  recoverFile(path)
  if (!FileManager.existsSync(path)) {
    cachedBookmarks = []
    return cachedBookmarks
  }
  try {
    const text = FileManager.readAsStringSync(path)
    if (!text || !text.trim()) {
      cachedBookmarks = []
      return cachedBookmarks
    }
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      cachedBookmarks = parsed.filter(
        (item) => item && typeof item.id === "number" && item.id > 0
      )
    } else {
      cachedBookmarks = []
    }
  } catch {
    cachedBookmarks = []
  }
  return cachedBookmarks
}

export function isPixivisionBookmarked(
  articleId: number,
  userId?: string | number | null
): boolean {
  if (!articleId || articleId <= 0) return false
  const list = loadPixivisionBookmarks(userId)
  return list.some((item) => item.id === articleId)
}

function persistBookmarks(
  items: PixivisionBookmarkItem[],
  userId?: string | number | null
): void {
  cachedBookmarks = items
  const path = bookmarksFilePath(userId)
  try {
    writeTextSafely(path, JSON.stringify(items, null, 2))
  } catch {
    // 写入异常静默恢复
  }
  emitChanged()
}

export function addPixivisionBookmark(
  item: PixivisionBookmarkItem,
  userId?: string | number | null
): void {
  if (!item.id || item.id <= 0) return
  const current = loadPixivisionBookmarks(userId)
  const filtered = current.filter((x) => x.id !== item.id)
  const updated: PixivisionBookmarkItem = {
    ...item,
    bookmarkedAt: item.bookmarkedAt || Date.now(),
  }
  // 最新的插在前面
  persistBookmarks([updated, ...filtered], userId)
}

export function removePixivisionBookmark(
  articleId: number,
  userId?: string | number | null
): void {
  if (!articleId || articleId <= 0) return
  const current = loadPixivisionBookmarks(userId)
  const filtered = current.filter((x) => x.id !== articleId)
  if (filtered.length !== current.length) {
    persistBookmarks(filtered, userId)
  }
}

export function togglePixivisionBookmark(
  item: PixivisionBookmarkItem,
  userId?: string | number | null
): boolean {
  if (!item.id || item.id <= 0) return false
  const bookmarked = isPixivisionBookmarked(item.id, userId)
  if (bookmarked) {
    removePixivisionBookmark(item.id, userId)
    return false
  } else {
    addPixivisionBookmark(item, userId)
    return true
  }
}

export function mergePixivisionBookmarks(
  incoming: unknown[],
  userId?: string | number | null
): { items: PixivisionBookmarkItem[]; addedOrUpdated: number } {
  const current = loadPixivisionBookmarks(userId)
  const map = new Map<number, PixivisionBookmarkItem>()
  for (const item of current) {
    map.set(item.id, item)
  }
  let addedOrUpdated = 0
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue
    const candidate = raw as Partial<PixivisionBookmarkItem>
    if (typeof candidate.id !== "number" || candidate.id <= 0 || typeof candidate.title !== "string") {
      continue
    }
    const existing = map.get(candidate.id)
    const bookmarkedAt = typeof candidate.bookmarkedAt === "number" ? candidate.bookmarkedAt : Date.now()
    if (!existing || bookmarkedAt > existing.bookmarkedAt) {
      map.set(candidate.id, {
        id: candidate.id,
        title: candidate.title,
        thumbnailURL: typeof candidate.thumbnailURL === "string" ? candidate.thumbnailURL : existing?.thumbnailURL,
        category: typeof candidate.category === "string" ? candidate.category : existing?.category,
        categoryLabel: typeof candidate.categoryLabel === "string" ? candidate.categoryLabel : existing?.categoryLabel,
        publishedAt: typeof candidate.publishedAt === "string" ? candidate.publishedAt : existing?.publishedAt,
        tags: Array.isArray(candidate.tags) ? candidate.tags.filter((t): t is string => typeof t === "string") : existing?.tags,
        bookmarkedAt,
      })
      addedOrUpdated++
    }
  }
  if (addedOrUpdated === 0) {
    return { items: current, addedOrUpdated: 0 }
  }
  const merged = Array.from(map.values()).sort((a, b) => b.bookmarkedAt - a.bookmarkedAt)
  persistBookmarks(merged, userId)
  return { items: merged, addedOrUpdated }
}
