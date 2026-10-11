import {
  Button,
  Device,
  Divider,
  HStack,
  Image,
  LazyVStack,
  Menu,
  NavigationLink,
  ScrollView,
  Text,
  useEffect,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"
import { appGlass } from "./components/glass"
import {
  PAGE_TOOLBAR_BACKGROUND,
  PAGE_TOOLBAR_BACKGROUND_VISIBILITY,
} from "./components/pageChrome"
import {
  downloadEntireMangaSeries,
  downloadEntireNovelSeries,
} from "../downloader"
import {
  cachedFileExists,
  cardThumbUrlOf,
  loadImage,
  novelThumbUrlOf,
  prefetch,
  upgradeHighQualityCoverUrl,
} from "../image/imageLoader"
import {
  addWatchlistSeries,
  deleteWatchlistSeries,
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
  novelViewerData,
} from "../api/pixiv"
import { session } from "../api/session"
import { triggerHaptic } from "../platform/haptics"
import {
  loadSettings,
  onSettingsChanged,
  updateSettings,
} from "../store/settings"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../store/contentFilter"
import { cacheIllusts } from "../store/illustCache"
import { cacheNovels } from "../store/novelCache"
import { cacheSeriesNav } from "../store/seriesCache"
import type {
  PixivIllustration,
  PixivIllustrationSeriesItem,
  PixivNovel,
  PixivUser,
} from "../types"
import {
  AvatarImage,
  EmptyView,
  ErrorView,
  estimateReadingTime,
  ExpandableIntroduction,
  formatWordCount,
  ImageNumberBadge,
  ImmersiveHeaderBanner,
  LoadingView,
  LoadMoreTrigger,
  IllustFlowFeed,
  NovelCard,
} from "./components"
import { renderDestination, requestPixivRoute } from "../store/routeNavigation"
import { useDualRoute } from "./DualRouteContext"
import {
  currentBatchSize,
  useLatest,
  usePagedList,
  useSeriesWatchlist,
} from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl } from "./ambient"
import { parseNovelToChunks } from "./NovelReader"
import { getNovelTranslationSession, type NovelTranslationSession } from "../store/novelTranslation"
import { resolveEffectiveUID } from "../store/dataDirectory"
import { onCustomAIConfigChanged } from "../store/customAI"
import { cleanHtmlCaption } from "../api/aiService"
import { loadNovelReaderSettings } from "../store/novelReaderSettings"

type SeriesKind = "manga" | "novel"
type SeriesWorkItem = PixivIllustration | PixivNovel

function seriesIllust(
  item: PixivIllustrationSeriesItem,
  seriesID?: number | null,
  seriesTitle?: string | null,
  authorFallback: PixivUser | null = null,
  episodeNumber?: number
): PixivIllustration {
  const raw = item as any
  const illustType = item.illust_type ?? raw.type ?? (raw.illustType === 1 ? "manga" : raw.illustType === 2 ? "ugoira" : "illust")
  return {
    id: Number(item.id),
    title: item.title ?? raw.workTitle ?? "",
    type: illustType === "ugoira" ? "ugoira" : illustType === "manga" ? "manga" : "illust",
    image_urls: item.image_urls ?? (raw.urls ? {
      square_medium: raw.urls["250x250"] ?? raw.url,
      medium: raw.urls["540x540"] ?? raw.urls["360x360"] ?? raw.url,
      large: raw.urls["1200x1200"] ?? raw.url,
    } : { medium: raw.url }),
    caption: item.caption ?? raw.description ?? "",
    user: item.user ?? raw.user ?? (raw.userId ? {
      id: Number(raw.userId),
      name: raw.userName ?? "",
      account: raw.userAccount ?? raw.userName ?? "",
      profile_image_urls: raw.profileImageUrl ? { medium: raw.profileImageUrl } : undefined,
    } : authorFallback ?? { id: 0, name: "", account: "" }),
    tags: Array.isArray(item.tags)
      ? item.tags.map((t: any) => typeof t === "string" ? { name: t } : { name: t.name ?? t.tag ?? "", translated_name: t.translated_name })
      : [],
    create_date: item.create_date ?? raw.createDate ?? "",
    page_count: item.page_count ?? raw.pageCount ?? 1,
    width: item.width ?? 0,
    height: item.height ?? 0,
    x_restrict: item.x_restrict ?? raw.x_restrict ?? raw.xRestrict ?? 0,
    series: seriesID ? { id: seriesID, title: seriesTitle ?? "漫画系列" } : undefined,
    episode_number: episodeNumber,
    meta_single_page: item.meta_single_page ?? {},
    meta_pages: item.meta_pages ?? (raw.meta_pages ? raw.meta_pages : []),
    total_view: item.total_view ?? raw.total_view ?? raw.totalView ?? 0,
    total_bookmarks: item.total_bookmarks ?? raw.total_bookmarks ?? raw.totalBookmarks ?? 0,
    is_bookmarked: item.is_bookmarked ?? raw.is_bookmarked ?? false,
    is_muted: item.is_muted ?? raw.is_muted ?? false,
    illust_ai_type: item.illust_ai_type ?? raw.illust_ai_type ?? raw.aiType ?? raw.ai_type ?? 0,
    total_comments: item.total_comments ?? raw.total_comments ?? raw.totalComments ?? 0,
    comment_access_control: item.comment_access_control ?? raw.comment_access_control ?? 0,
  }
}

