import { exportUgoiraToAlbum } from "../../../../Pix-Scripting/src/downloader/ugoiraExporter"
import { withAlbumKeepAlive } from "../../../../Pix-Scripting/src/downloader/photoAlbum"
import { sanitizeFileName } from "../../../../Pix-Scripting/src/downloader/directoryResolver"
import { buildUgoira } from "../../../../Pix-Scripting/src/ugoira/ugoira"
import type { PixivIllustration } from "../../../../Pix-Scripting/src/types"
import {
  deliverExportFile,
  exportDeliveryMessage,
  readExportDirectory,
} from "./exportDirectory"
import type { ExportDeliveryFallbackReason } from "./exportDirectoryNaming"
import { ScriptingPhotos } from "./hostGlobals"

export interface UgoiraDirectoryExportOutcome {
  success: boolean
  format: "mp4" | "gif"
  destination: "saf" | "album"
  /** 已包含回退说明的完整提示；未设置目录时为 undefined，沿用调用方原提示 */
  message?: string
  fallbackReason?: ExportDeliveryFallbackReason
  error?: string
}

/**
 * 动图 MP4/GIF 导出：已选择 SAF 目录且授权有效时优先生成到该目录；
 * 目录写入失败（授权撤销/目录删除/IO 错误）回退系统相册，并返回可见提示。
 * 未选择目录时完全沿用 exportUgoiraToAlbum 的相册行为。
 */
export async function exportUgoiraToDirectoryOrAlbum(
  illust: PixivIllustration,
  onProgress?: (msg: string) => void,
  format: "mp4" | "gif" = "mp4",
  token?: any,
): Promise<UgoiraDirectoryExportOutcome> {
  let state = null
  try {
    state = await readExportDirectory()
  } catch {
    state = null
  }

  if (state?.status !== "ready") {
    const res = await exportUgoiraToAlbum(illust, onProgress, format, token)
    const revokedMessage =
      res.success && state?.status === "revoked"
        ? "自定义导出目录授权已失效，已改为保存到系统相册；请到「设置 → 导出目录」重新选择"
        : undefined
    return {
      success: res.success,
      format,
      destination: "album",
      error: res.error,
      message: revokedMessage,
    }
  }

  return withAlbumKeepAlive(async () => {
    try {
      if (token?.checkOrWait) await token.checkOrWait()
      onProgress?.(format === "mp4" ? "正在合成 MP4 视频…" : "正在合成 GIF 动图…")
      const built = await buildUgoira(illust.id, format, token)
      if (!built?.mp4Path) {
        return {
          success: false,
          format,
          destination: "album" as const,
          error: `${format.toUpperCase()} 合成失败`,
        }
      }

      const baseName = sanitizeFileName(
        `${illust.title}_${illust.user?.name || "Unknown"}_${illust.id}`,
      )
      const fileName = `${baseName}.${format}`
      const delivery = await deliverExportFile(built.mp4Path, { fileName, fallback: "none" })
      if (delivery.mode === "saf") {
        return {
          success: true,
          format,
          destination: "saf" as const,
          message: exportDeliveryMessage(delivery)?.text,
        }
      }

      onProgress?.("自定义导出目录不可用，正在改存系统相册…")
      const saved = format === "mp4"
        ? await ScriptingPhotos.saveVideo(built.mp4Path, { fileName })
        : await ScriptingPhotos.savePhoto(built.mp4Path, { fileName })
      if (!saved) {
        return {
          success: false,
          format,
          destination: "album" as const,
          error: "保存相册失败",
          fallbackReason: delivery.reason,
        }
      }
      return {
        success: true,
        format,
        destination: "album" as const,
        fallbackReason: delivery.reason,
        message: exportDeliveryMessage(delivery, "系统相册")?.text,
      }
    } catch (err: any) {
      if (err?.name === "TaskAbortError" || token?.isCancelled) throw err
      return {
        success: false,
        format,
        destination: "album" as const,
        error: err?.message ?? String(err),
      }
    }
  })
}
