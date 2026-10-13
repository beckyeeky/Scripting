/**
 * 离线图片补全（正文插图真实落盘）
 *
 * 职责边界：
 * - 只做「把阅读器已下载到本地缓存的图片字节复制进离线书库」这件事；
 * - 下载本身由调用方注入 `loadBytes`（复用现有 imageLoader 缓存与重试策略），
 *   因此本模块不直接触网、也不复制一套下载实现；
 * - 结果状态全部如实写回离线记录：ok / failed / missing / pending，
 *   UI 不得把 pending、missing 说成「图片完整」。
 *
 * 为什么需要它：仅保存正文时，正文插图仍只存在于阅读器的 LRU 图片缓存里，
 * 缓存被清理或断网重启后就会出现「离线缺图」，因此保存离线时必须把字节复制过来。
 */
import {
  saveOfflineImageFromFile,
  updateOfflineEpisodeImages,
  type OfflineImageRecord,
} from "./novelOfflineLibrary"

export interface OfflineImageTask {
  chunkId: string
  /** 图片地址；缺失表示正文引用了但当前拿不到地址 */
  url?: string | null
}

export interface OfflineImagePersistSummary {
  total: number
  /** 真正落盘 */
  ok: number
  /** 没有可用地址（正文引用的插图未解析到 URL） */
  missing: number
  /** 有地址但下载或复制失败 */
  failed: number
  /** 超出本次上限，保持待补（阅读该篇时会继续尝试） */
  skipped: number
  bytes: number
  records: OfflineImageRecord[]
}

export const DEFAULT_OFFLINE_IMAGE_LIMIT = 40

function emptySummary(): OfflineImagePersistSummary {
  return { total: 0, ok: 0, missing: 0, failed: 0, skipped: 0, bytes: 0, records: [] }
}

/** 单张图片的持久化：下载到本地缓存 → 复制进离线书库 */
async function persistOne(
  novelId: number,
  task: OfflineImageTask,
  loadBytes: (url: string) => Promise<string | null>,
  userId?: string | number | null
): Promise<OfflineImageRecord> {
  if (!task.url) {
    return task.deferred
      ? { chunkId: task.chunkId, status: "pending", note: "超出本次保存上限，阅读时可继续补全" }
      : { chunkId: task.chunkId, status: "missing", note: "未解析到插图地址" }
  }
  try {
    const sourcePath = await loadBytes(task.url)
    if (!sourcePath) {
      return { chunkId: task.chunkId, status: "failed", note: "插图下载失败" }
    }
    const saved = saveOfflineImageFromFile(
      { novelId, chunkId: task.chunkId, sourcePath },
      userId
    )
    return saved ?? { chunkId: task.chunkId, status: "failed", note: "插图写入离线书库失败" }
  } catch (error: any) {
    return { chunkId: task.chunkId, status: "failed", note: error?.message ?? "插图保存异常" }
  }
}

/**
 * 批量持久化离线图片。
 *
 * @param loadBytes 注入的下载器：给定 URL 返回本地缓存文件路径，失败返回 null
 * @param maxImages 单次上限（默认 40），超出的保持 pending，阅读时可继续补全
 */
export async function persistOfflineImages(input: {
  novelId: number
  tasks: OfflineImageTask[]
  loadBytes: (url: string) => Promise<string | null>
  maxImages?: number
  concurrency?: number
  userId?: string | number | null
  /** 是否把结果合并写回离线记录（默认写回） */
  writeEpisodeRecord?: boolean
  onProgress?: (done: number, total: number) => void
}): Promise<OfflineImagePersistSummary> {
  const summary = emptySummary()
  if (!input || !input.novelId || input.novelId <= 0 || typeof input.loadBytes !== "function") {
    return summary
  }

  // 同一 chunkId 只处理一次（正文可能重复引用同一张图）
  const seen = new Set<string>()
  const tasks: OfflineImageTask[] = []
  for (const task of input.tasks ?? []) {
    if (!task || !task.chunkId || seen.has(task.chunkId)) continue
    seen.add(task.chunkId)
    tasks.push(task)
  }
  summary.total = tasks.length
  if (tasks.length === 0) return summary

  const maxImages = Math.max(1, Math.floor(input.maxImages ?? DEFAULT_OFFLINE_IMAGE_LIMIT))
  const concurrency = Math.max(1, Math.min(4, Math.floor(input.concurrency ?? 2)))
  const scoped = tasks.slice(0, maxImages)
  const rest = tasks.slice(maxImages)
  const results: OfflineImageRecord[] = []

  let cursor = 0
  let done = 0
  const workers = new Array(Math.min(concurrency, scoped.length)).fill(0).map(async () => {
    while (cursor < scoped.length) {
      const task = scoped[cursor]
      cursor += 1
      results.push(await persistOne(input.novelId, task, input.loadBytes, input.userId))
      done += 1
      try {
        input.onProgress?.(done, scoped.length)
      } catch {
        // 进度回调异常不影响保存
      }
    }
  })
  await Promise.all(workers)

  for (const task of rest) {
    results.push({ chunkId: task.chunkId, status: "pending", note: "超出本次保存上限，阅读时可继续补全" })
    summary.skipped += 1
  }

  for (const record of results) {
    if (record.status === "ok") {
      summary.ok += 1
      summary.bytes += record.bytes ?? 0
    } else if (record.status === "failed") {
      summary.failed += 1
    } else if (record.status === "missing") {
      summary.missing += 1
    }
  }
  summary.records = results

  if (input.writeEpisodeRecord !== false) {
    updateOfflineEpisodeImages(input.novelId, results, input.userId)
  }
  return summary
}

/** 面向用户的一句话汇总（数值全部来自真实落盘结果） */
export function offlineImageSummaryText(summary: OfflineImagePersistSummary): string {
  if (summary.total === 0) return "本篇没有正文插图"
  const parts = [`插图 ${summary.ok}/${summary.total} 已离线`]
  if (summary.missing > 0) parts.push(`缺地址 ${summary.missing}`)
  if (summary.failed > 0) parts.push(`失败 ${summary.failed}`)
  if (summary.skipped > 0) parts.push(`待补 ${summary.skipped}`)
  return parts.join(" · ")
}
