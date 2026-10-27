import { downloadBinary, type AbortSignal } from "../api/client"
import { ugoiraMetadata } from "../api/pixiv"
import { session } from "../api/session"
import { loadSettings } from "../store/settings"
import { pixivDataPath } from "../store/dataDirectory"
import { publishPreparedFile, recoverFile, writeTextSafely } from "../store/safeFile"
import type { UgoiraFrame } from "../types"
import { exportFramesToGif, exportFramesToMp4 } from "./ffmpegExporter"

export interface UgoiraFramesResult {
  illustID: number
  framesDir: string
  frames: UgoiraFrame[]
  totalDurationMs: number
  width?: number
  height?: number
  zipPath?: string
}

export interface UgoiraResult {
  mp4Path: string
  duration: number
}

export interface UgoiraCancellationToken {
  checkOrWait?: () => Promise<void>
  isCancelled?: boolean
  signal?: AbortSignal
}

interface UgoiraCacheEntry {
  frames: UgoiraFrame[]
  totalDurationMs: number
  width?: number
  height?: number
  lastAccess: number
  size?: number
}

interface UgoiraCacheMeta {
  [illustID: string]: UgoiraCacheEntry
}

const UGOIRA_DIR_NAME = "UgoiraCache"
const CACHE_META_KEY = "pixiv_ugoira_cache_v2"

let baseDir: string | null = null
let cacheGeneration = 0
let taskSequence = 0
let ugoiraMetaSaveTimer: number | null = null
const UGOIRA_RECONCILE_MS = 60_000
let lastReconcileTime: number | null = null
let lastLimitMB: number | null | undefined
let sizeMaintenancePending = false
const inflightTasks = new Map<number, Promise<UgoiraFramesResult>>()
const memoryFramesCache = new Map<number, UgoiraFramesResult>()

function joinPath(...parts: string[]): string {
  return parts.join("/")
}

function ensureBaseDir(): string {
  const dir = baseDir ?? pixivDataPath(UGOIRA_DIR_NAME)
  if (!FileManager.existsSync(dir)) {
    FileManager.createDirectorySync(dir, true)
  }
  baseDir = dir
  return dir
}

function cacheMetaPath(): string {
  return joinPath(ensureBaseDir(), CACHE_META_KEY)
}

function loadMeta(strict = false): UgoiraCacheMeta {
  const path = cacheMetaPath()
  recoverFile(path)
  if (!FileManager.existsSync(path)) return {}
  try {
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as UgoiraCacheMeta
    if (strict) throw new Error("动图缓存元数据格式错误")
    return {}
  } catch (error) {
    if (strict) throw error
    return {}
  }
}

function saveMeta(meta: UgoiraCacheMeta): void {
  writeTextSafely(cacheMetaPath(), JSON.stringify(meta), (raw) => {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("动图缓存元数据格式错误")
    }
  })
}

function isUsableFile(path: string): boolean {
  if (!FileManager.existsSync(path)) return false
  try {
    const stat = FileManager.statSync(path)
    return stat.size > 0
  } catch {
    return false
  }
}

function tryCalculateDirSize(dir: string): number | null {
  let total = 0
  try {
    if (!FileManager.existsSync(dir)) return 0
    for (const name of FileManager.readDirectorySync(dir, true)) {
      const full = joinPath(dir, name)
      if (FileManager.isFileSync(full)) {
        const size = FileManager.statSync(full).size
        if (!Number.isFinite(size) || size < 0) return null
        total += size
      }
    }
    return total
  } catch {
    // 失败或部分扫描不能覆盖上一次完整尺寸。
    return null
  }
}

function calculateDirSize(dir: string): number {
  return tryCalculateDirSize(dir) ?? 0
}

const pendingTouches = new Map<string, { lastAccess: number; size?: number }>()

