/**
 * 离线抓取适配层（UI 层）
 *
 * 职责：把「正文里的插图」翻译成离线保存任务（chunkId → 可下载 URL）。
 * 边界：
 * - 不触网：插画详情的解析与请求由调用方注入 `resolveIllustUrl`；
 * - 不落盘：字节下载与复制由 `persistOfflineImages` 注入的 loadBytes 完成；
 * - 不猜测：拿不到地址的任务 `url` 为 null 且不带 deferred，落盘时如实记为「未解析到插图地址」；
 *   因本次上限未解析的任务带 `deferred`，落盘时记为待补，绝不谎称完整。
 */
import type { OfflineImageTask } from "../store/novelOfflineImages"

export interface OfflineCaptureChunk {
  type: string
  id: string
  imageId?: string
  illustId?: number
  page?: number
  info?: any
}

/** 与阅读器一致的「已上传插图」URL 取值顺序 */
export function uploadedImageUrl(info: any): string | null {
  if (!info) return null
  return (
    info.urls?.["1200x1200"] ||
    info.urls?.original ||
    info.urls?.["480mw"] ||
    info.urls?.large ||
    info.urls?.medium ||
    info.urls?.url ||
    (typeof info.url === "string" ? info.url : null) ||
    null
  )
}

function findEmbeddedImage(
  imageId: string | undefined,
  embeddedImages?: Record<string, any> | null
): any | null {
  if (!imageId || !embeddedImages) return null
  const direct = embeddedImages[imageId]
  if (direct) return direct
  const numeric = (embeddedImages as any)[Number(imageId)]
  if (numeric) return numeric
  for (const value of Object.values(embeddedImages)) {
    const item: any = value
    if (!item) continue
    if (
      String(item?.novelImageId) === String(imageId) ||
      String(item?.id) === String(imageId)
    ) {
      return item
    }
  }
  return null
}

export const DEFAULT_OFFLINE_CAPTURE_MAX_TASKS = 60

/**
 * 生成离线插图任务。
 *
 * @param imageUrls 可选：imageId → 已解析 URL（导出路径已有的地址表），作为兜底
 * @param resolveIllustUrl 可选：解析 `[pixivimage:id-page]` 的插图地址；缺失时该任务记为未解析
 * @param maxTasks 本次最多解析多少个插图地址（默认 60），超出的仍会返回但标记 deferred
 */
export async function buildOfflineImageTasks(input: {
  chunks: OfflineCaptureChunk[] | null | undefined
  embeddedImages?: Record<string, any> | null
  imageUrls?: Record<string, string> | null
  resolveIllustUrl?: ((illustId: number, page: number) => Promise<string | null>) | null
  maxTasks?: number
}): Promise<OfflineImageTask[]> {
  const chunks = Array.isArray(input?.chunks) ? input.chunks : []
  const maxTasks = Math.max(1, Math.floor(input?.maxTasks ?? DEFAULT_OFFLINE_CAPTURE_MAX_TASKS))
  const tasks: OfflineImageTask[] = []
  const seen = new Set<string>()
  const illustCache = new Map<string, string | null>()
  let resolved = 0

  for (const chunk of chunks) {
    if (!chunk || !chunk.id || seen.has(chunk.id)) continue
    if (chunk.type === "uploadedimage") {
      seen.add(chunk.id)
      const embedded = findEmbeddedImage(chunk.imageId, input.embeddedImages)
      const url =
        uploadedImageUrl(chunk.info) ||
        uploadedImageUrl(embedded) ||
        (chunk.imageId ? input.imageUrls?.[chunk.imageId] ?? null : null)
      tasks.push({
        chunkId: chunk.id,
        url: url ?? null,
        deferred: !url && resolved >= maxTasks ? true : undefined,
      } as OfflineImageTask)
      if (url) resolved += 1
      continue
    }
    if (chunk.type !== "pixivimage" || !chunk.illustId || chunk.illustId <= 0) continue
    seen.add(chunk.id)
    const page = Math.max(0, (chunk.page ?? 1) - 1)
    const cacheKey = `${chunk.illustId}-${page}`
    if (resolved >= maxTasks) {
      tasks.push({ chunkId: chunk.id, url: null, deferred: true } as OfflineImageTask)
      continue
    }
    let url: string | null
    if (illustCache.has(cacheKey)) {
      url = illustCache.get(cacheKey) ?? null
    } else {
      url = null
      if (typeof input.resolveIllustUrl === "function") {
        try {
          url = (await input.resolveIllustUrl(chunk.illustId, page)) ?? null
        } catch {
          url = null
        }
      }
      illustCache.set(cacheKey, url)
    }
    if (url) resolved += 1
    tasks.push({ chunkId: chunk.id, url })
  }

  return tasks
}

/** 面向用户的插图任务统计（数值来自真实任务，不含推测） */
export function describeOfflineCaptureTasks(tasks: OfflineImageTask[]): string {
  const list = Array.isArray(tasks) ? tasks : []
  const withUrl = list.filter((task) => Boolean(task.url)).length
  const deferred = list.filter((task) => !task.url && task.deferred).length
  const unresolved = list.length - withUrl - deferred
  const parts = [`正文插图 ${list.length} 张`]
  if (withUrl > 0) parts.push(`可下载 ${withUrl}`)
  if (deferred > 0) parts.push(`超上限待补 ${deferred}`)
  if (unresolved > 0) parts.push(`缺地址 ${unresolved}`)
  return parts.join(" · ")
}
