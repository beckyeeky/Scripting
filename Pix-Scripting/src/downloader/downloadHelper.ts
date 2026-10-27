import { downloadBinaryDetailed, type BinaryDownloadOutcome } from "../api/client"
import type { TaskControlToken } from "./downloadTaskManager"

export type DownloadFailureKind =
  | "cancelled"
  | "auth"
  | "permission"
  | "notFound"
  | "rateLimited"
  | "server"
  | "network"
  | "empty"
  | "invalid"
  | "unknown"

export interface DownloadFailure {
  kind: DownloadFailureKind
  message: string
  status: number | null
  retryable: boolean
}

const AUTH_MESSAGE_PATTERN = /(401|unauthorized|未登录|登录失效|登录已失效|请先登录|重新登录|凭据|令牌|access\s*token|token\s*无效|invalid[_ ]grant)/i
const ACCOUNT_MESSAGE_PATTERN = /(账号|账户).*(变化|切换|不一致|不同)/i
const PERMISSION_MESSAGE_PATTERN = /(403|forbidden|权限|无权|受限|不允许|access\s*denied|not\s*allowed)/i
const NOT_FOUND_MESSAGE_PATTERN = /(404|410|不存在|未找到|已被删除|not\s*found)/i
const CANCEL_MESSAGE_PATTERN = /(已取消|取消|cancel|abort|暂停|paused|taskpause)/i
const RETRYABLE_MESSAGE_PATTERN = /(超时|timeout|timed?\s*out|网络|network|连接|connection|断线|限流|rate\s*limit|429|5\d\d\s*(错误|error)|服务(器)?(错误|不可用)|temporar)/i

/** 依据 HTTP 状态码判定失败性质；仅瞬时故障允许重试 */
export function classifyHttpStatus(status: number, message?: string): DownloadFailure {
  const base = { message: message ?? `HTTP ${status}`, status }
  if (status === 401) return { ...base, kind: "auth", retryable: false }
  if (status === 403) return { ...base, kind: "permission", retryable: false }
  if (status === 404 || status === 410) return { ...base, kind: "notFound", retryable: false }
  if (status === 408 || status === 425 || status === 429) return { ...base, kind: "rateLimited", retryable: true }
  if (status >= 500) return { ...base, kind: "server", retryable: true }
  if (status >= 400) return { ...base, kind: "invalid", retryable: false }
  return { ...base, kind: "unknown", retryable: false }
}

function parseStatusFromText(text: string): number | null {
  const match = text.match(/\b(4\d\d|5\d\d)\b/)
  if (!match) return null
  const status = parseInt(match[1], 10)
  return isNaN(status) ? null : status
}

/** 依据抛出的错误（含 PixivError.status）判定失败性质与是否可重试 */
export function classifyDownloadError(error: unknown): DownloadFailure {
  const err = error as any
  const message =
    typeof err?.message === "string" && err.message ? err.message : String(err ?? "未知错误")
  if (err?.name === "TaskAbortError" || err?.name === "TaskPauseError") {
    return { kind: "cancelled", message, status: null, retryable: false }
  }
  if (CANCEL_MESSAGE_PATTERN.test(message)) {
    return { kind: "cancelled", message, status: null, retryable: false }
  }
  if (ACCOUNT_MESSAGE_PATTERN.test(message)) {
    return { kind: "auth", message, status: null, retryable: false }
  }
  const status =
    typeof err?.status === "number" && err.status > 0 ? err.status : parseStatusFromText(message)
  if (status !== null) {
    const byStatus = classifyHttpStatus(status, message)
    if (byStatus.kind !== "unknown") return byStatus
  }
  if (AUTH_MESSAGE_PATTERN.test(message)) {
    return { kind: "auth", message, status, retryable: false }
  }
  if (PERMISSION_MESSAGE_PATTERN.test(message)) {
    return { kind: "permission", message, status, retryable: false }
  }
  if (NOT_FOUND_MESSAGE_PATTERN.test(message)) {
    return { kind: "notFound", message, status, retryable: false }
  }
  if (RETRYABLE_MESSAGE_PATTERN.test(message)) {
    return { kind: "network", message, status, retryable: true }
  }
  // 未识别的错误：保守处理，不做盲目重试，交由上层报告
  return { kind: "unknown", message, status, retryable: false }
}

/** 依据 downloadBinaryDetailed 的下载结果判定失败性质与是否可重试 */
export function classifyDownloadOutcome(outcome: BinaryDownloadOutcome): DownloadFailure {
  const message = outcome.message ?? ""
  if (outcome.failure === "aborted") {
    return { kind: "cancelled", message: message || "已取消", status: outcome.status, retryable: false }
  }
  if (outcome.failure === "blocked") {
    return { kind: "invalid", message: message || "地址不被允许", status: outcome.status, retryable: false }
  }
  if (outcome.failure === "empty") {
    return { kind: "empty", message: message || "响应内容为空", status: outcome.status, retryable: true }
  }
  if (outcome.status !== null && outcome.status > 0) {
    return classifyHttpStatus(outcome.status, message)
  }
  return { kind: "network", message: message || "网络错误", status: outcome.status, retryable: true }
}