function flushPendingTouches(): boolean {
  if (pendingTouches.size === 0) return true
  const touches = new Map(pendingTouches)
  pendingTouches.clear()
  try {
    const meta = loadMeta(true)
    let changed = false
    for (const [id, touch] of touches) {
      const entry = meta[id]
      if (entry) {
        entry.lastAccess = Math.max(entry.lastAccess || 0, touch.lastAccess)
        if (touch.size != null && touch.size >= 0) {
          entry.size = touch.size
        }
        changed = true
      }
    }
    if (changed) {
      saveMeta(meta)
    }
    return true
  } catch {
    for (const [id, touch] of touches) pendingTouches.set(id, touch)
    sizeMaintenancePending = true
    return false
  }
}

// 仅目录内容变化时传 workDir 重新计量；普通缓存命中只更新 LRU。
function touchUgoira(id: string, workDir?: string): void {
  let dirSize: number | undefined
  if (workDir && FileManager.existsSync(workDir)) {
    try {
      dirSize = tryCalculateDirSize(workDir) ?? undefined
      if (dirSize == null) lastReconcileTime = null
    } catch {}
  }
  if (dirSize != null) sizeMaintenancePending = true
  const previous = pendingTouches.get(id)
  pendingTouches.set(id, {
    lastAccess: Date.now(),
    size: dirSize ?? previous?.size,
  })

  if (ugoiraMetaSaveTimer != null) clearTimeout(ugoiraMetaSaveTimer)
  ugoiraMetaSaveTimer = setTimeout(() => {
    ugoiraMetaSaveTimer = null
    flushPendingTouches()
    // 只提交尺寸与访问时间；返回给导出消费者的路径不能被新增定时清理删除。
    // 限额仍由已有静态维护、下一次准备或用户显式维护触发。
  }, 3000)
}

function ugoiraWorkDir(illustID: number): string {
  return joinPath(ensureBaseDir(), String(illustID))
}

/**
 * 检查动图序列帧是否已在缓存中完好就绪
 */
export function cachedUgoiraFrames(illustID: number): UgoiraFramesResult | null {
  const mem = memoryFramesCache.get(illustID)
  if (mem && FileManager.existsSync(mem.framesDir)) {
    return mem
  }

  const idStr = String(illustID)
  const meta = loadMeta()
  const entry = meta[idStr]
  const workDir = ugoiraWorkDir(illustID)
  const framesDir = joinPath(workDir, "frames")
  const zipPath = joinPath(workDir, "frames.zip")

  // 清理历史遗留的冗余 zip 文件（瘦身优化）
  let removedZip = false
  if (FileManager.existsSync(zipPath)) {
    try { FileManager.removeSync(zipPath); removedZip = true } catch {}
  }

  if (entry && Array.isArray(entry.frames) && entry.frames.length > 0 && FileManager.existsSync(framesDir)) {
    // 校验首帧和尾帧存在
    const firstPath = joinPath(framesDir, entry.frames[0].file)
    const lastPath = joinPath(framesDir, entry.frames[entry.frames.length - 1].file)
    if (isUsableFile(firstPath) && isUsableFile(lastPath)) {
      touchUgoira(idStr, removedZip ? workDir : undefined)
      const res: UgoiraFramesResult = {
        illustID,
        framesDir,
        frames: entry.frames,
        totalDurationMs: entry.totalDurationMs || entry.frames.reduce((sum, f) => sum + (f.delay || 0), 0),
        width: entry.width,
        height: entry.height,
      }
      memoryFramesCache.set(illustID, res)
      return res
    }
  }

  // 缓存损坏则清理元数据
  memoryFramesCache.delete(illustID)
  if (entry) {
    delete meta[idStr]
    pendingTouches.delete(idStr)
    try { saveMeta(meta) } catch {}
  }
  return null
}

/**
 * 准备动图序列帧（下载 zip、解压并缓存），支持多请求并发合并与中断取消
 */
export function prepareUgoira(
  illustID: number,
  token?: UgoiraCancellationToken
): Promise<UgoiraFramesResult> {
  const cached = cachedUgoiraFrames(illustID)
  if (cached) return Promise.resolve(cached)

  const active = inflightTasks.get(illustID)
  if (active) return active

  let task: Promise<UgoiraFramesResult>
  task = performPrepare(illustID, token).finally(() => {
    if (inflightTasks.get(illustID) === task) {
      inflightTasks.delete(illustID)
    }
  })
  inflightTasks.set(illustID, task)
  return task
}