function filterSeriesIllusts(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isIllustContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
      exemptBlockedUser: true,
    })
  )
}

function filterSeriesNovels(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) =>
    isNovelContentVisible(item, settings, undefined, {
      exemptRestrictions: settings.exemptFilterForPersonal,
      exemptBlockedUser: true,
    })
  )
}

function candidateUrlOf(item: any): string | null {
  if (!item) return null
  if (typeof item === "string") return item
  if (typeof item !== "object") return null

  const coverUrls = item.cover?.urls ?? item.cover_image_urls ?? item.cover
  if (coverUrls && typeof coverUrls === "object") {
    const url =
      coverUrls.original ??
      coverUrls["1200x1200"] ??
      coverUrls["480mw"] ??
      coverUrls.large ??
      coverUrls["240mw"] ??
      coverUrls.medium ??
      coverUrls.square_medium ??
      coverUrls["128x128"]
    if (url && typeof url === "string") return url
  }

  if (item.meta_single_page?.original_image_url) {
    return item.meta_single_page.original_image_url
  }

  if (Array.isArray(item.meta_pages) && item.meta_pages.length > 0) {
    const firstPage = item.meta_pages[0]?.image_urls
    if (firstPage) {
      const url =
        firstPage.original ??
        firstPage.large ??
        firstPage.medium ??
        firstPage.square_medium
      if (url) return url
    }
  }

  if (item.image_urls && typeof item.image_urls === "object") {
    const url =
      item.image_urls.original ??
      item.image_urls.large ??
      item.image_urls.medium ??
      item.image_urls.square_medium
    if (url && typeof url === "string") return url
  }

  if (typeof item.url === "string" && item.url) {
    return item.url
  }

  return null
}

function extractRawCoverCandidate(
  detail?: any,
  firstItem?: any,
  fallbackItem?: any
): string | null {
  return (
    candidateUrlOf(detail) ??
    candidateUrlOf(firstItem) ??
    candidateUrlOf(fallbackItem)
  )
}