export function isNonRetryableFailure(failure: DownloadFailure | null | undefined): boolean {
  return !failure || !failure.retryable
}

/** 供报告使用的可读失败描述 */
export function describeDownloadFailure(failure: DownloadFailure | null | undefined): string {
  if (!failure) return "未知原因"
  const statusText = failure.status ? `（HTTP ${failure.status}）` : ""
  return `${failure.message || failure.kind}${statusText}`
}

/**
 * 安全下载二进制图片，按失败性质做有限重试：
 * · 网络／超时／限流／5xx 等瞬时故障最多重试到 maxAttempts 次；
 * · 鉴权、权限、资源缺失、地址非法、取消等确定失败立即返回，绝不盲目重试。
 */
export async function fetchImageBinaryWithResult(
  url: string,
  maxAttempts = 2,
  token?: TaskControlToken
): Promise<{ data: Data | null; failure: DownloadFailure | null }> {
  if (!url) {
    return {
      data: null,
      failure: { kind: "invalid", message: "缺少图片地址", status: null, retryable: false },
    }
  }
  const attempts = Math.max(1, Math.min(3, maxAttempts))
  let lastFailure: DownloadFailure | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (token) await token.checkOrWait()
    const outcome = await downloadBinaryDetailed(url, undefined, token?.signal)
    if (outcome.data) {
      return { data: outcome.data, failure: null }
    }
    lastFailure = classifyDownloadOutcome(outcome)
    if (!lastFailure.retryable || attempt === attempts - 1) break
    if (token?.isCancelled || token?.isPaused) break
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600 * (attempt + 1))
    })
  }

  if (lastFailure && lastFailure.kind !== "cancelled") {
    console.log("fetchImageBinary failed:", url.slice(0, 80), describeDownloadFailure(lastFailure))
  }
  return { data: null, failure: lastFailure }
}

/**
 * 安全下载二进制图片，带有一次自动重试与可选取消控制。
 * 兼容既有调用方：只返回数据，失败时返回 null（重试策略见 fetchImageBinaryWithResult）。
 */
export async function fetchImageBinaryWithRetry(
  url: string,
  retryCount = 1,
  token?: TaskControlToken
): Promise<Data | null> {
  const { data } = await fetchImageBinaryWithResult(url, retryCount + 1, token)
  return data
}

/**
 * 受限重试执行器：仅对判定为瞬时故障的错误重试，鉴权／权限／取消／资源缺失等
 * 确定失败立即抛出，避免把无效凭据或受限内容反复打到服务端。
 */
export async function runWithLimitedRetry<T>(
  task: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; token?: TaskControlToken } = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2))
  const delayMs = options.delayMs ?? 800
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.token) await options.token.checkOrWait()
    try {
      return await task()
    } catch (error) {
      lastError = error
      const failure = classifyDownloadError(error)
      if (attempt === attempts - 1 || !failure.retryable) throw error
      if (options.token?.isCancelled) throw error
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs * (attempt + 1))
      })
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * 主动让出 JavaScript 事件循环，让 iOS 渲染管道与手势交互得到响应
 */
export async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * 帧时间预算检测：当耗时超过预算阈值（默认 12ms，即 1 帧以内）时主动出让主线程，并返回新的起始时间戳
 */
export async function yieldIfExceeded(startTime: number, budgetMs = 12): Promise<number> {
  const now = Date.now()
  if (now - startTime >= budgetMs) {
    await yieldToMainThread()
    return Date.now()
  }
  return startTime
}

/**
 * 进度回调防抖节流器：在频繁更新时平滑限制上报频率（默认 100ms），但在首帧与结束时立即派发
 */
export function createThrottledProgress(
  onProgress?: (msg: string, current: number, total: number) => void,
  intervalMs = 100
): {
  notify: (msg: string, current: number, total: number) => void
  flush: () => void
} {
  if (!onProgress) {
    return {
      notify: () => {},
      flush: () => {},
    }
  }

  let lastTime = 0
  let pendingArgs: [string, number, number] | null = null
  let timer: any = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pendingArgs) {
      const [msg, current, total] = pendingArgs
      pendingArgs = null
      lastTime = Date.now()
      try {
        onProgress(msg, current, total)
      } catch (err) {
        console.log("Throttled onProgress error:", err)
      }
    }
  }

  const notify = (msg: string, current: number, total: number) => {
    pendingArgs = [msg, current, total]
    const now = Date.now()

    // 首帧 (current === 0) 或完成帧 (current >= total) 立即同步触发
    if (current === 0 || (total > 0 && current >= total)) {
      flush()
      return
    }

    if (now - lastTime >= intervalMs) {
      flush()
    } else if (!timer) {
      const waitTime = Math.max(16, intervalMs - (now - lastTime))
      timer = setTimeout(() => {
        timer = null
        flush()
      }, waitTime)
    }
  }

  return { notify, flush }
}

