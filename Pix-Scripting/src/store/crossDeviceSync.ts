import { resolveEffectiveUID } from "./dataDirectory"
import {
  flushHistory,
  getHistoryLimitForKind,
  loadKindEntries,
  parseRawEntriesForKind,
  replaceKindEntries,
  toStoredEntry,
  type HistoryContentKind,
} from "./history"
import {
  getHistoryLastSyncTime,
  getHistorySyncState,
  syncHistoryNow,
  triggerResumeSync,
} from "./historySync"
import {
  flushNovelProgress,
  getAllNovelProgressMap,
  replaceNovelProgressMap,
  type NovelReadingProgress,
} from "./novelProgress"
import {
  flushSearchHistory,
  getFullSearchHistoryStore,
  MAX_SEARCH_HISTORY_ITEMS,
  normalizeHistoryEntries,
  replaceSearchHistoryStore,
  type SearchHistoryEntry,
  type SearchHistoryScope,
  type SearchHistoryStore,
} from "./searchHistory"
import {
  loadSettings,
  syncSettingsFromCloud,
  updateSettings,
  type AppSettings,
} from "./settings"
import {
  loadNovelReaderSettings,
  replaceNovelReaderSettings,
  syncNovelReaderSettingsFromCloud,
  type NovelReaderSettings,
} from "./novelReaderSettings"
import {
  loadBlocklist,
  mergeBlocklistData,
  syncBlocklistFromCloud,
  type BlocklistData,
} from "./blocklist"
import {
  loadPixivisionBookmarks,
  mergePixivisionBookmarks,
  syncPixivisionBookmarksFromCloud,
  type PixivisionBookmarkItem,
} from "./pixivisionBookmarks"

export const CROSS_DEVICE_SYNC_FORMAT = "pix-scripting-sync"
export const CROSS_DEVICE_SYNC_SCHEMA_VERSION = 1

export interface CrossDeviceSyncBundle {
  format: typeof CROSS_DEVICE_SYNC_FORMAT
  schemaVersion: typeof CROSS_DEVICE_SYNC_SCHEMA_VERSION
  exportedAt: number
  uid: string
  appSettings?: AppSettings
  novelReaderSettings?: NovelReaderSettings
  history?: {
    illustration?: any[]
    manga?: any[]
    novel?: any[]
  }
  novelProgress?: NovelReadingProgress[]
  searchHistory?: SearchHistoryStore
  blocklist?: BlocklistData
  pixivisionBookmarks?: PixivisionBookmarkItem[]
}

export interface CrossDeviceSyncResult {
  ok: boolean
  icloudEnabled: boolean
  syncedAt: number
  historySynced: boolean
  settingsReloaded: boolean
  readerSettingsReloaded: boolean
  blocklistReloaded: boolean
  pixivisionBookmarksReloaded: boolean
  error?: string
}

export interface CrossDeviceImportOptions {
  includeSettings?: boolean
  includeHistory?: boolean
  syncToCloudAfterImport?: boolean
  userId?: string | number | null
}

export interface CrossDeviceImportSummary {
  appliedAppSettings: boolean
  appliedReaderSettings: boolean
  mergedHistoryItems: {
    illustration: number
    manga: number
    novel: number
  }
  mergedNovelProgress: number
  mergedSearchHistory: number
  addedBlockedTags: number
  addedBlockedUsers: number
  mergedPixivisionBookmarks: number
}

export interface CrossDeviceSyncOverview {
  icloudEnabled: boolean
  uid: string
  lastSyncTime: number
  historyCounts: {
    illustration: number
    manga: number
    novel: number
    total: number
  }
  novelProgressCount: number
  searchHistoryCount: number
  blockedTagsCount: number
  blockedUsersCount: number
  pixivisionBookmarksCount: number
}

const syncListeners = new Set<() => void>()
let lastManualOrResumeSyncAt = 0
let lastResumeCheckAt = 0
let activeFullSyncPromise: Promise<CrossDeviceSyncResult> | null = null

export function onCrossDeviceSyncChanged(listener: () => void): () => void {
  syncListeners.add(listener)
  return () => {
    syncListeners.delete(listener)
  }
}

function emitSyncChanged(): void {
  for (const listener of Array.from(syncListeners)) {
    try {
      listener()
    } catch {
      // 忽略单个监听器异常
    }
  }
}

