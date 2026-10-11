import {
  Button,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useEffect,
  useState,
  VStack,
  ZStack,
} from "scripting"
import {
  nextIllustrations,
  nextNovels,
  pixivisionByTag,
  searchIllustrations,
  searchNovels,
} from "../api/pixiv"
import { cardThumbUrlOf, novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { loadBlocklist } from "../store/blocklist"
import { isIllustContentVisible, isNovelContentVisible } from "../store/contentFilter"
import { session } from "../api/session"
import { triggerHaptic } from "../platform/haptics"
import { useLatest, usePagedList, currentBatchSize, dedupeByID } from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl } from "./ambient"
import type {
  PixivIllustration,
  PixivNovel,
  PixivisionArticle,
  AdvancedSearchParams,
  SearchSort,
} from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  IllustFlowFeed,
  LoadMoreTrigger,
  NovelCard,
  PixivisionCard,
  RefreshableScrollView,
} from "./components"
import {
  TagFeedDockBar,
  useRegisterBottomAccessory,
  onOpenTagAdvancedSearch,
} from "./bottomAccessory"

declare const Dialog: any

function SearchAdvancedSheet(props: any): any {
  const mod = require("./searchAdvancedSheet")
  const Comp = mod.SearchAdvancedSheet || mod.default
  return <Comp {...props} />
}

