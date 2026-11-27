import { getDownloadImageQuality } from "../../../../../../Pix-Scripting/src/store/settings"
import { imageUrlOf } from "../../../../../../Pix-Scripting/src/image/imageLoader"
import type { PixivIllustration } from "../../../../../../Pix-Scripting/src/types"
import {
  ScriptingPasteboard,
  ScriptingSafari,
  ScriptingShareSheet,
} from "../../../scripting/hostGlobals"
import type { AppNavAPI } from "../../navigation/types"

export interface CaptionSegment {
  type: "text" | "link"
  text: string
  href?: string
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
}

export function parseCaptionSegments(rawHtml?: string | null): CaptionSegment[] {
  if (!rawHtml) return []
  const normalized = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?(?:p|div)[^>]*>/gi, "\n")

  const segments: CaptionSegment[] = []
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*?>([\s\S]*?)<\/a>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushPlainText = (raw: string) => {
    const cleaned = decodeHtmlEntities(raw.replace(/<[^>]+>/g, ""))
    if (!cleaned) return
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g
    let urlLast = 0
    let urlMatch: RegExpExecArray | null
    while ((urlMatch = urlRegex.exec(cleaned)) !== null) {
      if (urlMatch.index > urlLast) {
        segments.push({ type: "text", text: cleaned.slice(urlLast, urlMatch.index) })
      }
      const url = urlMatch[1]
      segments.push({ type: "link", text: url, href: url })
      urlLast = urlMatch.index + url.length
    }
    if (urlLast < cleaned.length) {
      segments.push({ type: "text", text: cleaned.slice(urlLast) })
    }
  }

  while ((match = linkRegex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      pushPlainText(normalized.slice(lastIndex, match.index))
    }
    const href = decodeHtmlEntities(match[2] || "").trim()
    const label = decodeHtmlEntities((match[3] || "").replace(/<[^>]+>/g, "")).trim() || href
    if (href) {
      segments.push({ type: "link", text: label, href })
    } else if (label) {
      segments.push({ type: "text", text: label })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < normalized.length) {
    pushPlainText(normalized.slice(lastIndex))
  }

  // Collapse excessive leading/trailing newlines
  if (segments.length > 0 && segments[0].type === "text") {
    segments[0] = { ...segments[0], text: segments[0].text.replace(/^\n+/, "") }
  }
  if (segments.length > 0 && segments[segments.length - 1].type === "text") {
    const last = segments[segments.length - 1]
    segments[segments.length - 1] = { ...last, text: last.text.replace(/\n+$/, "") }
  }

  return segments.filter((s) => s.text.length > 0)
}

export function stripHtmlToText(rawHtml?: string | null): string {
  return parseCaptionSegments(rawHtml)
    .map((s) => s.text)
    .join("")
    .trim()
}

export function formatShortDate(iso?: string | null): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return iso.slice(0, 10)
  }
}

export function formatMetricCount(n?: number | null): string {
  const val = Number(n ?? 0)
  if (!Number.isFinite(val) || val < 0) return "0"
  if (val >= 10000) return `${(val / 10000).toFixed(1)}w`
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`
  return String(val)
}

export function getIllustPageCount(illust: PixivIllustration | null | undefined): number {
  if (!illust) return 0
  return Math.max(1, illust.page_count || 1, illust.meta_pages?.length || 1)
}

export function getIllustDownloadUrls(
  illust: PixivIllustration,
  qualityOverride?: "large" | "original",
): string[] {
  const quality = qualityOverride ?? getDownloadImageQuality()
  const count = getIllustPageCount(illust)
  const urls: string[] = []
  for (let i = 0; i < count; i++) {
    const url = imageUrlOf(illust, i, quality)
    if (url) urls.push(url)
  }
  return urls
}

export async function copyToClipboard(text: string): Promise<void> {
  await ScriptingPasteboard.setString(text)
}

export async function shareItems(items: string[]): Promise<boolean> {
  return ScriptingShareSheet.present(items)
}

export async function openExternalUrl(url: string): Promise<boolean> {
  return ScriptingSafari.openURL(url)
}

export function handlePixivHref(href: string, nav: AppNavAPI): void {
  const raw = (href || "").trim()
  if (!raw) return

  // pixiv:// deep links
  const pixivIllust = raw.match(/^pixiv:\/\/illusts\/(\d+)/i)
  if (pixivIllust) {
    nav.push({ name: "illust", id: Number(pixivIllust[1]) })
    return
  }
  const pixivUser = raw.match(/^pixiv:\/\/users\/(\d+)/i)
  if (pixivUser) {
    nav.push({ name: "user", id: Number(pixivUser[1]) })
    return
  }
  const pixivNovel = raw.match(/^pixiv:\/\/novels\/(\d+)/i)
  if (pixivNovel) {
    nav.push({ name: "novel", id: Number(pixivNovel[1]) })
    return
  }

  // Standard web pixiv URLs
  const webIllust = raw.match(/pixiv\.net\/(?:[a-z]{2}\/)?artworks\/(\d+)/i) ||
    raw.match(/pixiv\.net\/member_illust\.php\?[^#]*illust_id=(\d+)/i)
  if (webIllust) {
    nav.push({ name: "illust", id: Number(webIllust[1]) })
    return
  }

  const webUser = raw.match(/pixiv\.net\/(?:[a-z]{2}\/)?users\/(\d+)/i) ||
    raw.match(/pixiv\.net\/member\.php\?[^#]*id=(\d+)/i)
  if (webUser) {
    nav.push({ name: "user", id: Number(webUser[1]) })
    return
  }

  const webNovelSeries = raw.match(/pixiv\.net\/novel\/series\/(\d+)/i)
  if (webNovelSeries) {
    nav.push({ name: "series", kind: "novel", id: Number(webNovelSeries[1]) })
    return
  }

  const webMangaSeries = raw.match(/pixiv\.net\/user\/\d+\/series\/(\d+)/i)
  if (webMangaSeries) {
    nav.push({ name: "series", kind: "manga", id: Number(webMangaSeries[1]) })
    return
  }

  const webNovel = raw.match(/pixiv\.net\/novel\/show\.php\?[^#]*id=(\d+)/i)
  if (webNovel) {
    nav.push({ name: "novel", id: Number(webNovel[1]) })
    return
  }

  const webPixivision = raw.match(/pixivision\.net\/(?:[a-z]{2}\/)?a\/(\d+)/i)
  if (webPixivision) {
    nav.push({ name: "pixivision", id: Number(webPixivision[1]) })
    return
  }

  const webTag = raw.match(/pixiv\.net\/(?:[a-z]{2}\/)?tags\/([^/?#]+)/i)
  if (webTag) {
    try {
      const decoded = decodeURIComponent(webTag[1])
      nav.push({ name: "tagFeed", tag: decoded, kind: "illust" })
      return
    } catch {}
  }

  // Handle Twitter/X shorthand or relative jump URLs from Pixiv captions
  let targetUrl = raw
  if (raw.startsWith("jump.php?")) {
    const idx = raw.indexOf("?")
    const inner = decodeURIComponent(raw.slice(idx + 1))
    if (inner.startsWith("http")) targetUrl = inner
  } else if (raw.startsWith("/jump.php?")) {
    const inner = decodeURIComponent(raw.slice("/jump.php?".length))
    if (inner.startsWith("http")) targetUrl = inner
  }

  void openExternalUrl(targetUrl)
}

export function toFileUri(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith("file://") || path.startsWith("content://") || path.startsWith("data:")) {
    return path
  }
  return `file://${path}`
}
