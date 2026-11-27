import type { DownloadFileCategory } from "../../../../../Pix-Scripting/src/downloader/downloadFileManager"
import type {
  PixivIllustration,
  PixivNovel,
  PixivUser,
  PixivisionArticle,
  TextEmbeddedImage,
} from "../../../../../Pix-Scripting/src/types"

export type TabId = "discovery" | "ranking" | "following" | "more" | "search"

export interface TabDef {
  id: TabId
  title: string
  glyph: string
  activeGlyph: string
}

export const TABS: readonly TabDef[] = [
  { id: "discovery", title: "探索", glyph: "✦", activeGlyph: "✦" },
  { id: "ranking", title: "排行", glyph: "♕", activeGlyph: "♛" },
  { id: "following", title: "关注", glyph: "♡", activeGlyph: "♥" },
  { id: "more", title: "我的", glyph: "◯", activeGlyph: "◉" },
  { id: "search", title: "搜索", glyph: "⌕", activeGlyph: "⌕" },
] as const

export interface CustomGalleryImage {
  url: string
  previewUrl?: string
  title?: string
}

export type Route =
  | { name: "illust"; id: number; seed?: PixivIllustration }
  | {
      name: "illustGallery"
      illust?: PixivIllustration
      initialPage?: number
      customImages?: CustomGalleryImage[]
    }
  | { name: "novel"; id: number; seed?: PixivNovel }
  | {
      name: "novelReader"
      novelId: number
      title: string
      caption?: string
      text: string
      coverUrl?: string | null
      textEmbeddedImages?: Record<string, TextEmbeddedImage>
      initialPage?: number
      initialChunkId?: string | null
      seriesId?: number | null
      seriesTitle?: string | null
      seriesPrev?: { id: number; title?: string } | null
      seriesNext?: { id: number; title?: string } | null
      episodeNumber?: number | null
    }
  | { name: "user"; id: number; seed?: PixivUser }
  | { name: "userWorks"; userId?: number; title?: string }
  | { name: "userBookmarks"; userId: number }
  | { name: "userConnections"; kind: "following" | "follower" | "mypixiv"; userId?: number; title?: string }
  | { name: "pixivision"; id: number; seed?: PixivisionArticle }
  | { name: "series"; kind: "manga" | "novel"; id: number }
  | { name: "tagFeed"; tag: string; kind: "illust" | "novel" | "pixivision" }
  | { name: "relatedIllust"; id: number }
  | { name: "relatedNovel"; id: number }
  | { name: "library"; initialKind?: "illustration" | "novel" | "pixivision" }
  | { name: "novelLibrary" }
  | { name: "history" }
  | { name: "historyAnalytics"; initialScope?: "all" | "illustration" | "manga" | "novel" }
  | { name: "notifications" }
  | { name: "notificationsMore"; id: number }
  | {
      name: "downloadManager"
      initialSection?: "overview" | "tasks" | "creators" | "category"
      category?: DownloadFileCategory
      creatorFolder?: string
    }
  | { name: "settings" }
  | { name: "customAI" }
  | { name: "blocklist" }
  | { name: "rankingCustomPicker"; kind: "illust" | "manga" | "novel" }
  | { name: "about" }
  | { name: "notFound"; rawRoute: string }

export interface StackEntry {
  key: string
  route: Route
}

export interface AppNavAPI {
  activeTab: TabId
  stacks: Record<TabId, StackEntry[]>
  visitedTabs: ReadonlySet<TabId>
  canGoBack: boolean
  selectTab: (tab: TabId) => void
  push: (route: Route, explicitTab?: TabId) => void
  replace: (route: Route, explicitTab?: TabId) => void
  pop: (count?: number, explicitTab?: TabId) => void
  popToRoot: (explicitTab?: TabId) => void
  pushRouteString: (rawRoute: string, explicitTab?: TabId) => void
}