function formatPixivDate(timestamp: number): string {
  if (!timestamp) return ""
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function defaultTagIllustAdvancedParams(tag: string): AdvancedSearchParams {
  const now = Date.now()
  const today = formatPixivDate(now)
  const settings = loadSettings()
  return {
    word: tag,
    category: "all_illust",
    scope: "illust",
    target: "exact_match_for_tags",
    sort: "date_desc",
    mediaFilter: "all",
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: today,
    endDate: today,
    startTimestamp: now,
    endTimestamp: now,
    includeR18: settings.showR18,
    includeR18G: settings.showR18 && settings.showR18G,
    includeAI: settings.showAI,
  }
}

function defaultTagNovelAdvancedParams(tag: string): AdvancedSearchParams {
  const now = Date.now()
  const today = formatPixivDate(now)
  const settings = loadSettings()
  return {
    word: tag,
    category: "novel",
    scope: "novel",
    target: "exact_match_for_tags",
    sort: "date_desc",
    mediaFilter: "all",
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: today,
    endDate: today,
    startTimestamp: now,
    endTimestamp: now,
    includeR18: settings.showR18,
    includeR18G: settings.showR18 && settings.showR18G,
    includeAI: settings.showAI,
  }
}

export function TagFeedView(props: {
  tag: string
  kind?: "illust" | "novel" | "pixivision"
}) {
  const { tag, kind = "illust" } = props

  if (kind === "novel") {
    return <TagNovelFeed tag={tag} />
  }
  if (kind === "pixivision") {
    return <TagPixivisionFeed tag={tag} />
  }

  return <TagIllustFeed tag={tag} />
}

function TagIllustFeed(props: { tag: string }) {
  const { tag } = props

  const [advancedParams, setAdvancedParams] = useState<AdvancedSearchParams>(() =>
    defaultTagIllustAdvancedParams(tag)
  )
  const [isAdvancedPresented, setIsAdvancedPresented] = useState(false)

  const hasAdvancedFilters =
    advancedParams.bookmarkThreshold > 0 ||
    advancedParams.mediaFilter !== "all" ||
    advancedParams.useDateRange ||
    (advancedParams.target !== "exact_match_for_tags" &&
      advancedParams.target !== "partial_match_for_tags")

  useRegisterBottomAccessory(
    `tag:${tag}`,
    <TagFeedDockBar
      tagName={tag}
      kind="illust"
      hasActiveFilters={hasAdvancedFilters}
      onTap={() => setIsAdvancedPresented(true)}
    />
  )

  useEffect(() => {
    return onOpenTagAdvancedSearch((targetTag, targetKind) => {
      if (targetTag === tag && targetKind !== "novel") {
        setIsAdvancedPresented(true)
      }
    })
  }, [tag])

  function handleSelectSort(value: SearchSort) {
    if (value === "popular_desc" && !session.user?.is_premium) {
      try {
        triggerHaptic("warning")
      } catch {}
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({
          title: "提示",
          message: "当前账号非 Pixiv Premium 会员，无法使用按热门排序，可在「高级搜索」中使用「收藏数筛选」替代。",
        })
      }
      return
    }
    setAdvancedParams((prev) => ({ ...prev, sort: value }))
  }

  const paged = usePagedList<PixivIllustration>({
    first: (token) => {
      const effectiveTarget =
        advancedParams.bookmarkThreshold > 0 && advancedParams.target === "exact_match_for_tags"
          ? "partial_match_for_tags"
          : advancedParams.target

      const startDate =
        advancedParams.useDateRange && advancedParams.startTimestamp
          ? formatPixivDate(advancedParams.startTimestamp)
          : undefined
      const endDate =
        advancedParams.useDateRange && advancedParams.endTimestamp
          ? formatPixivDate(advancedParams.endTimestamp)
          : undefined

      const settings = loadSettings()
      return searchIllustrations(
        {
          word: advancedParams.word || tag,
          target: effectiveTarget,
          sort: advancedParams.sort,
          aiFilter: (!settings.showAI || advancedParams.includeAI === false) ? 0 : undefined,
          bookmarkThreshold:
            advancedParams.bookmarkThreshold > 0
              ? advancedParams.bookmarkThreshold
              : undefined,
          startDate,
          endDate,
        },
        token
      )
    },
    more: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const blocklist = loadBlocklist()
      let filtered = items.filter((item) => {
        if (!isIllustContentVisible(item, settings, blocklist)) return false
        if (advancedParams.includeR18 === false) {
          const isR18 =
            (item.x_restrict ?? 0) > 0 ||
            item.tags?.some((t) => /r-?18/i.test(t.name))
          if (isR18) return false
        } else if (advancedParams.includeR18G === false) {
          const isR18G =
            item.x_restrict === 2 ||
            item.tags?.some((t) => /r-?18g/i.test(t.name))
          if (isR18G) return false
        }
        if (advancedParams.includeAI === false) {
          if (item.illust_ai_type === 2) return false
        }
        return true
      })
      if (advancedParams.mediaFilter === "illust") {
        filtered = filtered.filter((item) => item.type === "illust")
      } else if (advancedParams.mediaFilter === "manga") {
        filtered = filtered.filter((item) => item.type === "manga")
      } else if (advancedParams.mediaFilter === "ugoira") {
        filtered = filtered.filter((item) => item.type === "ugoira")
      }
      return dedupeByID(filtered)
    },
    deps: [tag, advancedParams],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(cardThumbUrlOf)).cancel,
  })

  // 设置变更（屏蔽标签/用户）后立即重新加载过滤
  const pagedRef = useLatest(paged)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => getLastActiveAmbientImageUrl())
  useEffect(() => {
    const first = paged.items[0]
    if (first) {
      setAmbientImageUrl(cardThumbUrlOf(first))
    } else if (!paged.initialLoading && paged.items.length === 0) {
      setAmbientImageUrl(null)
    }
  }, [paged.items[0]?.id, paged.initialLoading, paged.items.length])
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  const sortPicker = (
    <Picker
      title="排序方式"
      value={advancedParams.sort}
      onChanged={(value: string) => handleSelectSort(value as SearchSort)}
    >
      <Label tag="date_desc" title="最新" systemImage="clock" />
      <Label tag="popular_desc" title="热门" systemImage="flame" />
      <Label
        tag="date_asc"
        title="最早"
        systemImage="clock.arrow.circlepath"
      />
    </Picker>
  )

  const tagMenu = (
    <Menu
      key="tag-feed-menu"
      label={
        <Image
          systemName={
            hasAdvancedFilters
              ? "line.3.horizontal.decrease.circle.fill"
              : "ellipsis.circle"
          }
        />
      }
    >
      {sortPicker}
      <Button
        title="高级搜索"
        systemImage="slider.horizontal.3"
        action={() => setIsAdvancedPresented(true)}
      />
    </Menu>
  )

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={{
        isPresented: isAdvancedPresented,
        onChanged: (presented: boolean) => setIsAdvancedPresented(presented),
        content: (
          <SearchAdvancedSheet
            currentParams={advancedParams}
            settings={loadSettings()}
            lockScope="illust"
            onApply={(params: AdvancedSearchParams) => {
              setAdvancedParams(params)
              setIsAdvancedPresented(false)
            }}
            onCancel={() => setIsAdvancedPresented(false)}
          />
        ),
      }}
    >
      <RefreshableScrollView
        navigationTitle={`#${tag}`}
        navigationBarTitleDisplayMode="inline"
        background={ambientBackground}
        refreshable={paged.refresh}
        toolbar={{
          topBarTrailing: [tagMenu],
          principal: [
            <Text key="tag-nav-title" font="title2" fontWeight="bold">
              #{tag}
            </Text>,
          ],
        }}
      >
        <VStack alignment="leading" spacing={8}>
          {paged.initialLoading ? (
            <LoadingView />
          ) : paged.error && paged.items.length === 0 ? (
            <ErrorView message={paged.error} onRetry={paged.refresh} />
          ) : paged.items.length === 0 ? (
            <EmptyView
              text={
                paged.hasFilteredContent
                  ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                  : hasAdvancedFilters
                    ? "未找到符合当前筛选条件的插画作品"
                    : "该标签下暂无插画作品"
              }
              systemImage={paged.hasFilteredContent ? "eye.slash" : "photo"}
            />
          ) : (
            <IllustFlowFeed
              items={paged.items}
              onLoadMore={paged.loadMore}
              hasMore={paged.hasMore}
              isLoading={paged.loadingMore}
              loadMoreError={paged.loadMoreError}
              onRetryLoadMore={paged.retryLoadMore}
            />
          )}
        </VStack>
      </RefreshableScrollView>
    </ZStack>
  )
}

