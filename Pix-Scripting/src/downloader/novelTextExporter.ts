import { getCategoryDirectory, sanitizeFileName } from "./directoryResolver"
import { notifyDownloadFilesChanged } from "./downloadFileManager"
import { writeTextSafely } from "../store/safeFile"

export interface NovelTextExportOptions {
  title: string
  author: string
  content: string
  customFileName?: string
}

export function exportNovelToText(options: NovelTextExportOptions): string | null {
  const content = options.content.trim()
  if (!content) return null

  try {
    const baseName = sanitizeFileName(
      options.customFileName || `${options.title}_${options.author}`,
      "novel"
    )
    const path = `${getCategoryDirectory("novels")}/${baseName}.txt`
    writeTextSafely(path, `${content}\n`)
    notifyDownloadFilesChanged()
    return path
  } catch (error: any) {
    console.log("exportNovelToText failed:", error?.message ?? error)
    return null
  }
}