export function getCrossDeviceSyncOverview(
  userId?: string | number | null
): CrossDeviceSyncOverview {
  const uid = resolveEffectiveUID(userId)
  const illustCount = loadKindEntries("illustration").length
  const mangaCount = loadKindEntries("manga").length
  const novelCount = loadKindEntries("novel").length
  const progressCount = getAllNovelProgressMap().size
  const searchStore = getFullSearchHistoryStore()
  const searchCount =
    searchStore.illust.length + searchStore.novel.length + searchStore.user.length
  const blocklist = loadBlocklist()
  const bookmarks = loadPixivisionBookmarks(uid)
  const historySyncTime = getHistoryLastSyncTime(uid)

  return {
    icloudEnabled: Boolean(FileManager.isiCloudEnabled),
    uid,
    lastSyncTime: Math.max(historySyncTime, lastManualOrResumeSyncAt),
    historyCounts: {
      illustration: illustCount,
      manga: mangaCount,
      novel: novelCount,
      total: illustCount + mangaCount + novelCount,
    },
    novelProgressCount: progressCount,
    searchHistoryCount: searchCount,
    blockedTagsCount: blocklist.blockedTags.length,
    blockedUsersCount: blocklist.blockedUsers.length,
    pixivisionBookmarksCount: bookmarks.length,
  }
}

export async function syncAllCrossDeviceDataNow(
  userId?: string | number | null
): Promise<CrossDeviceSyncResult> {
  if (activeFullSyncPromise) {
    return activeFullSyncPromise
  }

  const uid = resolveEffectiveUID(userId)
  if (!FileManager.isiCloudEnabled) {
    return {
      ok: false,
      icloudEnabled: false,
      syncedAt: Date.now(),
      historySynced: false,
      settingsReloaded: false,
      readerSettingsReloaded: false,
      blocklistReloaded: false,
      pixivisionBookmarksReloaded: false,
      error: "当前设备未开启 iCloud 同步",
    }
  }

  const run = async (): Promise<CrossDeviceSyncResult> => {
    try {
      const [
        historySynced,
        settingsReloaded,
        readerSettingsReloaded,
        blocklistReloaded,
        pixivisionBookmarksReloaded,
      ] = await Promise.all([
        syncHistoryNow(uid),
        syncSettingsFromCloud(),
        syncNovelReaderSettingsFromCloud(),
        syncBlocklistFromCloud(uid),
        syncPixivisionBookmarksFromCloud(uid),
      ])

      const syncedAt = Date.now()
      lastManualOrResumeSyncAt = syncedAt
      emitSyncChanged()
      return {
        ok: historySynced || settingsReloaded || readerSettingsReloaded || blocklistReloaded || pixivisionBookmarksReloaded || true,
        icloudEnabled: true,
        syncedAt,
        historySynced,
        settingsReloaded,
        readerSettingsReloaded,
        blocklistReloaded,
        pixivisionBookmarksReloaded,
      }
    } catch (error: any) {
      return {
        ok: false,
        icloudEnabled: true,
        syncedAt: Date.now(),
        historySynced: false,
        settingsReloaded: false,
        readerSettingsReloaded: false,
        blocklistReloaded: false,
        pixivisionBookmarksReloaded: false,
        error: error?.message ?? String(error),
      }
    } finally {
      activeFullSyncPromise = null
    }
  }

  activeFullSyncPromise = run()
  return activeFullSyncPromise
}

export function triggerFullResumeSync(): void {
  if (!FileManager.isiCloudEnabled) return
  triggerResumeSync()
  const now = Date.now()
  if (now - lastResumeCheckAt < 30 * 1000) return
  lastResumeCheckAt = now
  Promise.allSettled([
    syncSettingsFromCloud(),
    syncNovelReaderSettingsFromCloud(),
    syncBlocklistFromCloud(),
    syncPixivisionBookmarksFromCloud(),
  ])
    .then(() => {
      lastManualOrResumeSyncAt = Date.now()
      emitSyncChanged()
    })
    .catch(() => {})
}

export function exportCrossDeviceSnapshot(
  userId?: string | number | null
): CrossDeviceSyncBundle {
  const uid = resolveEffectiveUID(userId)
  flushHistory()
  flushNovelProgress()
  flushSearchHistory()

  const rawSettings = loadSettings()
  // 目录安全书签与路径绑定当前设备沙盒，不跨设备导出
  const sanitizedSettings: AppSettings = {
    ...rawSettings,
    downloadCustomDirectoryBookmark: null,
    downloadCustomDirectoryPath: null,
  }

  return {
    format: CROSS_DEVICE_SYNC_FORMAT,
    schemaVersion: CROSS_DEVICE_SYNC_SCHEMA_VERSION,
    exportedAt: Date.now(),
    uid,
    appSettings: sanitizedSettings,
    novelReaderSettings: loadNovelReaderSettings(),
    history: {
      illustration: loadKindEntries("illustration").map(toStoredEntry),
      manga: loadKindEntries("manga").map(toStoredEntry),
      novel: loadKindEntries("novel").map(toStoredEntry),
    },
    novelProgress: Array.from(getAllNovelProgressMap().values()),
    searchHistory: getFullSearchHistoryStore(),
    blocklist: loadBlocklist(),
    pixivisionBookmarks: loadPixivisionBookmarks(uid),
  }
}

