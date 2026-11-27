import type { DownloadFileCategory } from "../../../../../Pix-Scripting/src/downloader/downloadFileManager"
import type { Route } from "./types"

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizePixivRouteString(rawRoute: string): string {
  if (!rawRoute || typeof rawRoute !== "string") return ""
  let decoded = rawRoute.trim()
  decoded = safeDecode(decoded)
  if (/%3A|%2F/i.test(decoded)) {
    decoded = safeDecode(decoded)
  }
  decoded = decoded.replace(/^["']|["']$/g, "").trim()
  if (!decoded) return ""

  if (decoded.startsWith("pix-scripting://")) {
    decoded = decoded.replace(/^pix-scripting:\/\//i, "").replace(/^route\//i, "")
  }

  if (/^\d+$/.test(decoded)) {
    return `illust:${decoded}`
  }
  const artworkMatch =
    decoded.match(/(?:artworks|i)\/(\d+)/i) || decoded.match(/illust_id=(\d+)/i)
  if (artworkMatch) {
    return `illust:${artworkMatch[1]}`
  }
  const mangaSeriesMatch =
    decoded.match(/(?:user|users)\/\d+\/series\/(\d+)/i) ||
    decoded.match(/manga\/series\/(\d+)/i) ||
    decoded.match(/(?:illust_series|user_series)\.php\?series_id=(\d+)/i)
  if (mangaSeriesMatch) {
    return `mangaSeries:${mangaSeriesMatch[1]}`
  }
  const novelSeriesMatch =
    decoded.match(/novel\/series\/(\d+)/i) ||
    decoded.match(/novel\/series\.php\?id=(\d+)/i)
  if (novelSeriesMatch) {
    return `novelSeries:${novelSeriesMatch[1]}`
  }
  const pixivisionMatch = decoded.match(/(?:pixivision\.net)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?a\/(\d+)/i)
  if (pixivisionMatch) {
    return `pixivision:${pixivisionMatch[1]}`
  }
  const pixivisionTagMatch = decoded.match(/(?:pixivision\.net)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?t\/([^/?#]+)/i)
  if (pixivisionTagMatch) {
    return `pixivision-tag:${pixivisionTagMatch[1]}`
  }
  const novelMatch =
    decoded.match(/novel\/(?:show|series)\.php\?id=(\d+)/i) ||
    decoded.match(/novel\/(?:show|show\.php\?id=)(\d+)/i) ||
    decoded.match(/novel_id=(\d+)/i)
  if (novelMatch) {
    return `novel:${novelMatch[1]}`
  }
  const userMatch =
    decoded.match(/(?:users|user|u)\/(\d+)/i) || decoded.match(/member\.php\?id=(\d+)/i)
  if (userMatch) {
    return `user:${userMatch[1]}`
  }
  return decoded
}

export function parseDeepLinkUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("pix-scripting://")) {
    const normalized = normalizePixivRouteString(trimmed)
    return normalized || null
  }
  if (/pixiv\.net|pixivision\.net/i.test(trimmed)) {
    const normalized = normalizePixivRouteString(trimmed)
    return normalized && normalized !== trimmed ? normalized : null
  }
  return null
}

function parsePositiveId(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) return null
  const id = Number(value.slice(prefix.length))
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null
}

export function parseRouteString(rawPage: string): Route {
  const page = normalizePixivRouteString(rawPage)
  if (!page) return { name: "notFound", rawRoute: rawPage }

  const illustId = parsePositiveId(page, "illust:")
  if (illustId != null) return { name: "illust", id: illustId }

  const pixivisionId = parsePositiveId(page, "pixivision:")
  if (pixivisionId != null) return { name: "pixivision", id: pixivisionId }

  const userId = parsePositiveId(page, "user:")
  if (userId != null) return { name: "user", id: userId }

  const novelId = parsePositiveId(page, "novel:")
  if (novelId != null) return { name: "novel", id: novelId }

  const mangaSeriesId = parsePositiveId(page, "mangaSeries:")
  if (mangaSeriesId != null) return { name: "series", kind: "manga", id: mangaSeriesId }

  const novelSeriesId = parsePositiveId(page, "novelSeries:")
  if (novelSeriesId != null) return { name: "series", kind: "novel", id: novelSeriesId }

  const relatedIllustId = parsePositiveId(page, "relatedIllust:")
  if (relatedIllustId != null) return { name: "relatedIllust", id: relatedIllustId }

  const relatedNovelId = parsePositiveId(page, "relatedNovel:")
  if (relatedNovelId != null) return { name: "relatedNovel", id: relatedNovelId }

  if (page.startsWith("tag:")) {
    return { name: "tagFeed", tag: safeDecode(page.slice("tag:".length)), kind: "illust" }
  }
  if (page.startsWith("novelTag:")) {
    return { name: "tagFeed", tag: safeDecode(page.slice("novelTag:".length)), kind: "novel" }
  }
  if (page.startsWith("pixivisionTag:")) {
    return { name: "tagFeed", tag: safeDecode(page.slice("pixivisionTag:".length)), kind: "pixivision" }
  }
  if (page.startsWith("pixivision-tag:")) {
    return { name: "tagFeed", tag: safeDecode(page.slice("pixivision-tag:".length)), kind: "pixivision" }
  }

  if (page === "pixivisionBookmarks" || page === "library:pixivision") {
    return { name: "library", initialKind: "pixivision" }
  }
  if (page === "novelBookmarks") return { name: "novelLibrary" }
  if (page === "library:novel") return { name: "library", initialKind: "novel" }
  if (page === "library:illustration" || page === "library:illust" || page === "library") {
    return { name: "library", initialKind: "illustration" }
  }
  if (page === "history") return { name: "history" }
  if (page === "historyAnalytics" || page.startsWith("historyAnalytics:")) {
    const scope = page.includes(":") ? page.split(":")[1] : undefined
    const validScope =
      scope === "all" || scope === "illustration" || scope === "manga" || scope === "novel"
        ? scope
        : undefined
    return { name: "historyAnalytics", initialScope: validScope }
  }
  if (page === "notifications") return { name: "notifications" }

  const notifMoreId = parsePositiveId(page, "notificationsMore:")
  if (notifMoreId != null) return { name: "notificationsMore", id: notifMoreId }

  const userBookmarksId = parsePositiveId(page, "userBookmarks:")
  if (userBookmarksId != null) return { name: "userBookmarks", userId: userBookmarksId }

  if (page.startsWith("userConnections:")) {
    const parts = page.split(":")
    const kind = parts[1]
    const id = parts.length === 3 ? Number(parts[2]) : NaN
    if (
      (kind === "following" || kind === "follower" || kind === "mypixiv") &&
      Number.isFinite(id) &&
      id > 0
    ) {
      return {
        name: "userConnections",
        kind,
        userId: Math.floor(id),
        title: kind === "mypixiv" ? "好友" : kind === "follower" ? "粉丝" : "关注",
      }
    }
  }
  if (page === "connections:following") return { name: "userConnections", kind: "following", title: "我的关注" }
  if (page === "connections:follower") return { name: "userConnections", kind: "follower", title: "我的粉丝" }
  if (page === "friends") return { name: "userConnections", kind: "mypixiv", title: "我的好友" }
  if (page === "myWorks") return { name: "userWorks", title: "我的作品" }

  const userWorksId = parsePositiveId(page, "userWorks:")
  if (userWorksId != null) return { name: "userWorks", userId: userWorksId, title: "作品" }

  if (page.startsWith("rankingCustomPicker:")) {
    const kind = page.slice("rankingCustomPicker:".length)
    if (kind === "illust" || kind === "manga" || kind === "novel") {
      return { name: "rankingCustomPicker", kind }
    }
  }

  if (page === "downloadManager") return { name: "downloadManager", initialSection: "overview" }
  if (page === "downloadTasks") return { name: "downloadManager", initialSection: "tasks" }
  if (page === "downloadCreators") return { name: "downloadManager", initialSection: "creators" }
  if (page.startsWith("downloadCreator:")) {
    return {
      name: "downloadManager",
      initialSection: "creators",
      creatorFolder: page.slice("downloadCreator:".length),
    }
  }
  if (page.startsWith("downloadDetail:")) {
    return {
      name: "downloadManager",
      initialSection: "category",
      category: page.slice("downloadDetail:".length) as DownloadFileCategory,
    }
  }

  if (page === "blockedSettings") return { name: "blocklist" }
  if (page === "customAISettings") return { name: "customAI" }
  if (page === "settings") return { name: "settings" }
  if (page === "about") return { name: "about" }

  return { name: "notFound", rawRoute: rawPage }
}

export function routeSignature(route: Route): string {
  switch (route.name) {
    case "illust":
      return `illust:${route.id}`
    case "illustGallery":
      return `illustGallery:${route.illust?.id ?? "custom"}:${route.initialPage ?? 0}`
    case "novel":
      return `novel:${route.id}`
    case "novelReader":
      return `novelReader:${route.novelId}`
    case "user":
      return `user:${route.id}`
    case "userWorks":
      return `userWorks:${route.userId ?? "me"}`
    case "userBookmarks":
      return `userBookmarks:${route.userId}`
    case "userConnections":
      return `userConnections:${route.kind}:${route.userId ?? "me"}`
    case "pixivision":
      return `pixivision:${route.id}`
    case "series":
      return `series:${route.kind}:${route.id}`
    case "tagFeed":
      return `tagFeed:${route.kind}:${route.tag}`
    case "relatedIllust":
      return `relatedIllust:${route.id}`
    case "relatedNovel":
      return `relatedNovel:${route.id}`
    case "library":
      return `library:${route.initialKind ?? "illustration"}`
    case "historyAnalytics":
      return `historyAnalytics:${route.initialScope ?? "all"}`
    case "notificationsMore":
      return `notificationsMore:${route.id}`
    case "downloadManager":
      return `downloadManager:${route.initialSection ?? "overview"}:${route.category ?? ""}:${route.creatorFolder ?? ""}`
    case "rankingCustomPicker":
      return `rankingCustomPicker:${route.kind}`
    case "notFound":
      return `notFound:${route.rawRoute}`
    default:
      return route.name
  }
}
