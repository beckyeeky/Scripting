/**
 * 系列离线保存（整系列 → 离线书库）
 *
 * 与单话保存共用同一套落盘实现（saveOfflineEpisode + persistOfflineImages），
 * 差别只在「逐话抓取正文」的编排与系列清单的完整性判定。
 *
 * 明确边界：
 * - 不声明 iOS 后台常驻，页面被系统回收后需要重新进入系列页继续；
 * - 抓取失败的话进入 missingEpisodeIds，绝不把缺章系列标记为完整；
 * - 逐话图片按单话上限落盘，超出的保持 pending，阅读该话时继续补全。
 */
import {
  hasOfflineEpisode,
  mergeSeriesManifest,
  readOfflineSeriesManifest,
  saveOfflineEpisode,
  saveOfflineSeriesManifest,
  type OfflineEpisodeRecord,
  type OfflineImageRecord,
  type OfflineSeriesManifest,
} from "./novelOfflineLibrary"
import { persistOfflineImages, type OfflineImageTask } from "./novelOfflineImages"

export interface SeriesOfflineEpisode {
  novelId: number
  title?: string | null
  episodeNumber?: number | null
}

export interface SeriesOfflineEpisodePayload {
  text: string
  title?: string
  author?: string
  caption?: string | null
  coverUrl?: string | null
  tags?: string[]
  imageTasks?: OfflineImageTask[]
}

export interface SeriesOfflineResult {
  /** 已进入离线书库的话（本次写入或复用已有缓存） */
  saved: number[]
  /** 抓取失败（正文未取到）的话 */
  missing: number[]
  /** 因上限或用户中止而未处理的话 */
  skipped: number[]
  complete: boolean
  manifest: OfflineSeriesManifest | null
  imageOk: number
  imageTotal: number
  messages: string[]
}

export const DEFAULT_SERIES_OFFLINE_EPISODE_LIMIT = 60

/**
 * 逐话保存整个系列。
 *
 * @param fetchEpisode 注入的抓取器：返回该话正文与图片任务，失败返回 null
 * @param loadBytes 注入的图片下载器（复用阅读器图片缓存）
 * @param refresh 为 false 时，已离线保存且不需刷新的话直接复用，不重复抓取
 */