export function exportCrossDeviceSnapshotJson(
  userId?: string | number | null
): string {
  return JSON.stringify(exportCrossDeviceSnapshot(userId), null, 2)
}

export function parseCrossDeviceSnapshot(rawJson: string): CrossDeviceSyncBundle {
  let parsed: any
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error("同步数据不是有效的 JSON 格式")
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("同步数据格式无效")
  }
  if (parsed.format !== CROSS_DEVICE_SYNC_FORMAT) {
    throw new Error("不是 Pix-Scripting 跨设备同步数据包")
  }
  if (parsed.schemaVersion !== CROSS_DEVICE_SYNC_SCHEMA_VERSION) {
    throw new Error(`不支持的同步数据版本：${String(parsed.schemaVersion)}`)
  }
  return parsed as CrossDeviceSyncBundle
}

function mergeImportedHistoryKind(
  kind: HistoryContentKind,
  incomingRaw: unknown[],
  userId?: string | number | null
): number {
  if (!Array.isArray(incomingRaw) || incomingRaw.length === 0) return 0
  const syncState = getHistorySyncState(userId)
  const clearBeforeTs = syncState.clearBefore[kind] ?? 0
  const localStored = loadKindEntries(kind).map(toStoredEntry)
  const map = new Map<number, any>()

  for (const entry of localStored) {
    const id = entry.kind === "illust" ? entry.illustration?.id : entry.novel?.id
    if (id) map.set(id, entry)
  }

  let changedCount = 0
  for (const entry of incomingRaw) {
    if (!entry || typeof entry !== "object") continue
    const candidate = entry as any
    const id = candidate.kind === "illust" ? candidate.illustration?.id : candidate.novel?.id
    const viewedAt = typeof candidate.viewedAt === "number" ? candidate.viewedAt : 0
    if (!id || viewedAt <= 0) continue
    if (clearBeforeTs > 0 && viewedAt <= clearBeforeTs) continue
    const tombstoneTs = syncState.tombstones[`${kind}:${id}`] ?? 0
    if (tombstoneTs > 0 && viewedAt <= tombstoneTs) continue

    const existing = map.get(id)
    if (!existing || viewedAt > existing.viewedAt) {
      map.set(id, candidate)
      changedCount++
    }
  }

  if (changedCount === 0) return 0

  const mergedStored = Array.from(map.values())
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, getHistoryLimitForKind(kind))
  const decoded = parseRawEntriesForKind(kind, mergedStored)
  replaceKindEntries(kind, decoded as any, true)
  return changedCount
}

function mergeImportedNovelProgress(incoming: unknown[]): number {
  if (!Array.isArray(incoming) || incoming.length === 0) return 0
  const map = new Map<number, NovelReadingProgress>(getAllNovelProgressMap())
  let changed = 0

  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Partial<NovelReadingProgress>
    if (typeof item.novelID !== "number" || item.novelID <= 0) continue
    const updatedAt = typeof item.updatedAt === "number" ? item.updatedAt : 0
    const existing = map.get(item.novelID)
    if (!existing || updatedAt > existing.updatedAt) {
      map.set(item.novelID, item as NovelReadingProgress)
      changed++
    }
  }

  if (changed > 0) {
    replaceNovelProgressMap(map, true)
  }
  return changed
}

