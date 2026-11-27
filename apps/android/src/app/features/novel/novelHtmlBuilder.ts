import type {
  NovelFontId,
  NovelFontWeight,
  NovelLineSpacingLevel,
  NovelReaderSettings,
} from "../../../../../../Pix-Scripting/src/store/novelReaderSettings"
import type { NovelTranslationSnapshot } from "../../../../../../Pix-Scripting/src/store/novelTranslation"
import type { TextEmbeddedImage } from "../../../../../../Pix-Scripting/src/types"
import {
  escapeNovelHtml,
  formatNovelInlineHtml,
} from "../../../../../../Pix-Scripting/src/ui/novelInlineMarkup"
import {
  NOVEL_READER_RUNTIME_CSS,
  NOVEL_READER_RUNTIME_JS,
} from "../../../../../../Pix-Scripting/src/ui/novelReaderRuntime"

export type NovelChunkType =
  | "text"
  | "newpage"
  | "chapter"
  | "uploadedimage"
  | "pixivimage"
  | "jump"

export interface NovelChunkItem {
  type: NovelChunkType
  id: string
  text?: string
  page?: number
  chapter?: number
  title?: string
  imageId?: string
  info?: TextEmbeddedImage
  illustId?: number
}

export interface NovelPageBlock {
  page: number
  items: NovelChunkItem[]
}

export type NovelReaderThemeId = "system" | "light" | "sepia" | "dark"

interface NovelParserState {
  pageIndex: number
  chapterIndex: number
  currentBuffer: string[]
  currentBufferChars: number
  items: NovelChunkItem[]
}

function flushTextBuffer(state: NovelParserState): void {
  if (state.currentBuffer.length === 0) return
  const rawJoined = state.currentBuffer.join("\n")
  if (rawJoined.replace(/[\s\r\n\u3000]/g, "").length > 0) {
    const text = rawJoined.replace(/^(?:[\r\n]+)/, "").replace(/(?:[\r\n]+)$/, "")
    if (text.length > 0) {
      state.items.push({
        type: "text",
        id: `chunk-${state.items.length}`,
        text,
      })
    }
  }
  state.currentBuffer = []
  state.currentBufferChars = 0
}

function processLineIntoNovelItems(
  rawLine: string,
  state: NovelParserState,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>,
): void {
  const trimmedLine = rawLine.trim()

  // 1. [newpage]
  if (/^\[newpage\]$/i.test(trimmedLine)) {
    flushTextBuffer(state)
    state.pageIndex += 1
    state.items.push({
      type: "newpage",
      id: `page-${state.pageIndex}`,
      page: state.pageIndex,
    })
    return
  }

  // 2. [chapter: xxx]
  const chapterMatch = trimmedLine.match(/^(?:\[|［)chapter\s*[:：]\s*(.*)(?:\]|］)$/i)
  if (chapterMatch) {
    flushTextBuffer(state)
    state.chapterIndex += 1
    const rawContent = chapterMatch[1].trim()
    const cleanTitle = rawContent
      .replace(
        /^(?:\[{1,2}|［{1,2})[bB]\s*[:：]\s*([\s\S]+?)(?:\]{1,2}|］{1,2})$/,
        "$1",
      )
      .trim()
    state.items.push({
      type: "chapter",
      id: `chapter-${state.chapterIndex}`,
      title: cleanTitle,
    })
    return
  }

  // 3. [jump: page]
  const jumpMatch = trimmedLine.match(/^\[jump\s*[:：]\s*(\d+)\]$/i)
  if (jumpMatch) {
    flushTextBuffer(state)
    const targetPage = parseInt(jumpMatch[1], 10)
    state.items.push({
      type: "jump",
      id: `jump-${targetPage}-${state.items.length}`,
      page: targetPage,
    })
    return
  }

  // 4. [uploadedimage: xxx]
  const UP_IMG_INLINE = /\[uploadedimage\s*[:：]\s*([^\s\]]+)\s*\]/gi
  if (UP_IMG_INLINE.test(rawLine)) {
    UP_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = UP_IMG_INLINE.exec(rawLine)) != null) {
      const before = rawLine.slice(cursor, match.index)
      if (before) {
        state.currentBuffer.push(before)
        state.currentBufferChars += before.length
      }
      cursor = UP_IMG_INLINE.lastIndex
      flushTextBuffer(state)
      const imageId = match[1].trim()
      const info = textEmbeddedImages
        ? textEmbeddedImages[imageId] ||
          (textEmbeddedImages as any)[Number(imageId)] ||
          Object.values(textEmbeddedImages).find(
            (img: any) => img?.novelImageId === imageId || img?.id === imageId,
          )
        : undefined
      state.items.push({
        type: "uploadedimage",
        id: `up-${imageId}-${state.items.length}`,
        imageId,
        info,
      })
    }
    if (cursor < rawLine.length) {
      const remaining = rawLine.slice(cursor)
      if (remaining) {
        state.currentBuffer.push(remaining)
        state.currentBufferChars += remaining.length + 1
      }
    }
    if (state.currentBufferChars > 1500) {
      flushTextBuffer(state)
    }
    return
  }

  // 5. [pixivimage: xxx]
  const PX_IMG_INLINE = /\[pixivimage\s*[:：]\s*(\d+)(?:-(\d+))?\s*\]/gi
  if (PX_IMG_INLINE.test(rawLine)) {
    PX_IMG_INLINE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = PX_IMG_INLINE.exec(rawLine)) != null) {
      const before = rawLine.slice(cursor, match.index)
      if (before) {
        state.currentBuffer.push(before)
        state.currentBufferChars += before.length
      }
      cursor = PX_IMG_INLINE.lastIndex
      flushTextBuffer(state)
      const illustId = parseInt(match[1], 10)
      const page = match[2] ? parseInt(match[2], 10) : undefined
      state.items.push({
        type: "pixivimage",
        id: `px-${illustId}-${page || 0}-${state.items.length}`,
        illustId,
        page,
      })
    }
    if (cursor < rawLine.length) {
      const remaining = rawLine.slice(cursor)
      if (remaining) {
        state.currentBuffer.push(remaining)
        state.currentBufferChars += remaining.length + 1
      }
    }
    if (state.currentBufferChars > 1500) {
      flushTextBuffer(state)
    }
    return
  }

  state.currentBuffer.push(rawLine)
  state.currentBufferChars += rawLine.length + 1

  if (state.currentBufferChars > 1500) {
    flushTextBuffer(state)
  }
}