export async function saveNovelSeriesOffline(input: {
  seriesId: number
  title?: string
  episodes: SeriesOfflineEpisode[]
  fetchEpisode: (episode: SeriesOfflineEpisode) => Promise<SeriesOfflineEpisodePayload | null>
  loadBytes: (url: string) => Promise<string | null>
  maxEpisodes?: number
  maxImagesPerEpisode?: number
  refresh?: boolean
  ttlDays?: number
  expectedEpisodeCount?: number | null
  userId?: string | number | null
  shouldStop?: () => boolean
  onProgress?: (done: number, total: number, message: string) => void
}): Promise<SeriesOfflineResult> {
  const result: SeriesOfflineResult = {
    saved: [],
    missing: [],
    skipped: [],
    complete: false,
    manifest: null,
    imageOk: 0,
    imageTotal: 0,
    messages: [],
  }
  if (!input || !input.seriesId || input.seriesId <= 0 || typeof input.fetchEpisode !== "function") {
    result.messages.push("系列信息不可用，未保存任何内容")
    return result
  }

  const seen = new Set<number>()
  const episodes: SeriesOfflineEpisode[] = []
  for (const episode of input.episodes ?? []) {
    if (!episode || typeof episode.novelId !== "number" || episode.novelId <= 0) continue
    if (seen.has(episode.novelId)) continue
    seen.add(episode.novelId)
    episodes.push(episode)
  }
  if (episodes.length === 0) {
    result.messages.push("没有可保存的话")
    return result
  }

  const limit = Math.max(1, Math.floor(input.maxEpisodes ?? DEFAULT_SERIES_OFFLINE_EPISODE_LIMIT))
  const target = episodes.slice(0, limit)
  const untouched = episodes.slice(limit)

  for (let index = 0; index < target.length; index++) {
    const episode = target[index]
    if (input.shouldStop?.()) {
      result.skipped.push(episode.novelId)
      continue
    }
    const label = `第 ${index + 1}/${target.length} 话 ${episode.title ?? episode.novelId}`

    // 已有离线正文且无需刷新：直接复用，避免重复抓取与重复流量
    if (!input.refresh && hasOfflineEpisode(episode.novelId, input.userId)) {
      result.saved.push(episode.novelId)
      input.onProgress?.(index + 1, target.length, `${label}（已离线，跳过）`)
      continue
    }

    input.onProgress?.(index + 1, target.length, `${label} 获取正文…`)
    let payload: SeriesOfflineEpisodePayload | null = null
    try {
      payload = await input.fetchEpisode(episode)
    } catch {
      payload = null
    }
    if (!payload || !payload.text) {
      result.missing.push(episode.novelId)
      input.onProgress?.(index + 1, target.length, `${label} 抓取失败`)
      continue
    }

    const tasks = payload.imageTasks ?? []
    const pendingImages: OfflineImageRecord[] = tasks.map((task) => ({
      chunkId: task.chunkId,
      status: task.url ? "pending" : "missing",
      note: task.url ? undefined : "未解析到插图地址",
    }))
    const saved: OfflineEpisodeRecord | null = saveOfflineEpisode(
      {
        novelId: episode.novelId,
        title: payload.title || episode.title || `作品 ${episode.novelId}`,
        text: payload.text,
        author: payload.author,
        seriesId: input.seriesId,
        episodeNumber: episode.episodeNumber ?? null,
        caption: payload.caption ?? null,
        coverUrl: payload.coverUrl ?? null,
        tags: payload.tags,
        images: pendingImages,
      },
      input.userId
    )
    if (!saved) {
      result.missing.push(episode.novelId)
      input.onProgress?.(index + 1, target.length, `${label} 写入失败`)
      continue
    }
    result.saved.push(episode.novelId)

    if (tasks.length > 0) {
      const summary = await persistOfflineImages({
        novelId: episode.novelId,
        tasks,
        loadBytes: input.loadBytes,
        maxImages: input.maxImagesPerEpisode,
        userId: input.userId,
      })
      result.imageOk += summary.ok
      result.imageTotal += summary.total
      input.onProgress?.(index + 1, target.length, `${label} 插图 ${summary.ok}/${summary.total}`)
    }
  }

  for (const episode of untouched) result.skipped.push(episode.novelId)

  const existingManifest = readOfflineSeriesManifest(input.seriesId, input.userId)
  const declaredComplete =
    result.missing.length === 0 && result.saved.length > 0 && result.skipped.length === 0
  const merged = mergeSeriesManifest(existingManifest, {
    seriesId: input.seriesId,
    title: input.title,
    episodeIds: result.saved,
    missingEpisodeIds: result.missing,
    complete: declaredComplete,
    ttlDays: input.ttlDays,
    expectedEpisodeCount:
      input.expectedEpisodeCount ?? (episodes.length > 0 ? episodes.length : null),
  })
  result.manifest = saveOfflineSeriesManifest(merged, input.userId)
  result.complete = Boolean(result.manifest?.complete)

  if (result.missing.length > 0) {
    result.messages.push(`有 ${result.missing.length} 话未取到正文，系列清单标记为不完整`)
  }
  if (result.skipped.length > 0) {
    result.messages.push(`${result.skipped.length} 话未处理，可再次进入系列页继续保存`)
  }
  if (result.imageTotal > 0) {
    result.messages.push(`插图 ${result.imageOk}/${result.imageTotal} 已离线，其余在阅读该话时继续补全`)
  }
  if (result.messages.length === 0) result.messages.push("系列已全部离线保存")
  return result
}

/** 系列离线覆盖率（UI 展示用，数值取自真实清单） */
export function describeSeriesOffline(result: SeriesOfflineResult): string {
  const parts = [`已保存 ${result.saved.length} 话`]
  if (result.missing.length > 0) parts.push(`缺 ${result.missing.length} 话`)
  if (result.skipped.length > 0) parts.push(`待处理 ${result.skipped.length} 话`)
  parts.push(result.complete ? "清单完整" : "清单不完整")
  return parts.join(" · ")
}
