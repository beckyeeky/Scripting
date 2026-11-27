/**
 * Pure classification of Android VIEW / SEND intents handed over by PixSystemBridge.
 *
 * Kept free of React Native and host imports so the routing rules can be covered by
 * desktop Node regressions (`apps/android/tests/share-intent-routing.test.cjs`).
 */

export interface IncomingIntentFile {
  filePath?: string | null
  name?: string | null
  mimeType?: string | null
  size?: number | null
}

export interface IncomingIntent {
  kind?: string | null
  url?: string | null
  text?: string | null
  files?: IncomingIntentFile[] | null
  failedFileCount?: number | null
}

export type IncomingIntentPlan =
  | { type: "url"; url: string }
  | { type: "share-image"; filePath: string; name: string; mimeType: string }
  | { type: "share-archive"; filePath: string; name: string; mimeType: string }
  | { type: "share-json"; filePath: string; name: string; mimeType: string }
  | { type: "share-text-file"; filePath: string; name: string; mimeType: string }
  | { type: "share-text"; text: string }
  | { type: "share-unreadable"; message: string }
  | { type: "share-unsupported"; message: string }
  | { type: "ignore" }

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".avif"]

function fileNameOf(file: IncomingIntentFile): string {
  const explicit = typeof file.name === "string" ? file.name.trim() : ""
  if (explicit) return explicit
  const path = typeof file.filePath === "string" ? file.filePath : ""
  const segment = path.split(/[\\/]/).filter(Boolean).pop()
  return segment || "shared-file"
}

function extensionOf(name: string, filePath: string): string {
  const source = (name || filePath || "").toLowerCase().split(/[?#]/)[0]
  const dot = source.lastIndexOf(".")
  if (dot < 0 || dot < source.length - 12) return ""
  return source.slice(dot)
}

function mimeOf(file: IncomingIntentFile): string {
  return typeof file.mimeType === "string" ? file.mimeType.trim().toLowerCase() : ""
}

function isImageFile(file: IncomingIntentFile): boolean {
  if (mimeOf(file).startsWith("image/")) return true
  return IMAGE_EXTENSIONS.includes(extensionOf(fileNameOf(file), file.filePath || ""))
}

function isArchiveFile(file: IncomingIntentFile): boolean {
  const mime = mimeOf(file)
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return true
  return extensionOf(fileNameOf(file), file.filePath || "") === ".zip"
}

function isJsonFile(file: IncomingIntentFile): boolean {
  if (mimeOf(file).includes("json")) return true
  return extensionOf(fileNameOf(file), file.filePath || "") === ".json"
}

function isTextFile(file: IncomingIntentFile): boolean {
  if (mimeOf(file).startsWith("text/")) return true
  const ext = extensionOf(fileNameOf(file), file.filePath || "")
  return ext === ".txt" || ext === ".md" || ext === ".yaml" || ext === ".yml"
}

function describeFile(file: IncomingIntentFile): string {
  return mimeOf(file) || fileNameOf(file) || "未知文件"
}

/**
 * Maps a bridge intent to a single action. Attachment MIME/extension wins over the
 * optional EXTRA_TEXT caption, so sharing a photo with a caption still opens the
 * image search instead of trying to import the caption as configuration text.
 */
export function resolveIncomingIntent(intent: IncomingIntent | null | undefined): IncomingIntentPlan {
  if (!intent || typeof intent !== "object") return { type: "ignore" }

  if (intent.kind === "url") {
    const url = typeof intent.url === "string" ? intent.url.trim() : ""
    return url ? { type: "url", url } : { type: "ignore" }
  }

  if (intent.kind !== "share") return { type: "ignore" }

  const files = Array.isArray(intent.files) ? intent.files : []
  const readable = files.find(
    (file): file is IncomingIntentFile & { filePath: string } =>
      Boolean(file) && typeof file.filePath === "string" && file.filePath.trim().length > 0,
  )

  if (!readable) {
    const failed = Math.max(0, Number(intent.failedFileCount) || 0)
    if (failed > 0) {
      return {
        type: "share-unreadable",
        message: `无法读取分享的 ${failed} 个文件（可能是权限不足或文件已被移动），请重新分享。`,
      }
    }
    if (files.length > 0) {
      return {
        type: "share-unreadable",
        message: "无法读取分享的文件（缺少本地缓存路径），请重新分享。",
      }
    }
    const text = typeof intent.text === "string" ? intent.text.trim() : ""
    if (text) return { type: "share-text", text }
    return {
      type: "share-unreadable",
      message: "没有收到可读取的分享内容，请重试。",
    }
  }

  const filePath = readable.filePath.trim()
  const name = fileNameOf(readable)
  const mimeType = mimeOf(readable) || "application/octet-stream"

  if (isImageFile(readable)) {
    return { type: "share-image", filePath, name, mimeType }
  }
  if (isArchiveFile(readable)) {
    return { type: "share-archive", filePath, name, mimeType }
  }
  if (isJsonFile(readable)) {
    return { type: "share-json", filePath, name, mimeType }
  }
  if (isTextFile(readable)) {
    return { type: "share-text-file", filePath, name, mimeType }
  }

  return {
    type: "share-unsupported",
    message: `暂不支持分享该类型的文件（${describeFile(readable)}），可分享图片进行以图搜图。`,
  }
}