/**
 * Byte-exact parity with iOS `Pix-Scripting/src/ui/NovelReader.tsx` `parseNovelToChunks`,
 * preserving identical `chunk-N`, `chapter-N`, `page-N`, `jump-P-N`, `up-ID-N`, `px-ID-P-N` IDs
 * so translation ledgers, anchors, outline, search, and offline image caches align 1:1.
 */
export function parseNovelToChunks(
  rawText: string,
  textEmbeddedImages?: Record<string, TextEmbeddedImage>,
): NovelChunkItem[] {
  if (!rawText) return []
  const lines = rawText.split(/\r?\n/)
  const state: NovelParserState = {
    pageIndex: 1,
    chapterIndex: 0,
    currentBuffer: [],
    currentBufferChars: 0,
    items: [],
  }

  for (let i = 0; i < lines.length; i++) {
    processLineIntoNovelItems(lines[i], state, textEmbeddedImages)
  }

  if (state.currentBuffer.length > 0) {
    flushTextBuffer(state)
  }

  return state.items
}

export function groupChunksByPage(chunks: NovelChunkItem[]): NovelPageBlock[] {
  if (chunks.length === 0) return []
  const pages: NovelPageBlock[] = []
  let currentBlock: NovelPageBlock = { page: 1, items: [] }
  pages.push(currentBlock)

  for (const chunk of chunks) {
    if (chunk.type === "newpage") {
      currentBlock = { page: chunk.page ?? 1, items: [chunk] }
      pages.push(currentBlock)
    } else {
      currentBlock.items.push(chunk)
    }
  }

  return pages
}

export function indexNovelChunkPages(chunks: NovelChunkItem[]): Record<string, number> {
  const result: Record<string, number> = {}
  let currentPage = 1
  for (const chunk of chunks) {
    if (chunk.type === "newpage") currentPage = chunk.page ?? currentPage
    result[chunk.id] = currentPage
  }
  return result
}

export function extractTranslatableBlocks(
  chunks: NovelChunkItem[],
): Array<{ id: string; text: string; kind: "text" | "chapter" }> {
  const blocks: Array<{ id: string; text: string; kind: "text" | "chapter" }> = []
  for (const chunk of chunks) {
    if (chunk.type === "text" && chunk.text && chunk.text.trim()) {
      blocks.push({ id: chunk.id, text: chunk.text, kind: "text" })
    } else if (chunk.type === "chapter" && chunk.title && chunk.title.trim()) {
      blocks.push({ id: chunk.id, text: chunk.title, kind: "chapter" })
    }
  }
  return blocks
}

