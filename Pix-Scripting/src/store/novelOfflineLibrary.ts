/**
 * 小说离线书库（设备本地磁盘，按账号隔离）
 *
 * 职责：
 * - 把单篇 / 系列正文与元数据写入磁盘缓存（atomic 写入，崩溃可恢复）；
 * - 记录图片完整性状态（ok/missing/failed/pending）；
 * - 进程重启、断网后仍可阅读：readOfflineEpisode 只读磁盘，不触网；
 * - 容量管理：LRU 淘汰**正文缓存**，绝不删除阅读进度与批注（二者在 History 目录，物理隔离）；
 * - 系列缓存 TTL 与分页完整标记。
 *
 * 明确边界：本模块不承诺 iOS 后台常驻，也不做任何网络请求；网络失败时的回退由调用方使用
 * 本模块的 hasOfflineEpisode/readOfflineEpisode 完成，并据 offlineReadResult 明确标注「离线」。
 */
import { pixivDataPath, resolveEffectiveUID } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import { computeNovelContentVersion, stableHash, NOVEL_PARSE_VERSION } from "./novelAnchor"
import type { PixivNovelDetail } from "../types"

export type OfflineImageStatus = "ok" | "missing" | "failed" | "pending"

export interface OfflineImageRecord {
  chunkId: string
  status: OfflineImageStatus
  bytes?: number
  note?: string
  /** 落盘后的文件名（位于 images/<novelId>/ 内），用于离线读取 */
  fileName?: string
  mime?: string
}

export interface OfflineEpisodeRecord {
  version: 1
  novelId: number
  title: string
  author?: string
  seriesId?: number | null
  episodeNumber?: number | null
  caption?: string | null
  coverUrl?: string | null
  tags?: string[]
  text: string
  contentVersion: string
  parseVersion: number
  images: Record<string, OfflineImageRecord>
  pageCount: number
  paragraphCount: number
  savedAt: number
  lastAccessAt: number
  bytes: number
}

export interface OfflineEpisodeSummary {
  novelId: number
  title: string
  author?: string
  seriesId?: number | null
  bytes: number
  savedAt: number
  lastAccessAt: number
  imageOk: number
  imageTotal: number
  contentVersion: string
  pageCount: number
  paragraphCount: number
}

export interface OfflineSeriesManifest {
  version: 1
  seriesId: number
  title: string
  episodeIds: number[]
  missingEpisodeIds: number[]
  complete: boolean
  fetchedAt: number
  ttlDays: number
  pageCursor?: string | null
  lastPageFetchedAt?: number
}

export type OfflineReadSource = "offline" | "unavailable"

export interface OfflineReadResult {
  record: OfflineEpisodeRecord | null
  source: OfflineReadSource
  /** 是否为离线读取（调用方据此在 UI 明确标注「离线」） */
  offline: boolean
}

export const DEFAULT_LIBRARY_MAX_BYTES = 200 * 1024 * 1024
export const DEFAULT_SERIES_TTL_DAYS = 7

interface LibraryIndex {
  version: 1
  entries: OfflineEpisodeSummary[]
}

function libraryRoot(userId?: string | number | null): string {
  return `${pixivDataPath("NovelOffline", "users", resolveEffectiveUID(userId))}`
}

export function offlineLibraryRoot(userId?: string | number | null): string {
  return libraryRoot(userId)
}

function indexPath(root: string): string {
  return `${root}/index.json`
}

function episodePath(root: string, novelId: number): string {
  return `${root}/episodes/${novelId}.json`
}