/**
 * 受控并发执行器（集成微任务切片出让与可控令牌检查）
 */
export async function runConcurrentTasks<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  token?: TaskControlToken
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0
  const maxConcurrency = Math.max(1, Math.min(8, limit))

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      if (token) {
        await token.checkOrWait()
      }
      const index = currentIndex++
      try {
        results[index] = await task(items[index], index)
      } catch (e: any) {
        if (e?.name === "TaskAbortError" || token?.isCancelled) {
          throw e
        }
        console.log(`Task at index ${index} failed:`, e?.message ?? e)
      }
      if (token) {
        await token.checkOrWait()
      }
      // 每次完成一个任务主动出让一下微任务，防止多个 Worker 密集回调挤占主线程
      await yieldToMainThread()
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export interface ExportResult {
  success: boolean
  path?: string | null
  isPartial?: boolean
  downloadedPages: number
  totalPages: number
  failedPages?: number[]
  error?: string
}

/**
 * 从二进制数据或文件头部高效嗅探图片尺寸（PNG / JPEG / WebP / GIF）
 * 仅解析文件前几个字节的 Header，绝不将未经压缩的完整位图解码入内存，
 * 避免在批量下载几十上百张漫画时产生数百兆的瞬时内存波峰与 Jetsam OOM 风险。
 */
export function sniffImageDimensions(
  source: Data | Uint8Array | string
): { width: number; height: number } | null {
  try {
    let bytes: Uint8Array | null = null

    if (typeof source === "string") {
      const d = Data.fromFile(source)
      if (!d || d.size < 16) return null
      const headerData = d.size > 65536 ? d.slice(0, 65536) : d
      bytes = headerData.toUint8Array()
    } else if (source instanceof Uint8Array) {
      bytes = source
    } else if (source && typeof (source as Data).toUint8Array === "function") {
      const d = source as Data
      const headerData = d.size > 65536 ? d.slice(0, 65536) : d
      bytes = headerData.toUint8Array()
    }

    if (!bytes || bytes.length < 16) return null

    // 1. PNG 探测: 前 8 字节为 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a &&
      bytes.length >= 24
    ) {
      const width =
        ((bytes[16] << 24) >>> 0) +
        (bytes[17] << 16) +
        (bytes[18] << 8) +
        bytes[19]
      const height =
        ((bytes[20] << 24) >>> 0) +
        (bytes[21] << 16) +
        (bytes[22] << 8) +
        bytes[23]
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    // 2. JPEG 探测: 前 2 字节为 FF D8 (SOI)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2
      const len = bytes.length

      while (offset < len) {
        while (offset < len && bytes[offset] !== 0xff) {
          offset++
        }
        while (offset < len && bytes[offset] === 0xff) {
          offset++
        }
        if (offset >= len) break

        const marker = bytes[offset]
        offset++

        // 遇到图像扫描开始 SOS (0xDA) 或文件结束 EOI (0xD9)，说明已超出元数据区
        if (marker === 0xda || marker === 0xd9) break

        if (offset + 1 >= len) break
        const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
        if (segmentLength < 2) break

        // 识别 SOF 帧开始标记
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)

        if (isSOF && offset + segmentLength <= len) {
          if (segmentLength >= 7 && offset + 6 < len) {
            const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
            const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
            if (width > 0 && height > 0) {
              return { width, height }
            }
          }
        }

        offset += segmentLength
      }
    }

    // 3. GIF 探测: "GIF87a" 或 "GIF89a"
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes.length >= 10
    ) {
      const width = bytes[6] | (bytes[7] << 8)
      const height = bytes[8] | (bytes[9] << 8)
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }

    // 4. WebP 探测: "RIFF" .... "WEBP"
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes.length >= 30 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) {
        if (bytes.length >= 30) {
          const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
          const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
          if (width > 0 && height > 0) return { width, height }
        }
      }
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4c) {
        if (bytes.length >= 25 && bytes[20] === 0x2f) {
          const b1 = bytes[21]
          const b2 = bytes[22]
          const b3 = bytes[23]
          const b4 = bytes[24]
          const width = 1 + (((b2 & 0x3f) << 8) | b1)
          const height = 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
          if (width > 0 && height > 0) return { width, height }
        }
      }
    }
  } catch (err: any) {
    console.log("sniffImageDimensions parse error:", err?.message ?? err)
  }

  return null
}