async function performPrepare(
  illustID: number,
  token?: UgoiraCancellationToken
): Promise<UgoiraFramesResult> {
  const generation = cacheGeneration
  const taskID = `${illustID}_${Date.now()}_${++taskSequence}`
  const taskDir = joinPath(FileManager.temporaryDirectory, `PixivUgoiraPrep_${taskID}`)
  const tempZipPath = joinPath(taskDir, "frames.zip")
  const tempFramesDir = joinPath(taskDir, "frames")
  FileManager.createDirectorySync(tempFramesDir, true)

  try {
    if (token?.checkOrWait) await token.checkOrWait()
    const metadata = await session.call((t) => ugoiraMetadata(illustID, t))
    if (token?.checkOrWait) await token.checkOrWait()
    const zipUrl = metadata?.zip_urls?.medium
    if (!zipUrl) throw new Error("未找到动图资源")
    const frames: UgoiraFrame[] = metadata.frames ?? []
    if (frames.length === 0) throw new Error("动图帧数据为空")

    const zipData = await downloadBinary(zipUrl, undefined, token?.signal)
    if (token?.checkOrWait) await token.checkOrWait()
    if (!zipData || generation !== cacheGeneration) {
      throw new Error(generation !== cacheGeneration ? "动图缓存已清空，请重试" : "动图帧下载失败")
    }
    FileManager.writeAsDataSync(tempZipPath, zipData)
    if (token?.checkOrWait) await token.checkOrWait()
    await extractZipEntries(tempZipPath, tempFramesDir)
    if (token?.checkOrWait) await token.checkOrWait()
    validateFrames(tempFramesDir, frames)

    // 解压验证完成后，立刻移除临时 zip，释放空间
    if (FileManager.existsSync(tempZipPath)) {
      try { FileManager.removeSync(tempZipPath) } catch {}
    }

    const totalDurationMs = frames.reduce((acc, f) => acc + (f.delay || 0), 0)
    let width = 0
    let height = 0
    try {
      const firstImg = UIImage.fromFile(joinPath(tempFramesDir, frames[0].file))
      if (firstImg) {
        width = firstImg.width
        height = firstImg.height
      }
    } catch {}

    if (generation !== cacheGeneration) throw new Error("动图缓存已清空，请重试")

    // 发布到稳定存储目录（仅保留 frames/ 目录，不保留原始 zip，节省 50% 磁盘占用）
    const workDir = ugoiraWorkDir(illustID)
    if (FileManager.existsSync(workDir)) {
      try { FileManager.removeSync(workDir) } catch {}
    }
    FileManager.createDirectorySync(workDir, true)
    const finalFramesDir = joinPath(workDir, "frames")

    // 移动/发布临时帧图片目录
    publishPreparedFile(tempFramesDir, finalFramesDir)

    const dirSize = tryCalculateDirSize(workDir) ?? undefined
    if (dirSize == null) lastReconcileTime = null
    const meta = loadMeta()
    meta[String(illustID)] = {
      frames,
      totalDurationMs,
      width,
      height,
      lastAccess: Date.now(),
      size: dirSize,
    }
    saveMeta(meta)
    sizeMaintenancePending = true
    enforceUgoiraCacheLimit(false)

    const result: UgoiraFramesResult = {
      illustID,
      framesDir: finalFramesDir,
      frames,
      totalDurationMs,
      width,
      height,
    }
    memoryFramesCache.set(illustID, result)
    return result
  } finally {
    try {
      if (FileManager.existsSync(taskDir)) FileManager.removeSync(taskDir)
    } catch {}
  }
}

/**
 * 将动图序列帧通过 FFmpeg 合成指定格式并返回本地输出路径（供导出使用，支持中断取消）
 */