/** 图片落盘目录（按作品分目录，随作品缓存一起淘汰） */
export function offlineImageDir(novelId: number, userId?: string | number | null): string {
  return `${libraryRoot(userId)}/images/${novelId}`
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** 由 mime 推导扩展名（未知类型按 jpg 处理，与阅读器读取时的推断一致） */
export function extForMime(mime: string | null | undefined): string {
  return MIME_EXTENSIONS[mime ?? ""] ?? "jpg"
}

/** 由文件路径推导 mime（阅读器缓存文件名即带扩展名） */
export function mimeFromPath(path: string | null | undefined): string {
  const lower = (path ?? "").toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  return "image/jpeg"
}

/** 离线图片文件名：与 chunkId 一一对应且与路径无关（正文重解析后仍能命中） */
export function offlineImageFileName(chunkId: string, mime?: string | null): string {
  return `${stableHash(chunkId)}.${extForMime(mime)}`
}

function seriesPath(root: string, seriesId: number): string {
  return `${root}/series/${seriesId}.json`
}

function ensureDir(dir: string): void {
  if (!FileManager.existsSync(dir)) {
    try {
      FileManager.createDirectorySync(dir, true)
    } catch {
      // 目录已存在或并发创建，忽略
    }
  }
}

/** 统计换页标记，得到页数（纯函数） */
export function countOfflinePages(text: string): number {
  if (!text) return 1
  const matches = text.match(/\[newpage\]/gi)
  return (matches ? matches.length : 0) + 1
}

/** 统计非空段落数（纯函数） */
export function countOfflineParagraphs(text: string): number {
  if (!text) return 0
  return text.split("\n").filter((line) => line.trim().length > 0).length
}

/** 图片完整性汇总（纯函数） */
export function summarizeImageIntegrity(
  images: Record<string, OfflineImageRecord> | null | undefined
): { ok: number; total: number; pending: number; failed: number } {
  const list = images ? Object.values(images) : []
  return {
    ok: list.filter((item) => item.status === "ok").length,
    total: list.length,
    pending: list.filter((item) => item.status === "pending").length,
    failed: list.filter((item) => item.status === "failed" || item.status === "missing").length,
  }
}

function toSummary(record: OfflineEpisodeRecord): OfflineEpisodeSummary {
  const integrity = summarizeImageIntegrity(record.images)
  return {
    novelId: record.novelId,
    title: record.title,
    author: record.author,
    seriesId: record.seriesId ?? null,
    bytes: record.bytes,
    savedAt: record.savedAt,
    lastAccessAt: record.lastAccessAt,
    imageOk: integrity.ok,
    imageTotal: integrity.total,
    contentVersion: record.contentVersion,
    pageCount: record.pageCount,
    paragraphCount: record.paragraphCount,
  }
}

function readIndex(root: string): LibraryIndex {
  const path = indexPath(root)
  try {
    recoverFile(path)
    if (FileManager.existsSync(path)) {
      const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
      if (parsed && Array.isArray(parsed.entries)) {
        return {
          version: 1,
          entries: parsed.entries.filter((item: any) => item && typeof item.novelId === "number"),
        }
      }
    }
  } catch {
    // 索引损坏时回退为空，由磁盘扫描重建
  }
  return { version: 1, entries: [] }
}

function writeIndex(root: string, index: LibraryIndex): void {
  ensureDir(root)
  writeTextSafely(indexPath(root), JSON.stringify(index))
}

/** 索引缺失/损坏时扫描磁盘重建索引 */
function rebuildIndex(root: string): LibraryIndex {
  const dir = `${root}/episodes`
  const entries: OfflineEpisodeSummary[] = []
  if (FileManager.existsSync(dir)) {
    for (const name of FileManager.readDirectorySync(dir, false)) {
      if (!/^\d+\.json$/.test(name)) continue
      const record = readRecord(`${dir}/${name}`)
      if (record) entries.push(toSummary(record))
    }
  }
  return { version: 1, entries }
}

function readRecord(path: string): OfflineEpisodeRecord | null {
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) return null
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
    if (!parsed || parsed.version !== 1 || typeof parsed.novelId !== "number") return null
    return {
      ...parsed,
      images: parsed.images && typeof parsed.images === "object" ? parsed.images : {},
      pageCount:
        typeof parsed.pageCount === "number" ? parsed.pageCount : countOfflinePages(parsed.text ?? ""),
      paragraphCount:
        typeof parsed.paragraphCount === "number"
          ? parsed.paragraphCount
          : countOfflineParagraphs(parsed.text ?? ""),
    } as OfflineEpisodeRecord
  } catch {
    return null
  }
}