export function resolveAndroidNovelFontCss(
  fontId: NovelFontId,
  customName?: string | null,
): string {
  if (fontId === "custom" && customName && customName.trim()) {
    const safe = customName.trim().replace(/["'\\<>]/g, "")
    return `"${safe}", "Noto Serif CJK SC", serif`
  }
  switch (fontId) {
    case "songti":
    case "hiragino_mincho":
      return '"Noto Serif CJK SC", "Noto Serif CJK JP", "Songti SC", "Droid Serif", Georgia, serif'
    case "kaiti":
      return '"KaiTi", "STKaiti", "Noto Serif CJK SC", serif'
    case "yuanti":
    case "hiragino_maru":
      return '"Noto Sans CJK SC", "Noto Sans CJK JP", "Hiragino Maru Gothic ProN", sans-serif'
    case "hiragino_sans":
      return '"Noto Sans CJK JP", "Noto Sans CJK SC", "Roboto", sans-serif'
    case "system":
    default:
      return '-apple-system, "Roboto", "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif'
  }
}

export function resolveFontWeightCss(weight: NovelFontWeight): number {
  switch (weight) {
    case "bold":
      return 700
    case "medium":
      return 500
    case "regular":
    default:
      return 400
  }
}

export function resolveLineHeightCss(level: NovelLineSpacingLevel): number {
  switch (level) {
    case "compact":
      return 1.62
    case "loose":
      return 2.15
    case "normal":
    default:
      return 1.88
  }
}

export function resolveReaderThemePalette(
  readerTheme: NovelReaderThemeId,
  systemIsDark: boolean,
): { bg: string; text: string; muted: string; border: string; card: string; accent: string } {
  const effective = readerTheme === "system" ? (systemIsDark ? "dark" : "light") : readerTheme
  if (effective === "dark") {
    return {
      bg: "#121216",
      text: "#E5E5EA",
      muted: "#98989F",
      border: "rgba(255,255,255,0.12)",
      card: "rgba(255,255,255,0.06)",
      accent: "#5AC8FA",
    }
  }
  if (effective === "sepia") {
    return {
      bg: "#F4ECD8",
      text: "#3B2F23",
      muted: "#7A6A58",
      border: "rgba(92,70,48,0.18)",
      card: "rgba(92,70,48,0.07)",
      accent: "#9A5B13",
    }
  }
  return {
    bg: "#FAF9F6",
    text: "#1C1C1E",
    muted: "#6E6E73",
    border: "rgba(0,0,0,0.10)",
    card: "rgba(0,0,0,0.04)",
    accent: "#007AFF",
  }
}

function renderTextLinesHtml(raw: string): string {
  return raw
    .split("\n")
    .map((line) =>
      line.replace(/[\s\u3000]/g, "")
        ? `<p class="paragraph">${formatNovelInlineHtml(line)}</p>`
        : '<div class="empty-line"></div>',
    )
    .join("\n")
}

export interface BuildNovelReaderHtmlOptions {
  novelId: number
  title: string
  author?: string
  caption?: string
  chunks: NovelChunkItem[]
  settings: NovelReaderSettings
  readerTheme: NovelReaderThemeId
  systemIsDark: boolean
  ownerGeneration: number
  safeTopPx?: number
  safeBottomPx?: number
  initialChunkId?: string | null
  initialPage?: number
  initialAnchor?: {
    chunkId?: string | null
    page?: number
    offset?: number
    quote?: string
  } | null
  seriesTitle?: string | null
  seriesPrev?: { id: number; title?: string } | null
  seriesNext?: { id: number; title?: string } | null
  episodeNumber?: number | null
  /** Optional pre-resolved chunkId -> data:image/... URLs (e.g. offline images) */
  initialImages?: Record<string, string>
}

export function buildNovelReaderHtml(opts: BuildNovelReaderHtmlOptions): string {
  const palette = resolveReaderThemePalette(opts.readerTheme, opts.systemIsDark)
  const isVertical = opts.settings.layoutDirection === "vertical"
  const isPaged = opts.settings.pageDisplayMode === "paged"
  const fontFamily = resolveAndroidNovelFontCss(
    opts.settings.fontId,
    opts.settings.customFontPostscriptName,
  )
  const fontSize = Math.max(13, Math.min(34, opts.settings.fontSize || 17))
  const fontWeight = resolveFontWeightCss(opts.settings.fontWeight)
  const lineHeight = resolveLineHeightCss(opts.settings.lineSpacingLevel)
  const safeTop = Math.max(0, Math.round(opts.safeTopPx ?? 24))
  const safeBottom = Math.max(0, Math.round(opts.safeBottomPx ?? 24))
  const pageMap = indexNovelChunkPages(opts.chunks)

  const bodyParts: string[] = []

  // Header block
  const headerClass = isVertical ? "vertical-header" : "novel-header"
  const titleClass = isVertical ? "vertical-header-title" : "novel-header-title"
  const seriesBadge = opts.seriesTitle
    ? `<div class="novel-series-tag">${escapeNovelHtml(opts.seriesTitle)}${
        opts.episodeNumber ? ` · #${opts.episodeNumber}` : ""
      }</div>`
    : ""
  const authorHtml = opts.author
    ? `<div class="novel-author">${escapeNovelHtml(opts.author)}</div>`
    : ""
  bodyParts.push(
    `<header class="${headerClass}">${seriesBadge}<h1 class="${titleClass}">${escapeNovelHtml(
      opts.title || "无题",
    )}</h1>${authorHtml}</header>`,
  )

  // Chunks
  let pageCount = 1
  for (let idx = 0; idx < opts.chunks.length; idx++) {
    const chunk = opts.chunks[idx]
    const page = pageMap[chunk.id] ?? 1
    if (page > pageCount) pageCount = page

    if (chunk.type === "newpage") {
      bodyParts.push(
        `<div id="${escapeNovelHtml(chunk.id)}" class="page-divider${
          isPaged ? " paged-break" : ""
        }" data-chunk-id="${escapeNovelHtml(chunk.id)}" data-chunk-index="${idx}" data-page="${page}"><span>— 第 ${page} 页 —</span></div>`,
      )
      continue
    }

    if (chunk.type === "chapter") {
      bodyParts.push(
        `<div id="${escapeNovelHtml(chunk.id)}" class="chapter-block" data-chunk-id="${escapeNovelHtml(
          chunk.id,
        )}" data-chunk-index="${idx}" data-page="${page}"><h2 class="chapter-title">${formatNovelInlineHtml(
          chunk.title || "",
        )}</h2></div>`,
      )
      continue
    }

    if (chunk.type === "jump") {
      const targetPage = chunk.page || 1
      bodyParts.push(
        `<div id="${escapeNovelHtml(chunk.id)}" class="jump-block" data-chunk-id="${escapeNovelHtml(
          chunk.id,
        )}" data-chunk-index="${idx}" data-page="${page}"><button type="button" class="jump-btn" onclick="handleJumpToPage(${targetPage})">跳转到第 ${targetPage} 页 ↗</button></div>`,
      )
      continue
    }

    if (chunk.type === "uploadedimage") {
      const initialSrc = opts.initialImages?.[chunk.id]
      const imgTag = initialSrc
        ? `<img class="novel-img" src="${escapeNovelHtml(initialSrc)}" alt="插图" />`
        : `<div class="novel-img-placeholder">插图加载中…</div>`
      bodyParts.push(
        `<figure id="${escapeNovelHtml(chunk.id)}" class="image-block" data-chunk-id="${escapeNovelHtml(
          chunk.id,
        )}" data-chunk-index="${idx}" data-page="${page}" data-image-kind="uploaded">${imgTag}</figure>`,
      )
      continue
    }

    if (chunk.type === "pixivimage") {
      const illustId = chunk.illustId || 0
      const initialSrc = opts.initialImages?.[chunk.id]
      const imgTag = initialSrc
        ? `<img class="novel-img" src="${escapeNovelHtml(initialSrc)}" alt="插画 ${illustId}" />`
        : `<div class="novel-img-placeholder">Pixiv 插画 #${illustId} 加载中…</div>`
      bodyParts.push(
        `<figure id="${escapeNovelHtml(chunk.id)}" class="image-block pixiv-illust-block" data-chunk-id="${escapeNovelHtml(
          chunk.id,
        )}" data-chunk-index="${idx}" data-page="${page}" data-illust-id="${illustId}" onclick="handleOpenIllust(${illustId})">${imgTag}<figcaption class="novel-img-caption">点击查看插画 #${illustId}</figcaption></figure>`,
      )
      continue
    }

    // Text chunk
    bodyParts.push(
      `<section id="${escapeNovelHtml(chunk.id)}" class="text-chunk-block" data-chunk-id="${escapeNovelHtml(
        chunk.id,
      )}" data-chunk-index="${idx}" data-page="${page}">${renderTextLinesHtml(
        chunk.text || "",
      )}</section>`,
    )
  }

  // Series Footer Navigation
  if (opts.seriesPrev || opts.seriesNext) {
    const prevBtn = opts.seriesPrev
      ? `<button type="button" class="series-nav-btn series-nav-prev" onclick="handleSeriesNav('prev', ${
          opts.seriesPrev.id
        })">‹ 上一话${opts.seriesPrev.title ? `：${escapeNovelHtml(opts.seriesPrev.title)}` : ""}</button>`
      : `<span class="series-nav-spacer"></span>`
    const nextBtn = opts.seriesNext
      ? `<button type="button" class="series-nav-btn series-nav-next" onclick="handleSeriesNav('next', ${
          opts.seriesNext.id
        })">下一话${opts.seriesNext.title ? `：${escapeNovelHtml(opts.seriesNext.title)}` : ""} ›</button>`
      : `<span class="series-nav-spacer"></span>`
    bodyParts.push(`<footer class="series-nav-bar">${prevBtn}${nextBtn}</footer>`)
  } else {
    bodyParts.push(`<footer class="novel-end-mark">— 全文完 —</footer>`)
  }

  const safeOwnerGen = JSON.stringify(opts.ownerGeneration)
  const safeInitialAnchor = JSON.stringify(opts.initialAnchor ?? null)
  const safeInitialChunk = JSON.stringify(opts.initialChunkId ?? null)
  const safeInitialPage = JSON.stringify(opts.initialPage ?? 1)
  const safeNovelId = JSON.stringify(opts.novelId)
  const safeIsVertical = JSON.stringify(isVertical)

  const layoutCss = isVertical
    ? `
    /* 竖排：只让 html（视口滚动器）承担滚动，body 保持 visible，避免 Chromium 双滚动容器 */
    html {
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      text-orientation: mixed;
      -webkit-text-orientation: mixed;
    }
    body {
      height: 100%;
      overflow: visible;
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      text-orientation: mixed;
      -webkit-text-orientation: mixed;
    }
    .reader-container {
      box-sizing: border-box;
      height: 100%;
      padding: calc(var(--safe-top) + 32px) 24px calc(var(--safe-bottom) + 32px) 24px;
    }
    .vertical-header {
      margin-left: 2.2em;
      padding-left: 1.2em;
      border-left: 1px solid var(--border-color);
    }
    .vertical-header-title {
      font-size: 1.38em;
      font-weight: 700;
      margin: 0 0 0 0.6em;
      line-height: 1.5;
    }
    .chapter-block {
      margin: 0 1.4em 0 1.2em;
      padding-right: 0.6em;
      border-right: 3px solid var(--accent-color);
    }
    .page-divider {
      margin: 0 1.5em;
      color: var(--muted-color);
      font-size: 0.85em;
      text-align: center;
    }
    .paragraph {
      margin: 0 0 0 0.45em;
    }
    .empty-line {
      width: 0.85em;
      height: 100%;
    }
    .image-block {
      margin: 0 1.2em;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .novel-img {
      max-height: calc(100vh - var(--safe-top) - var(--safe-bottom) - 100px);
      max-width: 82vw;
      object-fit: contain;
      border-radius: 10px;
    }
    .series-nav-bar {
      margin-right: 2em;
      display: flex;
      flex-direction: row;
      gap: 12px;
      align-items: center;
    }
    `
    : `
    html, body {
      width: 100%;
      overflow-x: hidden;
      overflow-y: auto;
      writing-mode: horizontal-tb;
    }
    .reader-container {
      box-sizing: border-box;
      max-width: 760px;
      margin: 0 auto;
      padding: calc(var(--safe-top) + 56px) 20px calc(var(--safe-bottom) + 84px) 20px;
    }
    .novel-header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .novel-header-title {
      font-size: 1.42em;
      font-weight: 700;
      margin: 0 0 8px 0;
      line-height: 1.38;
    }
    .chapter-block {
      margin: 26px 0 14px 0;
      padding-left: 12px;
      border-left: 3px solid var(--accent-color);
    }
    .page-divider {
      margin: 28px 0;
      text-align: center;
      color: var(--muted-color);
      font-size: 0.84em;
      letter-spacing: 0.06em;
    }
    .paragraph {
      margin: 0 0 0.72em 0;
    }
    .empty-line {
      height: 0.85em;
    }
    .image-block {
      margin: 18px 0;
      text-align: center;
    }
    .novel-img {
      max-width: 100%;
      max-height: 75vh;
      object-fit: contain;
      border-radius: 10px;
    }
    .series-nav-bar {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    `

  // 分页模式此前只挂 .paged-break 类而无任何样式；这里给出可见页界（页码胶囊 + 断点）
  const pagedBreakChrome = isVertical
    ? `margin: 0 2em;
      padding-right: 26px;
      border-right: 2px dashed var(--border-color);`
    : `margin: 48px 0 34px 0;
      padding-top: 26px;
      border-top: 2px dashed var(--border-color);`
  const pagedCss = isPaged
    ? `
    .page-divider.paged-break {
      ${pagedBreakChrome}
      break-before: page;
      page-break-before: always;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .page-divider.paged-break span {
      display: inline-block;
      padding: 7px 18px;
      border: 1px solid var(--border-color);
      border-radius: 999px;
      background: var(--card-color);
      color: var(--muted-color);
      font-size: 0.78em;
      letter-spacing: 0.14em;
    }
    `
    : ""

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <style>
    :root {
      --bg-color: ${palette.bg};
      --text-color: ${palette.text};
      --muted-color: ${palette.muted};
      --border-color: ${palette.border};
      --card-color: ${palette.card};
      --accent-color: ${palette.accent};
      --safe-top: ${safeTop}px;
      --safe-bottom: ${safeBottom}px;
    }
    html, body {
      margin: 0;
      padding: 0;
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      line-height: ${lineHeight};
      -webkit-text-size-adjust: 100%;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    ${layoutCss}
    ${pagedCss}
    .novel-series-tag {
      font-size: 0.8em;
      color: var(--accent-color);
      font-weight: 600;
      margin-bottom: 6px;
    }
    .novel-author {
      font-size: 0.86em;
      color: var(--muted-color);
    }
    .chapter-title {
      font-size: 1.15em;
      font-weight: 700;
      margin: 0;
      line-height: 1.45;
    }
    ruby rt {
      font-size: 0.56em;
      color: var(--muted-color);
    }
    .novel-emphasis {
      text-emphasis-position: over right;
      -webkit-text-emphasis-position: over right;
    }
    a {
      color: var(--accent-color);
      text-decoration: underline;
    }
    .jump-block {
      margin: 14px 0;
      text-align: center;
    }
    .jump-btn, .series-nav-btn {
      background: var(--card-color);
      color: var(--accent-color);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 10px 16px;
      font-size: 0.9em;
      font-weight: 600;
      cursor: pointer;
    }
    .novel-img-placeholder {
      padding: 20px 14px;
      border-radius: 10px;
      background: var(--card-color);
      border: 1px dashed var(--border-color);
      color: var(--muted-color);
      font-size: 0.85em;
    }
    .novel-img-caption {
      margin-top: 6px;
      font-size: 0.78em;
      color: var(--muted-color);
    }
    .novel-end-mark {
      margin: 36px 0 12px 0;
      text-align: center;
      font-size: 0.85em;
      color: var(--muted-color);
    }
    ${NOVEL_READER_RUNTIME_CSS}
  </style>
</head>
<body>
  <main class="reader-container" id="reader-root">
    ${bodyParts.join("\n")}
  </main>
  <script>
${NOVEL_READER_RUNTIME_JS}
    (function () {
      var novelId = ${safeNovelId};
      var novelOwnerId = ${safeOwnerGen};
      var isVertical = ${safeIsVertical};
      var initialAnchor = ${safeInitialAnchor};
      var targetChunkId = ${safeInitialChunk};
      var targetPage = ${safeInitialPage};
      window.__novelOwnerId = novelOwnerId;

      function postNovelMessage(name, payload) {
        if (window.__novelOwnerId !== novelOwnerId) return false;
        var handlers = window.webkit && window.webkit.messageHandlers;
        if (!handlers || !handlers[name]) return false;
        var body = payload || {};
        body.owner = novelOwnerId;
        handlers[name].postMessage(body);
        return true;
      }

      window.handleLinkClick = function (url) {
        if (url) postNovelMessage("openLink", { url: url });
      };
      window.handleOpenIllust = function (illustId) {
        if (illustId) postNovelMessage("openIllust", { illustId: illustId });
      };
      window.handleJumpToPage = function (page) {
        var el = document.getElementById("page-" + page);
        if (el && window.NovelReaderRuntime) {
          window.NovelReaderRuntime.scrollElementIntoView(el);
        }
        postNovelMessage("jumpToPage", { page: page });
      };
      window.handleSeriesNav = function (action, id) {
        postNovelMessage("onSeriesNav", { action: action, id: id });
      };

      window.applyTypography = function (cfg) {
        if (!cfg) return;
        if (cfg.fontFamily) document.body.style.fontFamily = cfg.fontFamily;
        if (cfg.fontSize) document.body.style.fontSize = cfg.fontSize + "px";
        if (cfg.fontWeight) document.body.style.fontWeight = String(cfg.fontWeight);
        if (cfg.lineHeight) document.body.style.lineHeight = String(cfg.lineHeight);
        if (cfg.bg) document.documentElement.style.setProperty("--bg-color", cfg.bg);
        if (cfg.text) document.documentElement.style.setProperty("--text-color", cfg.text);
        if (cfg.muted) document.documentElement.style.setProperty("--muted-color", cfg.muted);
        if (cfg.border) document.documentElement.style.setProperty("--border-color", cfg.border);
        if (cfg.card) document.documentElement.style.setProperty("--card-color", cfg.card);
        if (cfg.accent) document.documentElement.style.setProperty("--accent-color", cfg.accent);
      };

      window.scrollToNovelStart = function () {
        if (window.NovelReaderRuntime) window.NovelReaderRuntime.markProgrammatic(400);
        window.scrollTo(0, 0);
      };

      // 竖排的滚动轴是横向（vertical-rl 下 scrollX 为 0 或负值），横排仍是纵向
      function scrollAxisMetrics() {
        var root = document.scrollingElement || document.documentElement;
        var viewport = isVertical
          ? (window.innerWidth || (root && root.clientWidth) || 0)
          : (window.innerHeight || (root && root.clientHeight) || 0);
        var content = root ? (isVertical ? root.scrollWidth : root.scrollHeight) : 0;
        var max = Math.max(1, content - viewport);
        var position = 0;
        if (isVertical) {
          // 单一滚动容器应为 html/视口；同时兜底 body，兼容 Chromium 的 RTL 负值约定
          var candidates = [
            typeof window.scrollX === "number" ? window.scrollX : 0,
            root ? root.scrollLeft : 0,
            document.body ? document.body.scrollLeft : 0
          ];
          for (var i = 0; i < candidates.length; i++) {
            var value = typeof candidates[i] === "number" ? candidates[i] : 0;
            if (Math.abs(value) > Math.abs(position)) position = value;
          }
          position = Math.abs(position);
        } else {
          position = Math.max(
            0,
            (typeof window.scrollY === "number" ? window.scrollY : 0) ||
              (root ? root.scrollTop : 0) ||
              (document.body ? document.body.scrollTop : 0) ||
              0
          );
        }
        return { position: position, max: max, ratio: Math.max(0, Math.min(1, position / max)) };
      }

      // 与 NovelReaderRuntime.computeAnchor 同构，但按排版方向选取阅读边（竖排取 rect.right）
      function computeAxisAnchor(entryEl, readingEdge) {
        if (!entryEl) return null;
        var runtime = window.NovelReaderRuntime;
        var chunkId = entryEl.getAttribute
          ? entryEl.getAttribute("data-chunk-id") || entryEl.id
          : entryEl.id;
        if (!chunkId) return null;
        var parts = runtime && runtime.subElements ? runtime.subElements(entryEl) : [entryEl];
        var textOf = runtime && runtime.textOf
          ? runtime.textOf
          : function (el) { return el.innerText || el.textContent || ""; };
        var offset = 0;
        var best = 0;
        var bestDistance = Infinity;
        for (var i = 0; i < parts.length; i++) {
          var rect = parts[i].getBoundingClientRect ? parts[i].getBoundingClientRect() : { top: 0, right: 0 };
          var edge = isVertical
            ? (rect && typeof rect.right === "number" ? rect.right : 0)
            : (rect && typeof rect.top === "number" ? rect.top : 0);
          var distance = Math.abs(edge - readingEdge);
          if (distance < bestDistance) { bestDistance = distance; best = offset; }
          offset += textOf(parts[i]).length + 1;
        }
        var text = textOf(entryEl);
        var start = Math.min(Math.max(0, best), Math.max(0, text.length - 1));
        var quote = "";
        if (text.length > 0) {
          while (start < text.length && /\\s/.test(text.charAt(start))) start++;
          quote = text.substr(start, 40).replace(/\\s+/g, " ").trim();
        }
        return { chunkId: chunkId, offset: best, quote: quote };
      }

      function reportProgress() {
        var chunks = window.NovelReaderRuntime ? window.NovelReaderRuntime.chunkElements() : [];
        if (!chunks.length) return;
        var readingEdge = isVertical ? window.innerWidth * 0.85 : 80;
        var chosen = chunks[0];
        var bestDist = Infinity;
        for (var i = 0; i < chunks.length; i++) {
          var rect = chunks[i].getBoundingClientRect();
          var edge = isVertical ? rect.right : rect.top;
          var dist = Math.abs(edge - readingEdge);
          if (dist < bestDist) {
            bestDist = dist;
            chosen = chunks[i];
          }
        }
        var chunkId = chosen.getAttribute("data-chunk-id") || chosen.id;
        var chunkIndex = parseInt(chosen.getAttribute("data-chunk-index") || "0", 10) || 0;
        var page = parseInt(chosen.getAttribute("data-page") || "1", 10) || 1;
        var computed = computeAxisAnchor(chosen, readingEdge);
        var metrics = scrollAxisMetrics();
        postNovelMessage("onProgressChange", {
          novelId: novelId,
          page: page,
          chunkId: chunkId,
          chunkIndex: chunkIndex,
          offset: computed ? computed.offset : 0,
          quote: computed ? computed.quote : "",
          ratio: metrics.ratio
        });
      }

      var scrollTimer = null;
      window.addEventListener("scroll", function () {
        if (window.NovelReaderRuntime) window.NovelReaderRuntime.noteScroll();
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(reportProgress, 180);
      }, { passive: true });

      // Single tap on body toggles reader HUD controls (ignoring links, buttons, images, text selection)
      var touchStartX = 0;
      var touchStartY = 0;
      var touchMoved = false;
      document.addEventListener("touchstart", function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoved = false;
      }, { passive: true });
      document.addEventListener("touchmove", function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        if (Math.abs(e.touches[0].clientX - touchStartX) > 10 || Math.abs(e.touches[0].clientY - touchStartY) > 10) {
          touchMoved = true;
        }
      }, { passive: true });
      document.addEventListener("click", function (e) {
        if (touchMoved) return;
        var sel = window.getSelection && window.getSelection();
        if (sel && String(sel).trim().length > 0) return;
        var target = e.target;
        while (target && target !== document.body) {
          var tag = (target.tagName || "").toUpperCase();
          if (tag === "A" || tag === "BUTTON" || tag === "IMG" || (target.classList && target.classList.contains("pixiv-illust-block"))) {
            return;
          }
          target = target.parentNode;
        }
        postNovelMessage("toggleControls", {});
      });

      function restoreInitialPosition() {
        var payload = initialAnchor || (targetChunkId || (targetPage && targetPage > 1) ? { chunkId: targetChunkId, page: targetPage } : null);
        if (payload && window.NovelReaderRuntime) {
          window.NovelReaderRuntime.jumpToAnchor(payload);
        }
        postNovelMessage("readerReady", {});
      }

      if (document.readyState === "complete") {
        restoreInitialPosition();
      } else {
        window.addEventListener("load", restoreInitialPosition);
      }
    })();
  </script>
