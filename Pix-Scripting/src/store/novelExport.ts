import type { NovelTranslationSnapshot } from "./novelTranslation"

export interface ExportableNovelChunk {
  type: "text" | "newpage" | "chapter" | "uploadedimage" | "pixivimage" | "jump"
  id: string
  text?: string
  page?: number
  title?: string
  imageId?: string
  illustId?: number
}

export interface NovelPlainTextInput {
  title: string
  author: string
  caption?: string | null
  text: string
  sourceUrl?: string
}

/** 返回译文导出尚缺少的内容；null 表示标题、简介和全部正文块均可导出。 */
export function novelTranslationExportIssue(
  snapshot: NovelTranslationSnapshot | null | undefined,
  requireCaption: boolean
): string | null {
  if (!snapshot) return "请先完成本篇小说翻译"
  if (!snapshot.translatedTitle?.trim()) return "译文标题尚未生成，请继续翻译"
  if (requireCaption && !snapshot.translatedCaption?.trim()) {
    return "译文简介尚未生成，请重试译名、摘要与术语"
  }
  if (snapshot.total <= 0) return "没有可导出的译文正文"
  if (snapshot.failed > 0) return `仍有 ${snapshot.failed} 个段落翻译失败，请重试后导出`
  if (snapshot.done < snapshot.total) {
    return `译文尚未完成（${snapshot.done}/${snapshot.total}），请完成翻译后导出`
  }
  return null
}

/**
 * 把已经完成的逐块译文还原为 Pixiv 小说源文本。
 * 页面、章节、插图和跳页标记会保留，使 EPUB 导出仍能生成原有结构。
 */
export function buildTranslatedNovelSource(
  chunks: ExportableNovelChunk[],
  snapshot: NovelTranslationSnapshot | null | undefined
): string | null {
  if (!snapshot) return null
  const output: string[] = []

  for (const chunk of chunks) {
    if (chunk.type === "text" || chunk.type === "chapter") {
      const block = snapshot.blocks[chunk.id]
      if (block?.status !== "done" || !block.translation?.trim()) return null
      output.push(chunk.type === "chapter"
        ? `[chapter:${block.translation.trim()}]`
        : block.translation)
      continue
    }
    if (chunk.type === "newpage") {
      output.push("[newpage]")
    } else if (chunk.type === "jump" && chunk.page) {
      output.push(`[jump:${chunk.page}]`)
    } else if (chunk.type === "uploadedimage" && chunk.imageId) {
      output.push(`[uploadedimage:${chunk.imageId}]`)
    } else if (chunk.type === "pixivimage" && chunk.illustId) {
      output.push(`[pixivimage:${chunk.illustId}${chunk.page ? `-${chunk.page}` : ""}]`)
    }
  }

  return output.join("\n\n").trim()
}

export function buildNovelPlainTextDocument(input: NovelPlainTextInput): string {
  const sections: string[] = [input.title.trim()]
  if (input.author.trim()) sections.push(`作者：${input.author.trim()}`)
  if (input.sourceUrl?.trim()) sections.push(`来源：${input.sourceUrl.trim()}`)
  if (input.caption?.trim()) sections.push(`简介：\n${input.caption.trim()}`)
  sections.push("—— 正文 ——", input.text.trim())
  return `${sections.join("\n\n")}\n`
}