/** 保存单篇离线（atomic 写入 + 索引更新）；返回落盘记录，写入失败返回 null */
export function saveOfflineEpisode(
  input: {
    novelId: number
    title: string
    text: string
    author?: string
    seriesId?: number | null
    episodeNumber?: number | null
    caption?: string | null
    coverUrl?: string | null
    tags?: string[]
    images?: OfflineImageRecord[]
  },
  userId?: string | number | null
): OfflineEpisodeRecord | null {
  if (!input || !input.novelId || input.novelId <= 0) return null
  const root = libraryRoot(userId)
  const now = Date.now()
  const existing = readRecord(episodePath(root, input.novelId))
  const images: Record<string, OfflineImageRecord> = {}
  for (const item of input.images ?? []) {
    if (item && item.chunkId) images[item.chunkId] = item
  }
  const text = input.text ?? ""
  const contentVersion = computeNovelContentVersion(text, NOVEL_PARSE_VERSION)
  if (Object.keys(images).length === 0 && existing) {
    // 未显式传入图片状态时沿用既有记录；正文已更新则把旧「已完成」降级为待补，
    // 避免正文换版后仍宣称图片完整（chunkId 可能已不再出现）。
    const textChanged = existing.contentVersion !== contentVersion
    for (const [key, value] of Object.entries(existing.images)) {
      images[key] =
        textChanged && value.status === "ok"
          ? { ...value, status: "pending", note: "正文已更新，插图待重新保存" }
          : value
    }
  }
  const record: OfflineEpisodeRecord = {
    version: 1,
    novelId: input.novelId,
    title: input.title || existing?.title || `作品 ${input.novelId}`,
    author: input.author ?? existing?.author,
    seriesId: input.seriesId ?? existing?.seriesId ?? null,
    episodeNumber: input.episodeNumber ?? existing?.episodeNumber ?? null,
    caption: input.caption ?? existing?.caption ?? null,
    coverUrl: input.coverUrl ?? existing?.coverUrl ?? null,
    tags: input.tags ?? existing?.tags,
    text,
    contentVersion,
    parseVersion: NOVEL_PARSE_VERSION,
    images,
    pageCount: countOfflinePages(text),
    paragraphCount: countOfflineParagraphs(text),
    savedAt: existing?.savedAt ?? now,
    lastAccessAt: now,
    bytes: 0,
  }
  record.bytes = text.length
  try {
    ensureDir(`${root}/episodes`)
    writeTextSafely(episodePath(root, input.novelId), JSON.stringify(record), (raw) => {
      const check = JSON.parse(raw)
      if (check.version !== 1 || check.novelId !== input.novelId) throw new Error("离线记录校验失败")
    })
  } catch (error: any) {
    console.warn("save offline episode failed:", error?.message ?? error)
    return null
  }
  const index = readIndex(root)
  const entries = index.entries.filter((item) => item.novelId !== record.novelId)
  entries.push(toSummary(record))
  writeIndex(root, { version: 1, entries })
  return record
}

/** 断网/重启后读取离线正文；不触网，来源明确 */
export function offlineReadResult(novelId: number, userId?: string | number | null): OfflineReadResult {
  const record = readOfflineEpisode(novelId, userId)
  return record
    ? { record, source: "offline", offline: true }
    : { record: null, source: "unavailable", offline: true }
}

export function readOfflineEpisode(
  novelId: number,
  userId?: string | number | null
): OfflineEpisodeRecord | null {
  if (!novelId || novelId <= 0) return null
  return readRecord(episodePath(libraryRoot(userId), novelId))
}

export function hasOfflineEpisode(novelId: number, userId?: string | number | null): boolean {
  if (!novelId || novelId <= 0) return false
  return FileManager.existsSync(episodePath(libraryRoot(userId), novelId))
}

export function listOfflineEpisodes(userId?: string | number | null): OfflineEpisodeSummary[] {
  const root = libraryRoot(userId)
  let index = readIndex(root)
  if (index.entries.length === 0 && FileManager.existsSync(`${root}/episodes`)) {
    index = rebuildIndex(root)
    try {
      writeIndex(root, index)
    } catch {
      // 索引写入失败不影响本次读取
    }
  }
  return [...index.entries]
}

/** 更新单篇的图片完整性状态并重新落盘 */
export function updateOfflineEpisodeImages(
  novelId: number,
  images: OfflineImageRecord[],
  userId?: string | number | null
): OfflineEpisodeRecord | null {
  const record = readOfflineEpisode(novelId, userId)
  if (!record) return null
  const merged = { ...record.images }
  for (const item of images ?? []) {
    if (item && item.chunkId) merged[item.chunkId] = item
  }
  return saveOfflineEpisode(
    {
      novelId: record.novelId,
      title: record.title,
      text: record.text,
      author: record.author,
      seriesId: record.seriesId ?? null,
      episodeNumber: record.episodeNumber ?? null,
      caption: record.caption ?? null,
      coverUrl: record.coverUrl ?? null,
      tags: record.tags,
      images: Object.values(merged),
    },
    userId
  )
}

export function markOfflineEpisodeAccessed(novelId: number, userId?: string | number | null): void {
  const record = readOfflineEpisode(novelId, userId)
  if (!record) return
  const updated: OfflineEpisodeRecord = { ...record, lastAccessAt: Date.now() }
  const root = libraryRoot(userId)
  try {
    writeTextSafely(episodePath(root, novelId), JSON.stringify(updated))
    const index = readIndex(root)
    writeIndex(root, {
      version: 1,
      entries: index.entries.map((item) => (item.novelId === novelId ? toSummary(updated) : item)),
    })
  } catch {
    // 访问时间更新失败不影响阅读
  }
}

