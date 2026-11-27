/**
 * Android 自定义导出目录（SAF）的纯函数集合
 *
 * 链路：设置页 -> PixSystemBridge.pickDirectory（ACTION_OPEN_DOCUMENT_TREE）
 * -> 原生 SharedPreferences 保存 tree URI/显示名 -> exportDirectory.ts
 * -> PixSystemBridge.writeToExportDirectory（DocumentsContract）
 *
 * 这里只放不依赖 react-native / 原生桥的判定与命名逻辑，便于 node --test 直接覆盖。
 */

/** SAF 文件名总长上限（按 Unicode 码点计），为扩展名与 255 字节限制留余量 */
export const MAX_EXPORT_FILE_NAME_LENGTH = 80
/** 未选择目录时设置页展示的默认位置说明 */
export const DEFAULT_EXPORT_DIRECTORY_LABEL = "默认（应用专属目录）"

const ILLEGAL_NAME_CHARS = /[\u0000-\u001F\u007F<>:"\/\\|?*]/g
const VALID_EXTENSION = /^[a-z0-9]{1,10}$/

export type ExportDirectoryStatus = "none" | "ready" | "revoked"
export type ExportDeliveryFallbackReason = "not-configured" | "revoked" | "write-failed"
export type ExportToastTone = "success" | "info" | "error"

export interface ExportDirectoryRecord {
  uri?: string | null
  name?: string | null
}

export interface ExportDirectoryPermissionSnapshot {
  /** ACTION_OPEN_DOCUMENT_TREE 后 takePersistableUriPermission 是否仍持有写权限 */
  writeGranted?: boolean
  /** 读权限（仅用于诊断；写入只依赖写权限） */
  readGranted?: boolean
  /** 目录根文档是否仍可查询（用户删除目录/卸载存储卷时为 false） */
  reachable?: boolean
}

export interface ExportDeliveryResult {
  mode: "saf" | "fallback"
  fileName?: string
  directoryName?: string
  reason?: ExportDeliveryFallbackReason
}

export interface ExportDeliveryMessage {
  text: string
  tone: ExportToastTone
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function limitCodePoints(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join("")
}

function normalizeExtension(value: unknown, fallback = "bin"): string {
  const raw = trimmedString(value).replace(/^\./, "").toLowerCase()
  return VALID_EXTENSION.test(raw) ? raw : fallback
}

/** 从任意路径/显示名中取出最后一段文件名（URI 去掉查询串与目录部分） */
export function fileNameFromPath(raw: unknown): string {
  const trimmed = trimmedString(raw)
  // 只对 URI 去掉查询串/片段；本地文件名里的 "?" 属于非法字符，应由清洗逻辑替换而不是截断。
  const source = trimmed.includes("://") ? trimmed.split(/[?#]/)[0] : trimmed
  if (!source) return ""
  const normalized = source.replace(/\\/g, "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

/**
 * 清洗导出文件名：
 * - 只保留最后一段路径，阻断 "../" 与目录穿越
 * - 非法字符替换为 "_"，折叠连续下划线，去掉首尾空白/点
 * - 保留合法扩展名；缺失或非法时使用 fallbackExtension
 * - 总长度按码点限制，避免截断代理对
 */
export function sanitizeExportFileName(raw: unknown, fallbackExtension = "bin"): string {
  const base = fileNameFromPath(raw)
  const cleaned = base
    .replace(ILLEGAL_NAME_CHARS, "_")
    .replace(/_+/g, "_")
    .trim()
  const dot = cleaned.lastIndexOf(".")
  const hasExtension = dot > 0
  const rawStem = hasExtension ? cleaned.slice(0, dot) : cleaned
  const extension = normalizeExtension(
    hasExtension ? cleaned.slice(dot + 1) : "",
    normalizeExtension(fallbackExtension, "bin"),
  )
  const stem = rawStem.replace(/^[.\s_]+|[.\s_]+$/g, "")
  const safeStem = limitCodePoints(stem, Math.max(1, MAX_EXPORT_FILE_NAME_LENGTH - extension.length - 1))
  return `${safeStem || "export"}.${extension}`
}

/**
 * 重名递增：目标名已存在时生成 "name (1).ext"、"name (2).ext"……
 * 比较忽略大小写与首尾空白，避免 Android 大小写不敏感存储上的覆盖。
 */
export function nextAvailableFileName(
  desired: string,
  existingNames: Iterable<string> = [],
): string {
  const base = sanitizeExportFileName(desired, "bin")
  const taken = new Set<string>()
  for (const name of existingNames || []) {
    const clean = trimmedString(name).toLowerCase()
    if (clean) taken.add(clean)
  }
  if (!taken.has(base.toLowerCase())) return base

  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const extension = dot > 0 ? base.slice(dot) : ""
  for (let index = 1; index <= 9999; index++) {
    const suffix = ` (${index})`
    const maxStem = Math.max(1, MAX_EXPORT_FILE_NAME_LENGTH - suffix.length - extension.length)
    const candidate = `${limitCodePoints(stem, maxStem)}${suffix}${extension}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  // 极端情况：目录里已存在 9999 个同名前缀文件，仍返回一个不冲突的兜底名。
  const suffix = " (10000)"
  const maxStem = Math.max(1, MAX_EXPORT_FILE_NAME_LENGTH - suffix.length - extension.length)
  return `${limitCodePoints(stem, maxStem)}${suffix}${extension}`
}

/**
 * URI 权限状态判定：
 * - 未配置 -> "none"
 * - 持久化授权缺失 / 非 content:// / 根目录不可达 -> "revoked"（需重新选择）
 * - 持有写权限且根目录可查询 -> "ready"
 */
export function evaluateExportDirectoryStatus(
  record: ExportDirectoryRecord | null | undefined,
  snapshot: ExportDirectoryPermissionSnapshot | null | undefined,
): ExportDirectoryStatus {
  const uri = trimmedString(record?.uri)
  if (!uri) return "none"
  if (!/^content:\/\//i.test(uri)) return "revoked"
  if (snapshot?.writeGranted !== true) return "revoked"
  if (snapshot?.reachable === false) return "revoked"
  return "ready"
}

/** 原生查询不到根目录显示名时，从 tree URI 兜底解析（如 primary:Download/Pix -> Pix） */
export function displayNameFromTreeUri(raw: unknown): string {
  const source = trimmedString(raw).split(/[?#]/)[0]
  if (!source) return ""
  const marker = "/tree/"
  const markerIndex = source.indexOf(marker)
  const tail = markerIndex >= 0
    ? source.slice(markerIndex + marker.length)
    : source.slice(source.lastIndexOf("/") + 1)
  let decoded = tail
  try {
    decoded = decodeURIComponent(tail)
  } catch {}
  const afterVolume = decoded.includes(":") ? decoded.slice(decoded.lastIndexOf(":") + 1) : decoded
  const parts = afterVolume.split("/").filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : afterVolume
}

/**
 * 生成导出结果提示文案；未配置目录（走既有默认行为）返回 null，由调用方保留原提示。
 * 失败文案必须指出已回退的位置并提示重新选择，避免用户误以为文件丢失。
 */
export function exportDeliveryMessage(
  result: ExportDeliveryResult,
  fallbackLabel = "默认位置",
): ExportDeliveryMessage | null {
  if (result.mode === "saf") {
    const directory = result.directoryName || "自定义目录"
    const filePart = result.fileName ? ` / ${result.fileName}` : ""
    return { text: `已保存到「${directory}」${filePart}`, tone: "success" }
  }
  if (result.reason === "revoked") {
    return {
      text: `导出目录授权已失效，已回退到${fallbackLabel}；请到「设置 → 导出目录」重新选择`,
      tone: "error",
    }
  }
  if (result.reason === "write-failed") {
    return {
      text: `自定义导出目录写入失败，已回退到${fallbackLabel}；可重新选择目录后重试`,
      tone: "error",
    }
  }
  return null
}