</body>
</html>`
}

/**
 * Patch translations live into the mounted WebView without reloading HTML,
 * preserving chunk IDs, images, navigation nodes, and scroll anchor.
 */
export function buildNovelTranslationPatchScript(
  snapshot: NovelTranslationSnapshot | null | undefined,
  anchorId?: string | null,
): string {
  const translated: Record<string, string> = {}
  const translatedChaptersHtml: Record<string, string> = {}
  const translatedTitle = snapshot?.mode === "translated" ? snapshot.translatedTitle ?? "" : ""
  if (snapshot?.mode === "translated") {
    for (const block of Object.values(snapshot.blocks)) {
      if (block.status !== "done" || !block.translation) continue
      if (block.kind === "chapter") {
        translatedChaptersHtml[block.id] = formatNovelInlineHtml(block.translation)
        continue
      }
      translated[block.id] = renderTextLinesHtml(block.translation)
    }
  }
  return `(() => {
    const rendered = ${JSON.stringify(translated)};
    const renderedChaptersHtml = ${JSON.stringify(translatedChaptersHtml)};
    const renderedTitle = ${JSON.stringify(translatedTitle)};
    const originals = window.__novelTranslationOriginals || (window.__novelTranslationOriginals = {});
    const titleNode = document.querySelector('.novel-header-title, .vertical-header-title');
    if (titleNode) {
      if (window.__novelTranslationOriginalTitle === undefined) window.__novelTranslationOriginalTitle = titleNode.textContent;
      const nextTitle = renderedTitle || window.__novelTranslationOriginalTitle;
      if (titleNode.textContent !== nextTitle) titleNode.textContent = nextTitle;
    }
    const anchor = document.getElementById(${JSON.stringify(anchorId ?? null)});
    const before = anchor && anchor.getBoundingClientRect();
    let changed = false;
    document.querySelectorAll('.text-chunk-block').forEach((node) => {
      const id = node.getAttribute('data-chunk-id');
      if (!id) return;
      if (!(id in originals)) originals[id] = node.innerHTML;
      const next = rendered[id] || originals[id];
      if (node.innerHTML !== next) { node.innerHTML = next; changed = true; }
    });
    document.querySelectorAll('.chapter-block').forEach((node) => {
      const id = node.getAttribute('data-chunk-id');
      const title = node.querySelector('.chapter-title');
      if (!id || !title) return;
      const key = 'chapter:' + id;
      if (!(key in originals)) originals[key] = title.innerHTML;
      const next = renderedChaptersHtml[id] || originals[key];
      if (title.innerHTML !== next) { title.innerHTML = next; changed = true; }
    });
    if (anchor && before && changed) {
      requestAnimationFrame(() => {
        const after = anchor.getBoundingClientRect();
        window.scrollBy(after.left - before.left, after.top - before.top);
      });
    }
  })();`
}

export function buildNovelTypographyPatchScript(
  settings: NovelReaderSettings,
  readerTheme: NovelReaderThemeId,
  systemIsDark: boolean,
): string {
  const palette = resolveReaderThemePalette(readerTheme, systemIsDark)
  const payload = {
    fontFamily: resolveAndroidNovelFontCss(settings.fontId, settings.customFontPostscriptName),
    fontSize: Math.max(13, Math.min(34, settings.fontSize || 17)),
    fontWeight: resolveFontWeightCss(settings.fontWeight),
    lineHeight: resolveLineHeightCss(settings.lineSpacingLevel),
    ...palette,
  }
  return `if (typeof window.applyTypography === "function") { window.applyTypography(${JSON.stringify(payload)}); }`
}

export function buildNovelImagePatchScript(
  chunkId: string,
  dataUrl: string,
  anchorId?: string | null,
): string {
  return `(() => {
    const fig = document.getElementById(${JSON.stringify(chunkId)});
    if (!fig) return;
    const existing = fig.querySelector('img.novel-img');
    if (existing) {
      if (existing.src !== ${JSON.stringify(dataUrl)}) existing.src = ${JSON.stringify(dataUrl)};
      return;
    }
    const ph = fig.querySelector('.novel-img-placeholder');
    const img = document.createElement('img');
    img.className = 'novel-img';
    img.alt = '插图';
    img.onload = function () {
      if (window.NovelReaderRuntime) {
        window.NovelReaderRuntime.realignAfterContentChange(function () {
          var el = document.getElementById(${JSON.stringify(anchorId ?? null)});
          if (el) window.NovelReaderRuntime.scrollElementIntoView(el);
        });
      }
    };
    img.src = ${JSON.stringify(dataUrl)};
    if (ph) fig.replaceChild(img, ph);
    else fig.insertBefore(img, fig.firstChild);
  })();`
}

export function buildNovelJumpScript(payload: {
  chunkId?: string | null
  page?: number
  offset?: number
  quote?: string
}): string {
  return `if (window.NovelReaderRuntime) { window.NovelReaderRuntime.jumpToAnchor(${JSON.stringify(payload)}); }`
}