// ───────────────────────── 正文图片的真实落盘与离线读取 ─────────────────────────

/**
 * 把阅读器已下载到本地缓存的图片字节**复制**进离线书库（真·本地持久化）。
 * 复制而非引用：阅读器的图片缓存会被 LRU 清理，直接引用会在清理后出现「离线缺图」。
 */
export function saveOfflineImageFromFile(
  input: { novelId: number; chunkId: string; sourcePath: string; mime?: string | null },
  userId?: string | number | null
): OfflineImageRecord | null {
  if (!input || !input.novelId || input.novelId <= 0 || !input.chunkId) return null
  if (!input.sourcePath) return null
  const mime = input.mime || mimeFromPath(input.sourcePath)
  const fileName = offlineImageFileName(input.chunkId, mime)
  const dir = offlineImageDir(input.novelId, userId)
  const dest = `${dir}/${fileName}`
  try {
    if (!FileManager.existsSync(input.sourcePath)) return null
    ensureDir(dir)
    if (FileManager.existsSync(dest)) FileManager.removeSync(dest)
    FileManager.copyFileSync(input.sourcePath, dest)
    if (!FileManager.existsSync(dest)) return null
    const size = FileManager.statSync(dest).size || 0
    if (size <= 0) {
      try {
        FileManager.removeSync(dest)
      } catch {}
      return null
    }
    return { chunkId: input.chunkId, status: "ok", bytes: size, fileName, mime }
  } catch (error: any) {
    console.warn("save offline image failed:", error?.message ?? error)
    return null
  }
}

/** 在作品图片目录内按 chunkId 的稳定哈希前缀查找文件 */
function findInImageDir(dir: string, chunkId: string): string | null {
  const prefix = `${stableHash(chunkId)}.`
  for (const name of safeReadDirectory(dir)) {
    if (name.startsWith(prefix)) {
      const candidate = `${dir}/${name}`
      if (FileManager.existsSync(candidate)) return candidate
    }
  }
  return null
}

/** 查找已落盘的离线图片文件；未落盘返回 null */
export function findOfflineImageFile(
  novelId: number,
  chunkId: string,
  userId?: string | number | null
): string | null {
  if (!novelId || novelId <= 0 || !chunkId) return null
  const record = readOfflineEpisode(novelId, userId)
  const entry = record?.images?.[chunkId]
  if (entry?.fileName) {
    const candidate = `${offlineImageDir(novelId, userId)}/${entry.fileName}`
    if (FileManager.existsSync(candidate)) return candidate
  }
  return findInImageDir(offlineImageDir(novelId, userId), chunkId)
}

/**
 * 一次性读取本篇「已真实落盘」的插图路径表（chunkId → 绝对路径）。
 *
 * 阅读器按块取图时不要逐块读记录（每次都要解析整份 JSON）；
 * 这里只解析一次，并且只返回 status 为 ok 且文件确实存在的项 ——
 * 记录里标 ok 但文件被清理掉的情况不会被谎报为可离线读取。
 */
export function offlineImagePathMap(
  novelId: number,
  userId?: string | number | null
): Record<string, string> {
  if (!novelId || novelId <= 0) return {}
  const record = readOfflineEpisode(novelId, userId)
  if (!record) return {}
  const dir = offlineImageDir(novelId, userId)
  const paths: Record<string, string> = {}
  for (const [chunkId, entry] of Object.entries(record.images ?? {})) {
    if (!chunkId || !entry || entry.status !== "ok") continue
    let path: string | null = null
    if (entry.fileName) {
      const candidate = `${dir}/${entry.fileName}`
      if (FileManager.existsSync(candidate)) path = candidate
    }
    if (!path) path = findInImageDir(dir, chunkId)
    if (path) paths[chunkId] = path
  }
  return paths
}

export function hasOfflineImage(novelId: number, chunkId: string, userId?: string | number | null): boolean {
  return Boolean(findOfflineImageFile(novelId, chunkId, userId))
}

/**
 * 阅读时补全：仅当该篇已保存离线、且该块插图尚未落盘时才写入。
 * 用于「保存离线时超出上限 / 当时没拿到地址」的插图在阅读过程中自动补齐。
 * 返回 true 表示本次真实写入成功。
 */