function mergeImportedSearchHistory(
  incomingStore: Partial<SearchHistoryStore> | undefined,
  userId?: string | number | null
): number {
  if (!incomingStore || typeof incomingStore !== "object") return 0
  const localStore = getFullSearchHistoryStore()
  const syncState = getHistorySyncState(userId)
  const scopes: SearchHistoryScope[] = ["illust", "novel", "user"]
  const now = Date.now()
  let mergedCount = 0

  const nextStore: SearchHistoryStore = {
    illust: [...localStore.illust],
    novel: [...localStore.novel],
    user: [...localStore.user],
    updatedAt: Math.max(localStore.updatedAt ?? 0, incomingStore.updatedAt ?? 0, now),
    tombstones: localStore.tombstones,
    clearBefore: localStore.clearBefore,
  }

  for (const scope of scopes) {
    const incomingEntries = normalizeHistoryEntries((incomingStore as any)[scope], now)
    if (incomingEntries.length === 0) continue

    const clearBeforeTs = Math.max(
      syncState.searchClearBefore?.[scope] ?? 0,
      localStore.clearBefore?.[scope] ?? 0
    )
    const map = new Map<string, SearchHistoryEntry>()
    for (const entry of localStore[scope]) {
      map.set(entry.query, entry)
    }

    let scopeChanged = 0
    for (const entry of incomingEntries) {
      const query = entry.query.trim()
      if (!query) continue
      if (clearBeforeTs > 0 && entry.searchedAt <= clearBeforeTs) continue
      const tombstoneTs =
        syncState.searchTombstones?.[`${scope}:${query}`] ??
        localStore.tombstones?.[`${scope}:${query}`] ??
        0
      if (tombstoneTs > 0 && entry.searchedAt <= tombstoneTs) continue

      const existing = map.get(query)
      if (!existing || entry.searchedAt > existing.searchedAt) {
        map.set(query, entry)
        scopeChanged++
      }
    }

    if (scopeChanged > 0) {
      mergedCount += scopeChanged
      nextStore[scope] = Array.from(map.values())
        .sort((a, b) => b.searchedAt - a.searchedAt)
        .slice(0, MAX_SEARCH_HISTORY_ITEMS)
    }
  }

  if (mergedCount > 0) {
    replaceSearchHistoryStore(nextStore, true)
  }
  return mergedCount
}

export function importCrossDeviceSnapshot(
  rawJson: string,
  options: CrossDeviceImportOptions = {}
): CrossDeviceImportSummary {
  const bundle = parseCrossDeviceSnapshot(rawJson)
  const uid = resolveEffectiveUID(options.userId)
  const includeSettings = options.includeSettings !== false
  const includeHistory = options.includeHistory !== false

  const summary: CrossDeviceImportSummary = {
    appliedAppSettings: false,
    appliedReaderSettings: false,
    mergedHistoryItems: {
      illustration: 0,
      manga: 0,
      novel: 0,
    },
    mergedNovelProgress: 0,
    mergedSearchHistory: 0,
    addedBlockedTags: 0,
    addedBlockedUsers: 0,
    mergedPixivisionBookmarks: 0,
  }

  if (includeSettings) {
    if (bundle.appSettings && typeof bundle.appSettings === "object") {
      const current = loadSettings()
      const {
        downloadCustomDirectoryBookmark: _ignoredBookmark,
        downloadCustomDirectoryPath: _ignoredPath,
        ...remoteSettings
      } = bundle.appSettings
      updateSettings({
        ...remoteSettings,
        downloadCustomDirectoryBookmark: current.downloadCustomDirectoryBookmark,
        downloadCustomDirectoryPath: current.downloadCustomDirectoryPath,
      })
      summary.appliedAppSettings = true
    }

    if (bundle.novelReaderSettings && typeof bundle.novelReaderSettings === "object") {
      replaceNovelReaderSettings(bundle.novelReaderSettings)
      summary.appliedReaderSettings = true
    }

    if (bundle.blocklist && typeof bundle.blocklist === "object") {
      const merged = mergeBlocklistData(bundle.blocklist as any)
      summary.addedBlockedTags = merged.addedTags
      summary.addedBlockedUsers = merged.addedUsers
    }

    if (Array.isArray(bundle.pixivisionBookmarks)) {
      const merged = mergePixivisionBookmarks(bundle.pixivisionBookmarks, uid)
      summary.mergedPixivisionBookmarks = merged.addedOrUpdated
    }
  }

  if (includeHistory) {
    if (bundle.history && typeof bundle.history === "object") {
      summary.mergedHistoryItems.illustration = mergeImportedHistoryKind(
        "illustration",
        bundle.history.illustration ?? [],
        uid
      )
      summary.mergedHistoryItems.manga = mergeImportedHistoryKind(
        "manga",
        bundle.history.manga ?? [],
        uid
      )
      summary.mergedHistoryItems.novel = mergeImportedHistoryKind(
        "novel",
        bundle.history.novel ?? [],
        uid
      )
    }

    if (Array.isArray(bundle.novelProgress)) {
      summary.mergedNovelProgress = mergeImportedNovelProgress(bundle.novelProgress)
    }

    if (bundle.searchHistory) {
      summary.mergedSearchHistory = mergeImportedSearchHistory(bundle.searchHistory, uid)
    }
  }

  lastManualOrResumeSyncAt = Date.now()
  emitSyncChanged()

  if (FileManager.isiCloudEnabled && options.syncToCloudAfterImport !== false) {
    syncHistoryNow(uid).catch(() => {})
  }

  return summary
}
