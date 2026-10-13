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
  // 源正文或模型/提示词配置变化后旧译文必须重译：即使计数看似完成也不得复用
  if ((snapshot.stale ?? 0) > 0) {
    return `有 ${snapshot.stale} 个段落的原文或模型配置已变化，旧译文已失效，请重新翻译后导出`
  }
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

/**
 * 双语译文源文本：保留原有章节/分页/插图/跳页结构，正文块按「原文 + 译文」成对输出。
 *
 * 校验策略：任一正文/章节块缺少已完成的译文即返回 null（失败回退到单语或提示重试），
 * 绝不输出半双语文档，避免读者看到原文缺失或译文错位。
 * 对齐说明：按「块」成对，块内不做逐句强对齐；调用方不得宣称段落逐句绝对对齐。
 */
export function buildBilingualNovelSource(
  chunks: ExportableNovelChunk[],
  snapshot: NovelTranslationSnapshot | null | undefined,
  options: { translationFirst?: boolean; chapterJoiner?: string } = {}
): string | null {
  if (!snapshot) return null
  const translationFirst = Boolean(options.translationFirst)
  const joiner = options.chapterJoiner ?? " ／ "
  const output: string[] = []

  for (const chunk of chunks) {
    if (chunk.type === "text" || chunk.type === "chapter") {
      const block = snapshot.blocks[chunk.id]
      if (block?.status !== "done" || !block.translation?.trim()) return null
      const translation = block.translation.trim()
      if (chunk.type === "chapter") {
        const original = (chunk.title ?? "").trim()
        const title = original
          ? translationFirst
            ? `${translation}${joiner}${original}`
            : `${original}${joiner}${translation}`
          : translation
        output.push(`[chapter:${title}]`)
        continue
      }
      const original = (chunk.text ?? "").trim()
      if (!original) {
        output.push(translation)
        continue
      }
      output.push(translationFirst ? `${translation}\n\n${original}` : `${original}\n\n${translation}`)
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

/** 双语导出前置校验：与单语一致，但明确要求全部段落完成 */
export function bilingualExportIssue(
  snapshot: NovelTranslationSnapshot | null | undefined,
  requireCaption: boolean
): string | null {
  const issue = novelTranslationExportIssue(snapshot, requireCaption)
  if (issue) return issue
  if (!snapshot || snapshot.done < snapshot.total) return "双语导出需要全部段落翻译完成，请先重试未完成段落"
  return null
}

export function buildNovelPlainTextDocument(input: NovelPlainTextInput): string {
  const sections: string[] = [input.title.trim()]
  if (input.author.trim()) sections.push(`作者：${input.author.trim()}`)
  if (input.sourceUrl?.trim()) sections.push(`来源：${input.sourceUrl.trim()}`)
  if (input.caption?.trim()) sections.push(`简介：\n${input.caption.trim()}`)
  sections.push("—— 正文 ——", input.text.trim())
  return `${sections.join("\n\n")}\n`
}