export function completePendingOfflineImage(
  novelId: number,
  chunkId: string,
  sourcePath: string,
  userId?: string | number | null
): boolean {
  if (!novelId || novelId <= 0 || !chunkId || !sourcePath) return false
  const record = readOfflineEpisode(novelId, userId)
  if (!record) return false
  const entry = record.images?.[chunkId]
  if (!entry || entry.status === "ok") return false
  const saved = saveOfflineImageFromFile({ novelId, chunkId, sourcePath }, userId)
  if (!saved) return false
  updateOfflineEpisodeImages(novelId, [saved], userId)
  return true
}

/** 读取离线图片为 data URL；未落盘或读取失败返回 null（调用方据此回退到网络） */
export function readOfflineImageDataUrl(
  novelId: number,
  chunkId: string,
  userId?: string | number | null
): string | null {
  const path = findOfflineImageFile(novelId, chunkId, userId)
  if (!path) return null
  try {
    const data = FileManager.readAsDataSync(path)
    if (!data || typeof (data as any).toBase64String !== "function") return null
    const base64 = (data as any).toBase64String()
    if (!base64) return null
    return `data:${mimeFromPath(path)};base64,${base64}`
  } catch {
    return null
  }
}

/** 删除某篇作品的离线图片目录，返回删除的文件数与预估字节数 */
export function removeOfflineImages(
  novelId: number,
  userId?: string | number | null
): { files: number; bytes: number } {
  if (!novelId || novelId <= 0) return { files: 0, bytes: 0 }
  const dir = offlineImageDir(novelId, userId)
  let files = 0
  let bytes = 0
  for (const name of safeReadDirectory(dir)) {
    const path = `${dir}/${name}`
    if (!isSafeLibraryPath(libraryRoot(userId), path)) continue
    try {
      bytes += FileManager.statSync(path).size || 0
      FileManager.removeSync(path)
      files += 1
    } catch {}
  }
  try {
    if (FileManager.existsSync(dir) && FileManager.readDirectorySync(dir, false).length === 0) {
      FileManager.removeSync(dir)
    }
  } catch {}
  return { files, bytes }
}

// ───────────────────────── 断网回退所需的元数据 ─────────────────────────

/**
 * 用离线记录合成可渲染的最小作品元数据。
 *
 * 断网重启时详情接口不可用，若不合成 `novel`，详情页会落到「小说不存在」错误页，
 * 正文虽在磁盘也无法阅读 —— 这里保证离线路径真的能渲染。
 * iCloud/本地详情缓存（fallback）存在时优先沿用其中的作者、封面与统计信息。
 */
export function synthesizeOfflineNovelDetail(
  record: OfflineEpisodeRecord | null | undefined,
  fallback?: PixivNovelDetail | null
): PixivNovelDetail | null {
  if (!record || !record.novelId) return null
  const cached = fallback ?? null
  const user = cached?.user
    ? { ...cached.user, name: cached.user.name || record.author || "未知作者" }
    : {
        id: 0,
        name: record.author || "未知作者",
        account: "",
        profile_image_urls: { medium: cached?.image_urls?.medium ?? record.coverUrl ?? undefined },
        is_followed: false,
      }
  return {
    id: record.novelId,
    title: cached?.title || record.title || `作品 ${record.novelId}`,
    user,
    tags: cached?.tags ?? (record.tags ?? []).map((name) => ({ name })),
    caption: cached?.caption ?? record.caption ?? undefined,
    text_length: record.text.length,
    create_date: cached?.create_date ?? "",
    page_count: Math.max(1, record.pageCount || 1),
    x_restrict: cached?.x_restrict ?? 0,
    total_view: cached?.total_view ?? 0,
    total_bookmarks: cached?.total_bookmarks ?? 0,
    is_bookmarked: cached?.is_bookmarked ?? false,
    total_comments: cached?.total_comments ?? 0,
    cover: cached?.cover,
    image_urls: cached?.image_urls ?? (record.coverUrl ? { large: record.coverUrl } : null),
    content: cached?.content ?? "",
    episode_number: record.episodeNumber ?? cached?.episode_number ?? undefined,
    novel_marker: cached?.novel_marker ?? null,
    series: record.seriesId
      ? { id: record.seriesId, title: cached?.series?.title ?? undefined }
      : cached?.series ?? null,
    series_next: cached?.series_next ?? null,
    series_prev: cached?.series_prev ?? null,
  }
}

export function removeOfflineEpisode(novelId: number, userId?: string | number | null): boolean {
  if (!novelId || novelId <= 0) return false
  const root = libraryRoot(userId)
  const path = episodePath(root, novelId)
  if (!isSafeLibraryPath(root, path)) return false
  try {
    if (FileManager.existsSync(path)) FileManager.removeSync(path)
  } catch {
    return false
  }
  // 正文删除时同步清理该篇的插图字节，避免残留占用（不影响其它作品与阅读进度）
  removeOfflineImages(novelId, userId)
  const index = readIndex(root)
  writeIndex(root, { version: 1, entries: index.entries.filter((item) => item.novelId !== novelId) })
  return true
}