export async function buildUgoira(
  illustID: number,
  format: "mp4" | "gif" = "mp4",
  token?: UgoiraCancellationToken
): Promise<UgoiraResult> {
  if (token?.checkOrWait) await token.checkOrWait()
  const prep = await prepareUgoira(illustID, token)
  if (token?.checkOrWait) await token.checkOrWait()
  const workDir = ugoiraWorkDir(illustID)
  const duration = Math.max(0.1, prep.totalDurationMs / 1000)

  if (format === "gif") {
    const gifPath = joinPath(workDir, `ugoira_${illustID}.gif`)
    if (isUsableFile(gifPath)) {
      touchUgoira(String(illustID))
      return { mp4Path: gifPath, duration }
    }
    if (token?.checkOrWait) await token.checkOrWait()
    await exportFramesToGif(prep.framesDir, prep.frames, gifPath)
    if (token?.checkOrWait) await token.checkOrWait()
    touchUgoira(String(illustID), workDir)
    return { mp4Path: gifPath, duration }
  } else {
    const mp4Path = joinPath(workDir, `ugoira_${illustID}.mp4`)
    if (isUsableFile(mp4Path)) {
      touchUgoira(String(illustID))
      return { mp4Path, duration }
    }
    if (token?.checkOrWait) await token.checkOrWait()
    await exportFramesToMp4(prep.framesDir, prep.frames, mp4Path)
    if (token?.checkOrWait) await token.checkOrWait()
    touchUgoira(String(illustID), workDir)
    return { mp4Path, duration }
  }
}

/**
 * 兼容旧版的 cachedUgoira 查询（若已有 MP4 直接返回）
 */
export function cachedUgoira(illustID: number): UgoiraResult | null {
  const workDir = ugoiraWorkDir(illustID)
  const mp4Path = joinPath(workDir, `ugoira_${illustID}.mp4`)
  if (isUsableFile(mp4Path)) {
    const prep = cachedUgoiraFrames(illustID)
    const duration = prep ? prep.totalDurationMs / 1000 : 1
    return { mp4Path, duration }
  }
  return null
}

function validateFrames(framesDir: string, frames: UgoiraFrame[]): void {
  for (const frame of frames) {
    const path = joinPath(framesDir, frame.file)
    if (!isUsableFile(path)) throw new Error(`动图帧缺失：${frame.file}`)
  }
  const first = UIImage.fromFile(joinPath(framesDir, frames[0].file))
  if (!first || first.width <= 0 || first.height <= 0) {
    throw new Error("动图首帧无法解码")
  }
}

async function extractZipWithPython(zipPath: string, destDir: string): Promise<boolean> {
  try {
    if (typeof Python === "undefined" || !Python.run) {
      return false
    }
    const pyCode = `
import zipfile, os, sys

zip_path = ${JSON.stringify(zipPath)}
dest_dir = ${JSON.stringify(destDir)}

try:
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for member in zf.infolist():
            filename = os.path.basename(member.filename)
            if not filename or filename.startswith('.'):
                continue
            target_path = os.path.join(dest_dir, filename)
            with zf.open(member) as source, open(target_path, 'wb') as target:
                target.write(source.read())
    print('SUCCESS')
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`
    const res = await Python.run(pyCode)
    return Boolean(res && res.exitCode === 0)
  } catch (err) {
    console.log("extractZipWithPython exception:", err)
    return false
  }
}

async function extractZipWithArchive(zipPath: string, destDir: string): Promise<boolean> {
  try {
    if (typeof Archive === "undefined" || !Archive.openForMode) {
      return false
    }
    const archive = Archive.openForMode(zipPath, "read")
    const entries = archive.getEntryPaths()
    for (const entry of entries) {
      const name = entry.split("/").pop()
      if (!name || name === "." || name === "..") continue
      archive.extractToSync(entry, joinPath(destDir, name))
    }
    return true
  } catch (err) {
    console.log("extractZipWithArchive exception:", err)
    return false
  }
}