function TagNovelFeed(props: { tag: string }) {
  const { tag } = props

  const [advancedParams, setAdvancedParams] = useState<AdvancedSearchParams>(() =>
    defaultTagNovelAdvancedParams(tag)
  )
  const [isAdvancedPresented, setIsAdvancedPresented] = useState(false)

  const hasAdvancedFilters =
    advancedParams.bookmarkThreshold > 0 ||
    advancedParams.useDateRange ||
    (advancedParams.target !== "exact_match_for_tags" &&
      advancedParams.target !== "partial_match_for_tags")

  useRegisterBottomAccessory(
    `novelTag:${tag}`,
    <TagFeedDockBar
      tagName={tag}
      kind="novel"
      hasActiveFilters={hasAdvancedFilters}
      onTap={() => setIsAdvancedPresented(true)}
    />
  )

  useEffect(() => {
    return onOpenTagAdvancedSearch((targetTag, targetKind) => {
      if (targetTag === tag && targetKind !== "illust") {
        setIsAdvancedPresented(true)
      }
    })
  }, [tag])

  function handleSelectSort(value: SearchSort) {
    if (value === "popular_desc" && !session.user?.is_premium) {
      try {
        triggerHaptic("warning")
      } catch {}
      if (typeof Dialog !== "undefined" && typeof Dialog.alert === "function") {
        void Dialog.alert({
          title: "提示",
          message: "当前账号非 Pixiv Premium 会员，无法使用按热门排序，可在「高级搜索」中使用「收藏数筛选」替代。",
        })
      }
      return
    }
    setAdvancedParams((prev) => ({ ...prev, sort: value }))
  }

  const paged = usePagedList<PixivNovel>({
    first: (token) => {
      const effectiveTarget =
        advancedParams.bookmarkThreshold > 0 && advancedParams.target === "exact_match_for_tags"
          ? "partial_match_for_tags"
          : advancedParams.target

      const startDate =
        advancedParams.useDateRange && advancedParams.startTimestamp
          ? formatPixivDate(advancedParams.startTimestamp)
          : undefined
      const endDate =
        advancedParams.useDateRange && advancedParams.endTimestamp
          ? formatPixivDate(advancedParams.endTimestamp)
          : undefined

      const settings = loadSettings()
      return searchNovels(
        {
          word: advancedParams.word || tag,
          target: effectiveTarget,
          sort: advancedParams.sort,
          aiFilter: (!settings.showAI || advancedParams.includeAI === false) ? 0 : undefined,
          bookmarkThreshold:
            advancedParams.bookmarkThreshold > 0
              ? advancedParams.bookmarkThreshold
              : undefined,
          startDate,
          endDate,
        },
        token
      )
    },
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      const blocklist = loadBlocklist()
      return dedupeByID(
        items.filter((novel) => {
          if (!isNovelContentVisible(novel, settings, blocklist)) return false
          if (advancedParams.includeR18 === false) {
            const isR18 =
              (novel.x_restrict ?? 0) > 0 ||
              novel.tags?.some((t) => /r-?18/i.test(t.name))
            if (isR18) return false
          } else if (advancedParams.includeR18G === false) {
            const isR18G =
              novel.x_restrict === 2 ||
              novel.tags?.some((t) => /r-?18g/i.test(t.name))
            if (isR18G) return false
          }
          if (advancedParams.includeAI === false) {
            if (novel.novel_ai_type === 2) return false
          }
          return true
        })
      )
    },
    deps: [tag, advancedParams],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => getLastActiveAmbientImageUrl())
  useEffect(() => {
    const first = paged.items[0]
    if (first) {
      setAmbientImageUrl(novelThumbUrlOf(first))
    } else if (!paged.initialLoading && paged.items.length === 0) {
      setAmbientImageUrl(null)
    }
  }, [paged.items[0]?.id, paged.initialLoading, paged.items.length])
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  const sortPicker = (
    <Picker
      title="排序方式"
      value={advancedParams.sort}
      onChanged={(value: string) => handleSelectSort(value as SearchSort)}
    >
      <Label tag="date_desc" title="最新" systemImage="clock" />
      <Label tag="popular_desc" title="热门" systemImage="flame" />
      <Label
        tag="date_asc"
        title="最早"
        systemImage="clock.arrow.circlepath"
      />
    </Picker>
  )

  const tagMenu = (
    <Menu
      key="novel-tag-feed-menu"
      label={
        <Image
          systemName={
            hasAdvancedFilters
              ? "line.3.horizontal.decrease.circle.fill"
              : "ellipsis.circle"
          }
        />
      }
    >
      {sortPicker}
      <Button
        title="高级搜索"
        systemImage="slider.horizontal.3"
        action={() => setIsAdvancedPresented(true)}
      />
    </Menu>
  )

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={{
        isPresented: isAdvancedPresented,
        onChanged: (presented: boolean) => setIsAdvancedPresented(presented),
        content: (
          <SearchAdvancedSheet
            currentParams={advancedParams}
            settings={loadSettings()}
            lockScope="novel"
            onApply={(params: AdvancedSearchParams) => {
              setAdvancedParams(params)
              setIsAdvancedPresented(false)
            }}
            onCancel={() => setIsAdvancedPresented(false)}
          />
        ),
      }}
    >
      <RefreshableScrollView
        navigationTitle={`#${tag}`}
        navigationBarTitleDisplayMode="inline"
        background={ambientBackground}
        refreshable={paged.refresh}
        toolbar={{
          topBarTrailing: [tagMenu],
          principal: [
            <Text key="novel-tag-nav-title" font="title2" fontWeight="bold">
              #{tag}
            </Text>,
          ],
        }}
      >
        <VStack alignment="leading" spacing={8}>
          {paged.initialLoading ? (
            <LoadingView />
          ) : paged.error && paged.items.length === 0 ? (
            <ErrorView message={paged.error} onRetry={paged.refresh} />
          ) : paged.items.length === 0 ? (
            <EmptyView
              text={
                paged.hasFilteredContent
                  ? "当前页面部分作品被内容显示设置过滤，暂时无法显示"
                  : hasAdvancedFilters
                    ? "未找到符合当前筛选条件的小说作品"
                    : "该标签下暂无小说作品"
              }
              systemImage={paged.hasFilteredContent ? "eye.slash" : "book"}
            />
          ) : (
            <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
              {paged.items.map((novel, index) => (
                <NovelCard key={novel.id} novel={novel} priority={index} />
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
            </LazyVStack>
          )}
        </VStack>
      </RefreshableScrollView>
    </ZStack>
  )
}

function TagPixivisionFeed(props: { tag: string }) {
  const { tag: rawTag } = props

  // 解析 tag 参数：可能格式为 "1200?name=可丽饼" 或 "1200" 或 "可丽饼"
  let queryKey = rawTag
  let displayName = ""
  if (rawTag.includes("?name=")) {
    const [idPart, namePart] = rawTag.split("?name=")
    queryKey = idPart
    try {
      displayName = decodeURIComponent(namePart)
    } catch {
      displayName = namePart
    }
  } else if (!/^\d+$/.test(rawTag)) {
    displayName = rawTag
  }

  const navTitle = displayName ? `#${displayName} - 特辑` : `#特辑`

  const paged = usePagedList<PixivisionArticle>({
    first: () => pixivisionByTag(queryKey, 1),
    more: (nextURL) => {
      const page = Number(nextURL?.match(/[?&]p(?:age)?=(\d+)/i)?.[1] ?? "2")
      return pixivisionByTag(queryKey, page)
    },
    deps: [rawTag],
    requiresAuth: false,
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map((item) => item.imageURL)).cancel,
  })

  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => getLastActiveAmbientImageUrl())
  useEffect(() => {
    const first = paged.items[0]
    if (first?.imageURL) {
      setAmbientImageUrl(first.imageURL)
    } else if (!paged.initialLoading && paged.items.length === 0) {
      setAmbientImageUrl(null)
    }
  }, [paged.items[0]?.id, paged.initialLoading, paged.items.length])
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  return (
    <RefreshableScrollView
      navigationTitle={navTitle}
      navigationBarTitleDisplayMode="inline"
      background={ambientBackground}
      refreshable={paged.refresh}
      toolbar={{
        principal: [
          <Text key="pixivision-tag-nav-title" font="title2" fontWeight="bold">
            {navTitle}
          </Text>,
        ],
      }}
    >
      <VStack alignment="leading" spacing={8}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView
            text="该标签下暂无相关特辑"
            systemImage="rectangle.stack"
          />
        ) : (
          <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 12 }}>
            {paged.items.map((article, index) => (
              <PixivisionCard key={article.id} article={article} priority={index} />
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
          </LazyVStack>
        )}
      </VStack>
    </RefreshableScrollView>
  )
}

function filterTagIllustItems(items: PixivIllustration[]): PixivIllustration[] {
  const settings = loadSettings()
  return items.filter((item) => isIllustContentVisible(item, settings))
}

function filterTagNovelItems(items: PixivNovel[]): PixivNovel[] {
  const settings = loadSettings()
  return items.filter((item) => isNovelContentVisible(item, settings))
}