/** 保存系列离线清单（含 TTL 与分页完整标记） */
export function saveOfflineSeriesManifest(
  input: {
    seriesId: number
    title: string
    episodeIds: number[]
    missingEpisodeIds?: number[]
    complete?: boolean
    ttlDays?: number
    pageCursor?: string | null
  },
  userId?: string | number | null
): OfflineSeriesManifest | null {
  if (!input || !input.seriesId || input.seriesId <= 0) return null
  const root = libraryRoot(userId)
  const episodeIds = Array.from(new Set((input.episodeIds ?? []).filter((id) => id > 0)))
  const missingEpisodeIds = Array.from(new Set((input.missingEpisodeIds ?? []).filter((id) => id > 0)))
  const manifest: OfflineSeriesManifest = {
    version: 1,
    seriesId: input.seriesId,
    title: input.title || `系列 ${input.seriesId}`,
    episodeIds,
    missingEpisodeIds,
    complete: Boolean(input.complete) && missingEpisodeIds.length === 0,
    fetchedAt: Date.now(),
    ttlDays:
      typeof input.ttlDays === "number" && input.ttlDays > 0 ? input.ttlDays : DEFAULT_SERIES_TTL_DAYS,
    pageCursor: input.pageCursor ?? null,
    lastPageFetchedAt: Date.now(),
  }
  try {
    ensureDir(`${root}/series`)
    writeTextSafely(seriesPath(root, input.seriesId), JSON.stringify(manifest), (raw) => {
      const check = JSON.parse(raw)
      if (check.version !== 1 || check.seriesId !== input.seriesId) throw new Error("系列清单校验失败")
    })
  } catch (error: any) {
    console.warn("save offline series manifest failed:", error?.message ?? error)
    return null
  }
  return manifest
}

export function readOfflineSeriesManifest(
  seriesId: number,
  userId?: string | number | null
): OfflineSeriesManifest | null {
  if (!seriesId || seriesId <= 0) return null
  const path = seriesPath(libraryRoot(userId), seriesId)
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) return null
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
    if (!parsed || parsed.version !== 1 || parsed.seriesId !== seriesId) return null
    return parsed as OfflineSeriesManifest
  } catch {
    return null
  }
}

/**
 * 合并系列离线清单的增量更新（纯函数）。
 *
 * 单话保存只知道自己这一话：把该话并入 episodeIds，并把旧的缺章列表里被补上的项移除；
 * `complete` 只有在调用方明确声明完整且当前无缺章、且已知总话数达标时才为 true，
 * 避免「只保存了一话却标记系列完整」。
 */
export function mergeSeriesManifest(
  existing: OfflineSeriesManifest | null | undefined,
  input: {
    seriesId: number
    title?: string
    episodeIds?: number[]
    missingEpisodeIds?: number[]
    complete?: boolean
    ttlDays?: number
    pageCursor?: string | null
    expectedEpisodeCount?: number | null
  }
): {
  seriesId: number
  title: string
  episodeIds: number[]
  missingEpisodeIds: number[]
  complete: boolean
  ttlDays: number
  pageCursor: string | null
} {
  const positive = (list: number[] | undefined): number[] =>
    Array.from(new Set((list ?? []).filter((id) => typeof id === "number" && id > 0)))
  const episodeIds = Array.from(new Set([...positive(existing?.episodeIds), ...positive(input.episodeIds)]))
    .sort((a, b) => a - b)
  const saved = new Set(episodeIds)
  const declaredMissing = new Set([
    ...positive(existing?.missingEpisodeIds),
    ...positive(input.missingEpisodeIds),
  ])
  for (const id of saved) declaredMissing.delete(id)
  const missingEpisodeIds = Array.from(declaredMissing).sort((a, b) => a - b)
  const expected =
    typeof input.expectedEpisodeCount === "number" && input.expectedEpisodeCount > 0
      ? input.expectedEpisodeCount
      : null
  const structurallyComplete = expected === null ? missingEpisodeIds.length === 0 : episodeIds.length >= expected
  return {
    seriesId: input.seriesId,
    title: input.title || existing?.title || `系列 ${input.seriesId}`,
    episodeIds,
    missingEpisodeIds,
    complete: Boolean(input.complete) && missingEpisodeIds.length === 0 && structurallyComplete,
    ttlDays:
      typeof input.ttlDays === "number" && input.ttlDays > 0
        ? input.ttlDays
        : (existing?.ttlDays ?? DEFAULT_SERIES_TTL_DAYS),
    pageCursor: input.pageCursor ?? existing?.pageCursor ?? null,
  }
}

