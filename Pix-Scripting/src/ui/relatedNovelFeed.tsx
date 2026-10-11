import { LazyVStack, useEffect, useState, VStack } from "scripting"
import { nextNovels, relatedNovels } from "../api/pixiv"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import { loadSettings, onSettingsChanged } from "../store/settings"
import { isNovelContentVisible } from "../store/contentFilter"
import {
  useLatest,
  usePagedList,
  currentBatchSize,
} from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl } from "./ambient"
import type { PixivNovel } from "../types"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"
import { destinationElement } from "./DestinationElement"
import { getCachedNovel } from "../store/novelCache"

export function RelatedNovelFeedView(props: { novelID: number }) {
  const { novelID } = props
  const cached = getCachedNovel(novelID)
  const navTitle = cached?.title ? `相关作品 · ${cached.title}` : "相关作品"

  // 1. 优先使用源小说缩略图作为第 0 毫秒环境色，若无则回退最近活跃环境光垫底
  const initialAmbientUrl = cached ? novelThumbUrlOf(cached) : getLastActiveAmbientImageUrl()
  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(initialAmbientUrl)

  const paged = usePagedList<PixivNovel>({
    first: (token) => relatedNovels(novelID, token),
    more: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => filterRelatedNovels(items, novelID),
    deps: [novelID],
    onBatchPublished: (_, pendingItems) =>
      prefetch(pendingItems.slice(0, currentBatchSize()).map(novelThumbUrlOf)).cancel,
  })

  const pagedRef = useLatest(paged)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  // 2. 列表首图就绪后动态追色
  useEffect(() => {
    const firstUrl = paged.items[0] ? novelThumbUrlOf(paged.items[0]) : null
    if (firstUrl) {
      setAmbientImageUrl(firstUrl)
    } else if (!paged.initialLoading && paged.items.length === 0) {
      setAmbientImageUrl(null)
    }
  }, [paged.items[0]?.id, paged.initialLoading, paged.items.length])

  // 3. 接入实验性沉浸氛围算法
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)

  return (
    <RefreshableScrollView
      navigationTitle={navTitle}
      navigationBarTitleDisplayMode="inline"
      navigationDestination={destinationElement}
      background={ambientBackground}
      refreshable={paged.refresh}
    >
      <VStack alignment="leading" spacing={10}>
        {paged.initialLoading ? (
          <LoadingView />
        ) : paged.error && paged.items.length === 0 ? (
          <ErrorView message={paged.error} onRetry={paged.refresh} />
        ) : paged.items.length === 0 ? (
          <EmptyView
            text={
              paged.hasFilteredContent
                ? "当前页面部分小说被内容显示设置过滤，暂时无法显示"
                : "暂无相关作品"
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
  )
}

function filterRelatedNovels(
  items: PixivNovel[],
  targetID: number
): PixivNovel[] {
  const settings = loadSettings()
  return items.filter(
    (item) => item.id !== targetID && isNovelContentVisible(item, settings)
  )
}