async function extractZipEntries(zipPath: string, destDir: string): Promise<void> {
  // 1. 优先使用免 PRO 的 Python zipfile 标准库解压（快速、稳定、无会员限制）
  const pySuccess = await extractZipWithPython(zipPath, destDir)
  if (pySuccess) {
    return
  }

  // 2. 若 Python 不可用，回退尝试原生 Archive
  const archiveSuccess = await extractZipWithArchive(zipPath, destDir)
  if (archiveSuccess) {
    return
  }

  throw new Error("动图压缩包解压失败：系统解压组件不可用")
}

/**
 * 按 LRU 清理超出上限的动图缓存
 */
export function enforceUgoiraCacheLimit(forceReconcile = true): void {
  const settings = loadSettings()
  if (settings.cacheLimitMB == null) {
    lastLimitMB = null
    return
  }
  const now = Date.now()
  const limitChanged = lastLimitMB !== settings.cacheLimitMB
  const reconcile = forceReconcile || limitChanged || lastReconcileTime == null ||
    now < lastReconcileTime || now - lastReconcileTime >= UGOIRA_RECONCILE_MS
  // 静态图片每三秒的维护不再连带读元数据、递归统计全部动图帧。
  if (!reconcile && !sizeMaintenancePending) return
  if (!flushPendingTouches()) return
  const limitBytes = Math.round(settings.cacheLimitMB * 1024 * 1024 * 0.15)
  const meta = loadMeta(true)
  let changed = false

  let reconcileFailed = false
  if (reconcile) {
    for (const [id, v] of Object.entries(meta)) {
      const workDir = ugoiraWorkDir(Number(id))
      if (!FileManager.existsSync(workDir)) {
        delete meta[id]
        memoryFramesCache.delete(Number(id))
        changed = true
        continue
      }
      const oldZip = joinPath(workDir, "frames.zip")
      if (FileManager.existsSync(oldZip)) {
        try { FileManager.removeSync(oldZip) } catch {}
      }
      const size = tryCalculateDirSize(workDir)
      if (size == null) { reconcileFailed = true; continue }
      if (v.size !== size) { v.size = size; changed = true }
      if (v.lastAccess == null) { v.lastAccess = now; changed = true }
    }
    lastReconcileTime = reconcileFailed ? null : now
  }
  lastLimitMB = settings.cacheLimitMB
  sizeMaintenancePending = reconcileFailed
  const entries = Object.entries(meta)
  let total = entries.reduce((sum, [, v]) => sum + (v.size || 0), 0)
  if (total > limitBytes) {
    const sorted = entries.sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0))
    for (const [id, v] of sorted) {
      if (total <= limitBytes) break
      const workDir = ugoiraWorkDir(Number(id))
      try {
        if (FileManager.existsSync(workDir)) FileManager.removeSync(workDir)
      } catch {
        // 删除失败不虚报已释放容量，下一次维护继续尝试。
        sizeMaintenancePending = true
        continue
      }
      delete meta[id]
      pendingTouches.delete(id)
      memoryFramesCache.delete(Number(id))
      total -= v.size || 0
      changed = true
    }
  }
  if (changed) {
    try { saveMeta(meta) } catch {
      lastReconcileTime = null
      sizeMaintenancePending = true
    }
  }
}

/**
 * 动图缓存占用（字节）
 */
export function ugoiraCacheUsageBytes(): number {
  const dir = ensureBaseDir()
  return calculateDirSize(dir)
}

/**
 * 清空动图缓存
 */
export function clearUgoiraCache(): void {
  cacheGeneration += 1
  lastReconcileTime = null
  lastLimitMB = undefined
  sizeMaintenancePending = false
  pendingTouches.clear()
  memoryFramesCache.clear()
  if (ugoiraMetaSaveTimer != null) {
    clearTimeout(ugoiraMetaSaveTimer)
    ugoiraMetaSaveTimer = null
  }
  const dir = ensureBaseDir()
  try {
    if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
    FileManager.createDirectorySync(dir, true)
  } catch {}
  baseDir = null
}