/** 单话保存后并入系列清单（磁盘操作；不声明整系列完整） */
export function addEpisodeToOfflineSeries(
  input: { seriesId: number; title?: string; episodeId: number },
  userId?: string | number | null
): OfflineSeriesManifest | null {
  if (!input || !input.seriesId || input.seriesId <= 0 || !input.episodeId) return null
  const existing = readOfflineSeriesManifest(input.seriesId, userId)
  const merged = mergeSeriesManifest(existing, {
    seriesId: input.seriesId,
    title: input.title,
    episodeIds: [input.episodeId],
    complete: Boolean(existing?.complete),
  })
  return saveOfflineSeriesManifest(merged, userId)
}

/** TTL 判定（纯函数，便于测试） */export function isSeriesManifestFresh(
  manifest: OfflineSeriesManifest | null | undefined,
  now: number = Date.now()
): boolean {
  if (!manifest) return false
  const ttlMs = Math.max(0, manifest.ttlDays) * 24 * 60 * 60 * 1000
  return now - manifest.fetchedAt <= ttlMs
}

/** 完整标记：声明完整且无缺章（纯函数） */
export function seriesManifestComplete(manifest: OfflineSeriesManifest | null | undefined): boolean {
  return Boolean(manifest && manifest.complete && (manifest.missingEpisodeIds?.length ?? 0) === 0)
}

function safeReadDirectory(dir: string): string[] {
  try {
    if (!FileManager.existsSync(dir)) return []
    return FileManager.readDirectorySync(dir, false)
  } catch {
    return []
  }
}

/** 磁盘占用汇总（含离线图片字节） */
export function offlineLibraryUsage(userId?: string | number | null): {
  count: number
  bytes: number
  seriesManifests: number
  imageBytes: number
  imageFiles: number
} {
  const root = libraryRoot(userId)
  let bytes = 0
  let count = 0
  for (const name of safeReadDirectory(`${root}/episodes`)) {
    if (!/^\d+\.json$/.test(name)) continue
    count += 1
    try {
      bytes += FileManager.statSync(`${root}/episodes/${name}`).size || 0
    } catch {}
  }
  let seriesManifests = 0
  for (const name of safeReadDirectory(`${root}/series`)) {
    if (!/^\d+\.json$/.test(name)) continue
    seriesManifests += 1
    try {
      bytes += FileManager.statSync(`${root}/series/${name}`).size || 0
    } catch {}
  }
  let imageBytes = 0
  let imageFiles = 0
  for (const novelDir of safeReadDirectory(`${root}/images`)) {
    const dir = `${root}/images/${novelDir}`
    for (const name of safeReadDirectory(dir)) {
      const path = `${dir}/${name}`
      try {
        imageBytes += FileManager.statSync(path).size || 0
        imageFiles += 1
      } catch {}
    }
  }
  return { count, bytes: bytes + imageBytes, seriesManifests, imageBytes, imageFiles }
}

