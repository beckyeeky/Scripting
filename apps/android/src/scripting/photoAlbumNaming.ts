/**
 * Android 相册保存的命名与宿主能力判定（纯函数）
 *
 * 保存链路：Pix-Scripting/src/downloader/photoAlbum.ts -> scripting 全局 Photos
 * -> hostGlobals.ts -> PixImageMediaModule.saveMediaToGallery -> MediaStore
 *
 * 这里集中处理 DISPLAY_NAME / RELATIVE_PATH 的清洗与长度限制，以及
 * “宿主是否真的支持资产反查”的能力标记，便于桌面 node --test 直接覆盖。
 */

export const DEFAULT_PHOTO_ALBUM_NAME = "Pix-Scripting"
/** 文件名主干上限（按 Unicode 码点计），为扩展名与 255 字节文件系统限制留余量 */
export const MAX_ALBUM_FILE_STEM_LENGTH = 60
/** RELATIVE_PATH 相册目录名上限（按 Unicode 码点计） */
export const MAX_PHOTO_ALBUM_NAME_LENGTH = 60

// MediaStore 文件名/目录名中不安全或会改变路径语义的字符：控制符与 <>:"/\|?*
const ILLEGAL_NAME_CHARS = /[\u0000-\u001F\u007F<>:"/\\|?*]/g
const VALID_EXTENSION = /^[A-Za-z0-9]{1,10}$/

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function baseNameOf(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  const slash = normalized.lastIndexOf("/")
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

function limitCodePoints(value: string, max: number): string {
  // Array.from 按码点切分，避免截断 emoji 等代理对后产生非法 UTF-16
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join("")
}

function normalizeExtension(value: unknown, fallback = "jpg"): string {
  const raw = trimmedString(value).replace(/^\./, "").toLowerCase()
  return VALID_EXTENSION.test(raw) ? raw : fallback
}

/**
 * 从源文件路径推断扩展名；无扩展名时按媒体类型回退（image -> jpg, video -> mp4）
 */
export function mediaExtensionFromPath(path: unknown, mediaType: "image" | "video" = "image"): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(trimmedString(path))
  if (match) return match[1].toLowerCase()
  return mediaType === "video" ? "mp4" : "jpg"
}

/**
 * 清洗调用方传入的文件名，得到可直接写入 MediaStore DISPLAY_NAME 的名称。
 *
 * - 只取最后一段路径，阻断 "../" 与目录穿越
 * - 非法字符替换为 "_"，并折叠连续下划线
 * - 保留合法扩展名；缺失或非法时使用 fallbackExtension（默认 jpg）
 * - 主干按码点限制长度，去除首尾空白/点/下划线
 *
 * 清洗后为空返回 null，调用方应回退到源文件名，避免写出 "." 之类的空名。
 */
export function sanitizeAlbumFileName(rawFileName: unknown, fallbackExtension?: unknown): string | null {
  const fallbackExt = normalizeExtension(fallbackExtension)
  const base = baseNameOf(trimmedString(rawFileName))
  if (!base) return null

  const replaced = base.replace(ILLEGAL_NAME_CHARS, "_").replace(/_+/g, "_").trim()
  let stem = replaced
  let ext = fallbackExt

  const dot = replaced.lastIndexOf(".")
  if (dot > 0 && dot < replaced.length - 1) {
    const candidate = replaced.slice(dot + 1)
    if (VALID_EXTENSION.test(candidate)) {
      stem = replaced.slice(0, dot)
      ext = candidate.toLowerCase()
    }
  }

  stem = limitCodePoints(stem, MAX_ALBUM_FILE_STEM_LENGTH)
    .replace(/^[\s._]+/, "")
    .replace(/[\s._]+$/, "")
  if (!stem) return null
  return `${stem}.${ext}`
}

/**
 * 解析相册名（MediaStore RELATIVE_PATH 的最后一段）。
 * 空值/非字符串/清洗后为空时回退到默认相册名；"/" 等字符替换为 "_"，
 * 防止调用方或设置项意外创建多级目录。
 */
export function resolvePhotoAlbumName(rawAlbumName: unknown): string {
  const raw = trimmedString(rawAlbumName)
  if (!raw) return DEFAULT_PHOTO_ALBUM_NAME

  const cleaned = raw
    .replace(ILLEGAL_NAME_CHARS, "_")
    .replace(/_+/g, "_")
    .replace(/^[\s._]+/, "")
    .replace(/[\s._]+$/, "")
  const limited = limitCodePoints(cleaned, MAX_PHOTO_ALBUM_NAME_LENGTH)
    .replace(/[\s._]+$/, "")
  return limited || DEFAULT_PHOTO_ALBUM_NAME
}

/**
 * 宿主是否接受保存时的 fileName / albumName 选项。
 * 仅当宿主显式声明 supportsAlbumOptions 时才传 albumName，
 * 保证 iOS Scripting 宿主的原有调用参数不变。
 */
export function supportsAlbumSaveOptions(photos: unknown): boolean {
  const target = photos as { supportsAlbumOptions?: unknown } | null | undefined
  return Boolean(target && typeof target === "object" && target.supportsAlbumOptions === true)
}

/**
 * 是否值得在保存后反查新增资产。
 * Android 宿主的 Photos.fetchAssets 恒返回 []，必须显式标记 supportsAssetLookup=false，
 * 否则共享层会执行 4 轮空轮询（100/200/300ms 阶梯等待，合计约 600ms）。
 */
export function shouldQuerySavedAssets(photos: unknown): boolean {
  const target = photos as { supportsAssetLookup?: unknown; fetchAssets?: unknown } | null | undefined
  if (!target || typeof target !== "object") return false
  if (target.supportsAssetLookup === false) return false
  return typeof target.fetchAssets === "function"
}