export function SeriesView(props: { kind: SeriesKind; seriesID: number }) {
  const { kind, seriesID } = props
  const defaultTitle = kind === "manga" ? "漫画系列" : "小说系列"

  const [title, setTitle] = useState(defaultTitle)
  const [caption, setCaption] = useState("")
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [author, setAuthor] = useState<PixivUser | null>(null)
  const authorRef = useRef<PixivUser | null>(null)
  authorRef.current = author
  const [workCount, setWorkCount] = useState<number | null>(null)
  const [totalCharacterCount, setTotalCharacterCount] = useState<number | null>(null)
  const [isConcluded, setIsConcluded] = useState<boolean | null>(null)
  const [isWatched, setIsWatched] = useSeriesWatchlist(seriesID, kind, false)
  const [watchLoading, setWatchLoading] = useState(false)
  const [isAscending, setIsAscending] = useState(
    () => loadSettings().watchlistSortOrder === "asc"
  )
  const isAscendingRef = useRef(isAscending)
  isAscendingRef.current = isAscending
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const [feedBottomInset, setFeedBottomInset] = useState(() => loadSettings().feedBottomInset)
  const isAppleMusic = pageLayout === "appleMusic"
  const { isSplitViewActive, isDetailPane } = useDualRoute()
  const isSplitMasterPane = isSplitViewActive && !isDetailPane

  const { ambientBackground } = useExperimentalAmbientPalette(
    coverPreviewUrl || coverUrl
  )

  // 全量已获取未过滤的原始数据映射池（按自然正序 1..N 存储）
  const rawMappedItemsRef = useRef<SeriesWorkItem[]>([])

  // 统一的系列分页流状态机
  const paged = usePagedList<SeriesWorkItem>({
    first: async (token) => {
      // 若已有缓存原始数据且只是切换了排序，直接快速复用
      if (rawMappedItemsRef.current.length > 0) {
        const sorted = isAscendingRef.current
          ? rawMappedItemsRef.current
          : [...rawMappedItemsRef.current].reverse()
        return { items: sorted, nextURL: null }
      }

      let detail: any
      let seriesAuthor: PixivUser | null = null
      let rawCover: string | null = null
      let mappedItems: SeriesWorkItem[] = []
      let totalCount = 0

      if (kind === "manga") {
        const result = await illustrationSeries(seriesID, token)
        detail = result.illust_series_detail
        seriesAuthor =
          detail.user ??
          result.illust_series_first_illust?.user ??
          result.illusts?.[0]?.user ??
          null

        rawCover = extractRawCoverCandidate(
          detail,
          result.illust_series_first_illust,
          result.illusts?.[0]
        )

        const allRawIllusts: PixivIllustrationSeriesItem[] = Array.isArray(result.illusts) ? [...result.illusts] : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawIllusts.length < 500) {
          try {
            const nextResult = await nextIllustrationSeries(currentNextURL, token)
            if (Array.isArray(nextResult.illusts) && nextResult.illusts.length > 0) {
              allRawIllusts.push(...nextResult.illusts)
              currentNextURL = nextResult.next_url ?? null
            } else {
              break
            }
          } catch {
            break
          }
        }

        const rawAscending = [...allRawIllusts].reverse()
        const sTitle = detail.title || defaultTitle
        const illusts = rawAscending.map((it, idx) =>
          seriesIllust(it, seriesID, sTitle, seriesAuthor, idx + 1)
        )
        cacheIllusts(illusts)
        cacheSeriesNav(
          seriesID,
          "manga",
          sTitle,
          illusts.map((it) => ({
            id: it.id,
            title: it.title,
            episodeNumber: it.episode_number,
          }))
        )
        mappedItems = illusts
        totalCount = detail.series_work_count ?? allRawIllusts.length
      } else {
        const result = await novelSeries(seriesID, token)
        detail = result.novel_series_detail
        seriesAuthor =
          detail.user ??
          result.novel_series_first_novel?.user ??
          result.novels?.[0]?.user ??
          null

        rawCover = extractRawCoverCandidate(
          detail,
          result.novel_series_first_novel,
          result.novels?.[0]
        )

        const allRawNovels: PixivNovel[] = Array.isArray(result.novels) ? [...result.novels] : []
        let currentNextURL = result.next_url ?? null

        while (currentNextURL && allRawNovels.length < 500) {
          try {
            const nextResult = await nextNovelSeries(currentNextURL, token)
            if (Array.isArray(nextResult.novels) && nextResult.novels.length > 0) {
              allRawNovels.push(...nextResult.novels)
              currentNextURL = nextResult.next_url ?? null
            } else {
              break
            }
          } catch {
            break
          }
        }

        const sTitle = detail.title || defaultTitle
        const novels: PixivNovel[] = allRawNovels.map((novel, idx) => ({
          ...novel,
          series: { id: seriesID, title: sTitle },
          episode_number: idx + 1,
        }))
        cacheNovels(novels)
        cacheSeriesNav(
          seriesID,
          "novel",
          sTitle,
          novels.map((it) => ({
            id: it.id,
            title: it.title,
            episodeNumber: it.episode_number,
          }))
        )
        mappedItems = novels
        totalCount = detail.content_count ?? allRawNovels.length

        const totalChars =
          (detail as any).total_character_count ??
          allRawNovels.reduce((sum, n) => sum + (n.text_length ?? 0), 0)
        if (totalChars > 0) {
          setTotalCharacterCount(totalChars)
        }
        if (detail.is_concluded != null) {
          setIsConcluded(Boolean(detail.is_concluded))
        }
      }

      // 提取通用系列元信息
      const resolvedTitle = detail.title || defaultTitle
      setTitle(resolvedTitle)
      setCaption(detail.caption || "")
      const watched = Boolean(detail.watchlist_added ?? (detail as any).is_watched)
      setIsWatched(watched)

      setAuthor(seriesAuthor)
      authorRef.current = seriesAuthor

      const cover = upgradeHighQualityCoverUrl(rawCover)
      setCoverPreviewUrl(rawCover)
      setCoverUrl(cover)

      // 预热封面背景图，防止首次渲染时高度跳动
      const targetPreheatUrl = rawCover || cover
      const preheatDuration = loadSettings().backgroundPreheatDuration ?? 1000
      if (targetPreheatUrl && !cachedFileExists(targetPreheatUrl) && preheatDuration > 0) {
        await Promise.race([
          loadImage(targetPreheatUrl, 0),
          new Promise((resolve) => setTimeout(() => resolve(null), preheatDuration)),
        ])
      }

      rawMappedItemsRef.current = mappedItems
      setWorkCount(totalCount)

      const sorted = isAscendingRef.current ? mappedItems : [...mappedItems].reverse()
      return { items: sorted, nextURL: null }
    },
    filter: (items) =>
      kind === "manga"
        ? filterSeriesIllusts(items as PixivIllustration[])
        : filterSeriesNovels(items as PixivNovel[]),
    deps: [seriesID, isAscending, kind],
    onBatchPublished: (_, pendingItems) => {
      const batch = pendingItems.slice(0, currentBatchSize())
      const urls = kind === "manga"
        ? batch.map((it) => cardThumbUrlOf(it as PixivIllustration))
        : batch.map((it) => novelThumbUrlOf(it as PixivNovel))
      return prefetch(urls).cancel
    },
  })

  const pagedRef = useLatest(paged)
  const [seriesDownloading, setSeriesDownloading] = useState(false)
  const [seriesTranslating, setSeriesTranslating] = useState(false)
  const [translationStatus, setTranslationStatus] = useState("")
  const stopTranslationRef = useRef(false)
  const activeTranslationRef = useRef<NovelTranslationSession | null>(null)

  useEffect(() => () => {
    stopTranslationRef.current = true
    activeTranslationRef.current?.pause()
  }, [])
  useEffect(() => onCustomAIConfigChanged(() => {
    stopTranslationRef.current = true
    activeTranslationRef.current?.pause()
  }), [])

  async function handleTranslateSeries() {
    if (kind !== "novel" || seriesTranslating) return
    const novels = [...(paged.items as PixivNovel[])].sort((a, b) =>
      (a.episode_number ?? 0) - (b.episode_number ?? 0)
    )
    if (!novels.length) return
    const confirmed = await Dialog.confirm({
      title: "翻译小说系列",
      message: `将按章节顺序翻译《${title}》中当前可见的 ${novels.length} 话；已完成段落会跳过。本批最多处理约 6 万字，模型可能产生费用。`,
      confirmLabel: "开始翻译",
      cancelLabel: "取消",
    })
    if (!confirmed) return
    stopTranslationRef.current = false
    const startingUID = resolveEffectiveUID()
    setSeriesTranslating(true)
    let remainingChars = 60000
    let finished = 0
    let errors = 0
    try {
      for (const novel of novels) {
        if (stopTranslationRef.current || remainingChars <= 0 || resolveEffectiveUID() !== startingUID) break
        setTranslationStatus(`正在准备第 ${novel.episode_number ?? finished + 1} 话：${novel.title}`)
        try {
          const viewer = await session.call((token) => novelViewerData(novel.id, token))
          if (!viewer.text || stopTranslationRef.current || resolveEffectiveUID() !== startingUID) continue
          const blocks = parseNovelToChunks(viewer.text)
            .filter((item) => (item.type === "text" && Boolean(item.text)) ||
              (item.type === "chapter" && Boolean(item.title)))
            .map((item) => ({ id: item.id, text: item.type === "chapter" ? item.title! : item.text!,
              kind: item.type === "chapter" ? "chapter" as const : "text" as const }))
          const translationSession = getNovelTranslationSession({
            novelId: novel.id, title: novel.title, caption: cleanHtmlCaption(novel.caption),
            text: viewer.text,
            targetLanguage: loadNovelReaderSettings().translationTargetLanguage,
            seriesId: seriesID, blocks,
          })
          activeTranslationRef.current = translationSession
          const pending = blocks.filter((block) => translationSession.getSnapshot().blocks[block.id]?.status !== "done")
          const selected: string[] = []
          for (const block of pending) {
            if (block.text.length > remainingChars) break
            selected.push(block.id)
            remainingChars -= block.text.length
          }
          const contextSnapshot = translationSession.getSnapshot()
          const contextNeedsRetry = contextSnapshot.summaryStatus !== "ready" ||
            contextSnapshot.glossaryStatus === "pending" || contextSnapshot.glossaryStatus === "error"
          if (selected.length > 0 || contextNeedsRetry) {
            translationSession.setMode("translated")
            await translationSession.start(selected)
          }
          errors += translationSession.getSnapshot().failed
          finished += 1
          activeTranslationRef.current = null
          setTranslationStatus(`已处理 ${finished}/${novels.length} 话，剩余批次额度约 ${Math.round(remainingChars / 1000)} 千字`)
          if (selected.length < pending.length) break
        } catch {
          errors += 1
          activeTranslationRef.current = null
        }
      }
      setTranslationStatus(stopTranslationRef.current || resolveEffectiveUID() !== startingUID
        ? `已暂停；本次处理 ${finished} 话，失败 ${errors} 项，可再次启动继续`
        : `本批处理 ${finished} 话，失败 ${errors} 项；再次启动将跳过已完成段落`)
    } finally {
      activeTranslationRef.current = null
      setSeriesTranslating(false)
    }
  }

  async function handleExportSeries() {
    if (seriesDownloading) return
    triggerHaptic("light")

    if (kind === "novel") {
      const confirmed = await Dialog.confirm({
        title: "下载整本小说",
        message: `确认下载《${title}》整本 EPUB 小说？`,
        confirmLabel: "开始下载",
        cancelLabel: "取消",
      })
      if (!confirmed) return

      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireNovelSeries(seriesID, title)
        if (filePath) {
          triggerHaptic("success")
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    } else {
      const choice = await Dialog.actionSheet({
        title: `下载整套漫画《${title}》`,
        actions: [
          { label: "CBZ 漫画包" },
          { label: "EPUB 电子书" },
        ],
      })
      if (choice !== 0 && choice !== 1) return

      const format: "cbz" | "epub" = choice === 0 ? "cbz" : "epub"
      setSeriesDownloading(true)
      try {
        const filePath = await downloadEntireMangaSeries(seriesID, title, format)
        if (filePath) {
          triggerHaptic("success")
          await ShareSheet.present([filePath])
        }
      } finally {
        setSeriesDownloading(false)
      }
    }
  }

  async function toggleWatchlist() {
    if (watchLoading) return
    triggerHaptic("medium")
    setWatchLoading(true)
    const nextState = !isWatched
    try {
      if (nextState) {
        await session.call((token) => addWatchlistSeries(seriesID, kind, token))
        setIsWatched(true)
      } else {
        await session.call((token) => deleteWatchlistSeries(seriesID, kind, token))
        setIsWatched(false)
      }
    } catch {
      // 保持当前状态
    } finally {
      setWatchLoading(false)
    }
  }

  useEffect(() => {
    return onSettingsChanged(() => {
      const nextSettings = loadSettings()
      setPageLayout(nextSettings.pageLayout)
      setFeedBottomInset(nextSettings.feedBottomInset)
      const targetAsc = nextSettings.watchlistSortOrder === "asc"
      setIsAscending(targetAsc)
      pagedRef.current.reapplyFilter()
    })
  }, [kind])

  const handleRefresh = async () => {
    rawMappedItemsRef.current = []
    await paged.refresh()
  }

  const shareUrl = kind === "novel"
    ? `https://www.pixiv.net/novel/series/${seriesID}`
    : (author?.id
        ? `https://www.pixiv.net/user/${author.id}/series/${seriesID}`
        : `https://www.pixiv.net/series/${seriesID}`)

  const shareButton = (
    <Button
      key="series-share"
      action={() => {
        triggerHaptic("selection")
        void ShareSheet.present([shareUrl])
      }}
    >
      <Image systemName="square.and.arrow.up" />
    </Button>
  )

  const authorAvatar = author ? (
    <NavigationLink
      key="series-author"
      value={`user:${author.id}`}
    >
      <AvatarImage
        url={author.profile_image_urls?.medium ?? null}
        size={28}
      />
    </NavigationLink>
  ) : null

  const trailingButtons = isSplitMasterPane
    ? [
        <Menu key="series-more-menu" label={<Image systemName="ellipsis.circle" />}>
          {!isAppleMusic ? (
            <>
              <Button
                title={isWatched ? "已追更" : "追更"}
                systemImage={isWatched ? "bookmark.fill" : "bookmark"}
                disabled={watchLoading}
                action={toggleWatchlist}
              />
              <Button
                title={isAscending ? "切换为倒序" : "切换为正序"}
                systemImage={isAscending ? "arrow.down" : "arrow.up"}
                action={() => {
                  triggerHaptic("selection")
                  const nextAsc = !isAscending
                  setIsAscending(nextAsc)
                  updateSettings({ watchlistSortOrder: nextAsc ? "asc" : "desc" })
                }}
              />
              <Divider />
            </>
          ) : null}
          <Button
            title="分享"
            systemImage="square.and.arrow.up"
            action={() => {
              triggerHaptic("selection")
              void ShareSheet.present([shareUrl])
            }}
          />
          {!isAppleMusic ? (
            <Button
              title={seriesDownloading ? "下载中…" : "下载"}
              systemImage={seriesDownloading ? "square.and.arrow.down.fill" : "square.and.arrow.down"}
              foregroundStyle={seriesDownloading ? "systemBlue" : undefined}
              disabled={seriesDownloading}
              action={handleExportSeries}
            />
          ) : null}
          {author ? (
            <Button
              title={author.name ? `作者：${author.name}` : "主页"}
              systemImage="person.crop.circle"
              action={() => {
                void requestPixivRoute(`user:${author.id}`)
              }}
            />
          ) : null}
        </Menu>,
      ]
    : isAppleMusic
      ? [shareButton, ...(authorAvatar ? [authorAvatar] : [])]
      : [
        <Button
          key="series-watch"
          disabled={watchLoading}
          action={toggleWatchlist}
        >
          <Image
            systemName={isWatched ? "bookmark.fill" : "bookmark"}
            foregroundStyle={isWatched ? "systemBlue" : undefined}
          />
        </Button>,
        <Button
          key="series-sort"
          action={() => {
            triggerHaptic("selection")
            const nextAsc = !isAscending
            setIsAscending(nextAsc)
            updateSettings({ watchlistSortOrder: nextAsc ? "asc" : "desc" })
          }}
        >
          <Image systemName={isAscending ? "arrow.up" : "arrow.down"} />
        </Button>,
        ...(Device.isiPad
          ? [
              <Menu key="series-more-menu" label={<Image systemName="ellipsis.circle" />}>
                {author ? (
                  <Button
                    title="主页"
                    systemImage="person.crop.circle"
                    action={() => {
                      void requestPixivRoute(`user:${author.id}`)
                    }}
                  />
                ) : null}
                <Button
                  title="分享"
                  systemImage="square.and.arrow.up"
                  action={() => {
                    triggerHaptic("selection")
                    void ShareSheet.present([shareUrl])
                  }}
                />
                <Button
                  title="下载"
                  systemImage={seriesDownloading ? "square.and.arrow.down.fill" : "square.and.arrow.down"}
                  foregroundStyle={seriesDownloading ? "systemBlue" : undefined}
                  disabled={seriesDownloading}
                  action={handleExportSeries}
                />
              </Menu>,
            ]
          : [
              shareButton,
              <Button
                key="series-download"
                disabled={seriesDownloading}
                action={handleExportSeries}
              >
                <Image
                  systemName={seriesDownloading ? "square.and.arrow.down.fill" : "square.and.arrow.down"}
                  foregroundStyle={seriesDownloading ? "systemBlue" : undefined}
                />
              </Button>,
              ...(authorAvatar ? [authorAvatar] : []),
            ]),
      ]

  return (
    <ZStack
      navigationTitle=""
      navigationBarTitleDisplayMode="inline"
      toolbarBackground={PAGE_TOOLBAR_BACKGROUND}
      toolbarBackgroundVisibility={PAGE_TOOLBAR_BACKGROUND_VISIBILITY}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* 1. 底层：第 0 毫秒物理全屏垫底 */}
      {ambientBackground}

      {/* 2. 顶层：透明滚动视图 */}
      <ScrollView
        scrollContentBackground="hidden"
        toolbarBackground={PAGE_TOOLBAR_BACKGROUND}
        toolbarBackgroundVisibility={PAGE_TOOLBAR_BACKGROUND_VISIBILITY}
        ignoresSafeArea={{ edges: "top" }}
        refreshable={handleRefresh}
        toolbar={{
          topBarTrailing: trailingButtons,
        }}
      >
        {paged.initialLoading ? (
          <VStack
            alignment="center"
            frame={{ maxWidth: "infinity", minHeight: 400 }}
            padding={{ top: 120 }}
          >
            <LoadingView />
          </VStack>
        ) : paged.error && paged.items.length === 0 ? (
          <VStack
            alignment="center"
            frame={{ maxWidth: "infinity", minHeight: 400 }}
            padding={{ top: 120 }}
          >
            <ErrorView message={paged.error} onRetry={handleRefresh} />
          </VStack>
        ) : (
          <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
            {/* 沉浸式顶部背景图与居中悬浮胶囊标题 */}
            <ImmersiveHeaderBanner url={coverUrl} previewUrl={coverPreviewUrl}>
              <HStack
                alignment="center"
                padding={{ horizontal: 20, vertical: 9 }}
                glassEffect={appGlass({ type: "capsule", style: "continuous" })}
                clipShape={{ type: "capsule", style: "continuous" }}
                shadow={{ color: "#00000028", radius: 10, y: 4 }}
                offset={{ x: 0, y: 19 }}
              >
                <Text
                  font="headline"
                  fontWeight="bold"
                  multilineTextAlignment="center"
                  lineLimit={2}
                >
                  {title}
                </Text>
              </HStack>
            </ImmersiveHeaderBanner>

            {/* 系列信息 */}
            <VStack
              alignment="center"
              spacing={6}
              padding={{ top: 28, horizontal: 8, bottom: 8 }}
              frame={{ maxWidth: "infinity" }}
            >
              <HStack
                spacing={6}
                alignment="center"
                frame={{ maxWidth: "infinity", alignment: "center" }}
              >
                {workCount != null ? (
                  <Text
                    font="caption"
                    foregroundStyle="secondaryLabel"
                  >
                    {`共 ${workCount} 话`}
                  </Text>
                ) : null}

                {kind === "novel" && totalCharacterCount != null && totalCharacterCount > 0 ? (
                  <>
                    <Text font="caption" foregroundStyle="tertiaryLabel">·</Text>
                    <HStack spacing={2} alignment="center">
                      <Image
                        systemName="character.cursor.ibeam"
                        font="caption2"
                        foregroundStyle="secondaryLabel"
                      />
                      <Text font="caption" foregroundStyle="secondaryLabel">
                        {formatWordCount(totalCharacterCount)}
                      </Text>
                    </HStack>
                    <Text font="caption" foregroundStyle="tertiaryLabel">·</Text>
                    <HStack spacing={2} alignment="center">
                      <Image
                        systemName="clock"
                        font="caption2"
                        foregroundStyle="secondaryLabel"
                      />
                      <Text font="caption" foregroundStyle="secondaryLabel">
                        {estimateReadingTime(totalCharacterCount)}
                      </Text>
                    </HStack>
                  </>
                ) : null}

                {kind === "novel" && isConcluded != null ? (
                  <>
                    <Text font="caption" foregroundStyle="tertiaryLabel">·</Text>
                    <Text
                      font="caption"
                      foregroundStyle="secondaryLabel"
                    >
                      {isConcluded ? "已完结" : "连载中"}
                    </Text>
                  </>
                ) : null}
              </HStack>

              {caption.trim() ? (
                <VStack
                  alignment="leading"
                  frame={{ maxWidth: "infinity" }}
                  padding={{ top: 6 }}
                >
                  <ExpandableIntroduction
                    caption={caption}
                    routeDestination={renderDestination}
                  />
                </VStack>
              ) : null}
              {kind === "novel" && paged.items.length > 0 ? (
                <VStack spacing={5} padding={{ top: 8 }}>
                  <Button
                    title={seriesTranslating ? "暂停系列翻译" : "翻译本系列"}
                    systemImage={seriesTranslating ? "pause.fill" : "character.book.closed"}
                    action={() => {
                      if (seriesTranslating) {
                        stopTranslationRef.current = true
                        activeTranslationRef.current?.pause()
                      } else {
                        void handleTranslateSeries()
                      }
                    }}
                  />
                  {translationStatus ? <Text font="caption" foregroundStyle="secondaryLabel">{translationStatus}</Text> : null}
                </VStack>
              ) : null}
            </VStack>

            {/* 章节列表分流 */}
            {kind === "novel" ? (
              <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8, top: 4 }}>
                {paged.items.length === 0 && !paged.initialLoading ? (
                  <EmptyView
                    text={
                      paged.hasFilteredContent
                        ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                        : "暂无可显示的小说章节"
                    }
                    systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
                  />
                ) : (
                  <>
                    {(paged.items as PixivNovel[]).map((novel, index) => (
                      <NovelCard
                        key={novel.id}
                        novel={novel}
                        priority={index}
                        showSeriesTitle={false}
                      />
                    ))}
                    {paged.items.length > 0 ? (
                      <LoadMoreTrigger
                        anchor={paged.items[paged.items.length - 1].id}
                        onLoadMore={paged.loadMore}
                        hasMore={paged.hasMore}
                        isLoading={paged.loadingMore}
                        loadMoreError={paged.loadMoreError}
                        onRetry={paged.retryLoadMore}
                      />
                    ) : null}
                  </>
                )}
              </LazyVStack>
            ) : (
              <VStack alignment="leading" spacing={8} padding={{ top: 4 }} frame={{ maxWidth: "infinity" }}>
                {paged.items.length === 0 && !paged.initialLoading ? (
                  <EmptyView
                    text={
                      paged.hasFilteredContent
                        ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                        : "暂无可显示的漫画章节"
                    }
                    systemImage={paged.hasFilteredContent ? "eye.slash" : "photo.on.rectangle"}
                  />
                ) : (
                  <IllustFlowFeed
                    items={paged.items as PixivIllustration[]}
                    onLoadMore={paged.loadMore}
                    hasMore={paged.hasMore}
                    isLoading={paged.loadingMore}
                    loadMoreError={paged.loadMoreError}
                    onRetryLoadMore={paged.retryLoadMore}
                    cornerBadgeOf={(illust, index) => (
                      <ImageNumberBadge
                        number={
                          illust.episode_number ??
                          (isAscending
                            ? index + 1
                            : (workCount ?? rawMappedItemsRef.current.length) - index)
                        }
                      />
                    )}
                  />
                )}
              </VStack>
            )}
          </VStack>
        )}
      </ScrollView>
    </ZStack>
  )
}