/** 只允许删除书库根目录内的文件，避免误删进度/批注等外部数据 */
export function isSafeLibraryPath(root: string, path: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`
  return path.startsWith(normalizedRoot) && !path.includes("/../")
}

/**
 * 容量管理：按 lastAccessAt 由旧到新淘汰，直到占用低于上限。
 * 只删除书库正文缓存，绝不触碰 History 下的阅读进度与批注。
 */
export function enforceOfflineLibraryCapacity(
  maxBytes: number = DEFAULT_LIBRARY_MAX_BYTES,
  userId?: string | number | null
): { evicted: number[]; freedBytes: number } {
  const root = libraryRoot(userId)
  const usage = offlineLibraryUsage(userId)
  if (usage.bytes <= maxBytes) return { evicted: [], freedBytes: 0 }

  const summaries = listOfflineEpisodes(userId).sort((a, b) => a.lastAccessAt - b.lastAccessAt)
  const evicted: number[] = []
  let freedBytes = 0
  let remaining = usage.bytes
  for (const summary of summaries) {
    if (remaining <= maxBytes) break
    const path = episodePath(root, summary.novelId)
    if (!isSafeLibraryPath(root, path)) continue
    try {
      const size = FileManager.statSync(path).size || summary.bytes
      FileManager.removeSync(path)
      // 图片字节随正文一起淘汰，否则容量统计与实际占用不一致
      const images = removeOfflineImages(summary.novelId, userId)
      evicted.push(summary.novelId)
      freedBytes += size + images.bytes
      remaining -= size + images.bytes
    } catch {
      // 单个文件删除失败不影响后续淘汰
    }
  }
  if (evicted.length > 0) {
    const index = readIndex(root)
    writeIndex(root, {
      version: 1,
      entries: index.entries.filter((item) => !evicted.includes(item.novelId)),
    })
  }
  return { evicted, freedBytes }
}

/** 清理正文缓存（保留阅读进度与批注；二者不在书库目录内） */
export function clearOfflineLibraryContent(userId?: string | number | null): { removed: number[] } {
  const root = libraryRoot(userId)
  const removedIds = listOfflineEpisodes(userId).map((item) => item.novelId)
  for (const novelId of removedIds) {
    const path = episodePath(root, novelId)
    if (!isSafeLibraryPath(root, path)) continue
    try {
      if (FileManager.existsSync(path)) FileManager.removeSync(path)
    } catch {}
    removeOfflineImages(novelId, userId)
  }
  // 未被索引收录的图片目录同样清理（索引损坏时不留孤儿占用）
  for (const name of safeReadDirectory(`${root}/images`)) {
    const dir = `${root}/images/${name}`
    if (!isSafeLibraryPath(root, dir)) continue
    try {
      if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
    } catch {}
  }
  for (const name of safeReadDirectory(`${root}/series`)) {
    if (!/^\d+\.json$/.test(name)) continue
    const path = `${root}/series/${name}`
    if (!isSafeLibraryPath(root, path)) continue
    try {
      FileManager.removeSync(path)
    } catch {}
  }
  try {
    writeIndex(root, { version: 1, entries: [] })
  } catch {}
  return { removed: removedIds }
}

// ───────────────────────── 阅读状态筛选（纯逻辑，与进度解耦） ─────────────────────────

export type OfflineFilter = "all" | "reading" | "unread" | "finished"
export type OfflineSort = "recent" | "saved" | "title"

export interface OfflineReadState {
  /** 当前进度页 */
  currentPage: number
  /** 最高已读页（与当前进度分开） */
  highestPage: number
}

export interface OfflineSummaryView extends OfflineEpisodeSummary {
  readState: OfflineReadState | null
  /** 已读完（最高已读页到达末页） */
  finished: boolean
  /** 读过但未读完 */
  reading: boolean
}

function stateFor(
  summary: OfflineEpisodeSummary,
  progressOf?: (novelId: number) => OfflineReadState | null
): OfflineReadState | null {
  if (!progressOf) return null
  const state = progressOf(summary.novelId)
  if (!state) return null
  return {
    currentPage: Math.max(1, state.currentPage || 1),
    highestPage: Math.max(1, state.highestPage || state.currentPage || 1),
  }
}

/** 合并离线缓存与本地进度的视图模型；进度缺失时按未读处理 */
export function buildOfflineViews(
  summaries: OfflineEpisodeSummary[] | null | undefined,
  progressOf?: (novelId: number) => OfflineReadState | null
): OfflineSummaryView[] {
  const list = Array.isArray(summaries) ? summaries : []
  return list.map((summary) => {
    const readState = stateFor(summary, progressOf)
    const pageCount = Math.max(1, summary.pageCount || 1)
    const finished = Boolean(readState && readState.highestPage >= pageCount)
    const reading = Boolean(
      readState && !finished && (readState.highestPage > 1 || readState.currentPage > 1)
    )
    return { ...summary, readState, finished, reading }
  })
}

export function filterOfflineViews(
  views: OfflineSummaryView[],
  filter: OfflineFilter
): OfflineSummaryView[] {
  const list = Array.isArray(views) ? views : []
  switch (filter) {
    case "reading":
      return list.filter((item) => item.reading)
    case "unread":
      return list.filter((item) => !item.readState || (!item.reading && !item.finished))
    case "finished":
      return list.filter((item) => item.finished)
    default:
      return list
  }
}

export function sortOfflineViews(
  views: OfflineSummaryView[],
  sort: OfflineSort
): OfflineSummaryView[] {
  const list = [...(views ?? [])]
  switch (sort) {
    case "saved":
      return list.sort((a, b) => b.savedAt - a.savedAt)
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title))
    default:
      return list.sort((a, b) => b.lastAccessAt - a.lastAccessAt)
  }
}

/** 离线状态说明文案（明确标注离线来源） */
export function offlineBadgeText(offline: boolean, hasContent: boolean): string {
  if (!hasContent) return "未离线保存"
  return offline ? "离线可用" : "在线"
}
