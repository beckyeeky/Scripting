import {
  Button,
  Device,
  HStack,
  Image,
  Label,
  LazyVStack,
  Menu,
  Picker,
  Text,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import { useDualRoute } from "./DualRouteContext"
import { nextNovelMarkers, novelMarkers } from "../api/pixiv"
import {
  buildOfflineViews,
  filterOfflineViews,
  listOfflineEpisodes,
  offlineBadgeText,
  offlineLibraryUsage,
  removeOfflineEpisode,
  sortOfflineViews,
  type OfflineEpisodeSummary,
  type OfflineFilter,
  type OfflineSort,
} from "../store/novelOfflineLibrary"
import { getNovelHighestProgress, getNovelProgress, onNovelProgressChanged } from "../store/novelProgress"
import { appGlass } from "./components/glass"
import { requestPixivRoute } from "../store/routeNavigation"
import { novelThumbUrlOf, prefetch } from "../image/imageLoader"
import {
  loadSettings,
  onSettingsChanged,
} from "../store/settings"
import { isNovelContentVisible } from "../store/contentFilter"
import { onNovelMarkerChanged } from "../store/bookmarkSync"
import { useLatest, usePagedList, currentBatchSize, useLayoutMetrics, IPAD_WIDE_MIN_WIDTH } from "./Hooks"
import { useExperimentalAmbientPalette, getLastActiveAmbientImageUrl, recordActiveAmbientImageUrl } from "./ambient"
import { destinationElement } from "./DestinationElement"
import {
  DockActionBar,
  useRegisterBottomAccessory,
  type DockActionItem,
} from "./bottomAccessory"
import type { PixivNovelMarker } from "../types"
import { triggerHaptic } from "../platform/haptics"
import {
  EmptyView,
  ErrorView,
  LoadingView,
  LoadMoreTrigger,
  NovelCard,
  RefreshableScrollView,
} from "./components"

// Pixiv 小说书签（Marker）列表。它与小说收藏是不同资源：
// 服务端仅返回已保存小说 Marker 的条目，不支持公开/私密与标签筛选。
export function NovelLibraryView() {
  const paged = usePagedList<PixivNovelMarker>({
    first: (token) => novelMarkers(token),
    more: (nextURL, token) => nextNovelMarkers(nextURL, token),
    filter: (items) => {
      const settings = loadSettings()
      return items.filter((item) =>
        isNovelContentVisible(item.novel, settings, undefined, {
          exemptRestrictions: settings.exemptFilterForPersonal,
        })
      )
    },
    deps: [],
    onBatchPublished: (_, pendingItems) =>
      prefetch(
        pendingItems.slice(0, currentBatchSize()).map((item) => novelThumbUrlOf(item.novel))
      ).cancel,
  })

  const pagedRef = useLatest(paged)
  const [isAscending, setIsAscending] = useState(false)
  const [pageLayout, setPageLayout] = useState(() => loadSettings().pageLayout)
  const isAppleMusic = pageLayout === "appleMusic"

  useEffect(() => {
    return onSettingsChanged(() => {
      setPageLayout(loadSettings().pageLayout)
    })
  }, [])

  const { isSplitViewActive } = useDualRoute()
  const layoutMetrics = useLayoutMetrics()
  const isFullScreenPad =
    Device.isiPad &&
    !isSplitViewActive &&
    layoutMetrics.width >= IPAD_WIDE_MIN_WIDTH

  const sortedItems = useMemo(() => {
    if (!isAscending) return paged.items
    return [...paged.items].reverse()
  }, [paged.items, isAscending])

  const novelBookmarkAccessory = useMemo(() => {
    const items: DockActionItem[] = [
      {
        key: "title",
        label: "小说书签",
        icon: "book.pages.fill",
        color: "systemPink",
        action: () => {
          try {
            triggerHaptic("selection")
          } catch {}
        },
      },
      {
        key: "sort",
        label: isAscending ? "正序" : "倒序",
        icon: isAscending ? "arrow.up" : "arrow.down",
        color: "systemBlue",
        action: () => {
          try {
            triggerHaptic("selection")
          } catch {}
          setIsAscending((v) => !v)
        },
      },
    ]
    return <DockActionBar items={items} />
  }, [isAscending])

  useRegisterBottomAccessory(
    "novelBookmarks",
    novelBookmarkAccessory,
    isAppleMusic
  )

  // ── 离线书库（按账号隔离；阅读进度与批注独立于缓存清理） ──
  const [offlineFilter, setOfflineFilter] = useState<OfflineFilter>("all")
  const [offlineSort, setOfflineSort] = useState<OfflineSort>("recent")
  const [offlineVersion, setOfflineVersion] = useState(0)
  const [showOffline, setShowOffline] = useState(true)

  useEffect(() => {
    // 阅读进度变化时刷新「在读/已读」筛选结果；离线缓存变化由 offlineVersion 触发
    return onNovelProgressChanged(() => setOfflineVersion((value) => value + 1))
  }, [])

  const offlineViews = useMemo(() => {
    const summaries: OfflineEpisodeSummary[] = listOfflineEpisodes()
    const views = buildOfflineViews(summaries, (novelId) => {
      const current = getNovelProgress(novelId)
      const highest = getNovelHighestProgress(novelId)
      if (!current && !highest) return null
      return {
        currentPage: current?.page ?? highest?.page ?? 1,
        highestPage: highest?.page ?? current?.page ?? 1,
      }
    })
    return sortOfflineViews(filterOfflineViews(views, offlineFilter), offlineSort)
  }, [offlineFilter, offlineSort, offlineVersion])

  const offlineUsage = useMemo(() => offlineLibraryUsage(), [offlineVersion])

  const [ambientImageUrl, setAmbientImageUrl] = useState<string | null>(() => getLastActiveAmbientImageUrl())
  useEffect(() => {
    const firstUrl = sortedItems[0] ? novelThumbUrlOf(sortedItems[0].novel) : null
    if (firstUrl) {
      setAmbientImageUrl(firstUrl)
      recordActiveAmbientImageUrl(firstUrl)
    } else if (!paged.initialLoading && sortedItems.length === 0) {
      setAmbientImageUrl(null)
    }
  }, [sortedItems[0]?.novel?.id, paged.initialLoading, sortedItems.length])
  const { ambientBackground } = useExperimentalAmbientPalette(ambientImageUrl)
  useEffect(() => {
    return onSettingsChanged(() => {
      pagedRef.current.reapplyFilter()
    })
  }, [])

  useEffect(() => {
    return onNovelMarkerChanged(() => {
      pagedRef.current.refresh()
    })
  }, [])

  const fullTitle = `小说书签 · ${isAscending ? "升序" : "降序"}`

  const trailingActions = (() => {
    if (isFullScreenPad) {
      return [
        <Menu
          key="novel-library-wide-menu"
          label={
            <HStack alignment="center" spacing={4}>
              <Text font="subheadline" fontWeight="semibold">
                {fullTitle}
              </Text>
              <Image
                systemName="chevron.down"
                font="caption2"
                foregroundStyle="secondaryLabel"
              />
            </HStack>
          }
        >
          <Picker
            title="排序方式"
            value={isAscending ? "asc" : "desc"}
            onChanged={(v: string) => setIsAscending(v === "asc")}
          >
            <Label tag="desc" title="降序（最新在前）" systemImage="arrow.down" />
            <Label tag="asc" title="升序（最早在前）" systemImage="arrow.up" />
          </Picker>
        </Menu>,
      ]
    }

    return [
      <Button
        key="sort-btn"
        action={() => {
          try {
            triggerHaptic("selection")
          } catch {}
          setIsAscending((v) => !v)
        }}
      >
        <Image systemName={isAscending ? "arrow.up" : "arrow.down"} />
      </Button>,
    ]
  })()

  return (
    <RefreshableScrollView
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        principal: isFullScreenPad ? undefined : (
          <Text font="title2" fontWeight="bold">
            小说书签
          </Text>
        ),
        topBarTrailing: trailingActions,
      }}
      background={ambientBackground}
      refreshable={paged.refresh}
      navigationDestination={destinationElement}
    >
      {paged.initialLoading ? (
        <LoadingView />
      ) : paged.error && paged.items.length === 0 ? (
        <ErrorView message={paged.error} onRetry={paged.refresh} />
      ) : paged.items.length === 0 ? (
        <EmptyView text="暂无小说书签" systemImage="book.pages" />
      ) : (
        <LazyVStack alignment="leading" spacing={8} padding={{ horizontal: 8 }}>
          {/* 离线书库：正文与元数据磁盘缓存；阅读进度、批注在缓存清理后仍保留 */}
          <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
            <Button
              buttonStyle="plain"
              action={() => setShowOffline((value) => !value)}
            >
              <HStack spacing={6} alignment="center" padding={{ vertical: 4 }} frame={{ maxWidth: "infinity" }}>
                <Image systemName="arrow.down.circle" font="footnote" foregroundStyle="systemBlue" />
                <Text font="subheadline" fontWeight="bold">
                  离线书库
                </Text>
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  {`${offlineUsage.count} 篇 · ${Math.max(1, Math.round(offlineUsage.bytes / 1024))} KB`}
                </Text>
                <Spacer />
                <Image
                  systemName={showOffline ? "chevron.up" : "chevron.down"}
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                />
              </HStack>
            </Button>
            {showOffline ? (
              <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={10} alignment="center" frame={{ maxWidth: "infinity" }}>
                  <Picker
                    title="筛选"
                    value={offlineFilter}
                    onChanged={(value: string) => setOfflineFilter(value as OfflineFilter)}
                  >
                    <Text tag="all">全部</Text>
                    <Text tag="reading">在读</Text>
                    <Text tag="unread">未读</Text>
                    <Text tag="finished">已读完</Text>
                  </Picker>
                  <Picker
                    title="排序"
                    value={offlineSort}
                    onChanged={(value: string) => setOfflineSort(value as OfflineSort)}
                  >
                    <Text tag="recent">最近阅读</Text>
                    <Text tag="saved">保存时间</Text>
                    <Text tag="title">标题</Text>
                  </Picker>
                </HStack>
                {offlineViews.length === 0 ? (
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    还没有符合条件的离线作品。打开小说详情页「离线与目录 → 保存到离线书库」即可断网阅读。
                  </Text>
                ) : (
                  offlineViews.map((view) => (
                    <HStack
                      key={`offline-${view.novelId}`}
                      spacing={10}
                      alignment="center"
                      padding={{ horizontal: 12, vertical: 10 }}
                      glassEffect={appGlass({ type: "rect", cornerRadius: 12 })}
                      contentShape={{ type: "rect", cornerRadius: 12 }}
                      frame={{ maxWidth: "infinity" }}
                      onTapGesture={() => requestPixivRoute(`novel:${view.novelId}`)}
                    >
                      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                        <Text font="subheadline" fontWeight="semibold" lineLimit={1}>
                          {view.title}
                        </Text>
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          {[
                            offlineBadgeText(true, true),
                            view.readState
                              ? `阅读 ${view.readState.currentPage}/${view.pageCount} 页 · 最高 ${view.readState.highestPage} 页`
                              : `${view.pageCount} 页 · 未读`,
                            view.imageTotal > 0 ? `图片 ${view.imageOk}/${view.imageTotal}` : null,
                          ].filter(Boolean).join(" · ")}
                        </Text>
                      </VStack>
                      <Button
                        buttonStyle="plain"
                        action={async () => {
                          const confirmed = typeof Dialog !== "undefined" && typeof Dialog.confirm === "function"
                            ? await Dialog.confirm({
                                title: "移除离线缓存？",
                                message: `将删除《${view.title}》的离线正文；阅读进度与批注保留。`,
                                confirmLabel: "移除",
                                cancelLabel: "取消",
                              })
                            : true
                          if (!confirmed) return
                          removeOfflineEpisode(view.novelId)
                          triggerHaptic("success")
                          setOfflineVersion((value) => value + 1)
                        }}
                      >
                        <Image systemName="trash" font="footnote" foregroundStyle="systemRed" />
                      </Button>
                    </HStack>
                  ))
                )}
              </VStack>
            ) : null}
          </VStack>

          {sortedItems.map((item, index) => (
            <NovelCard
              key={item.novel.id}
              novel={item.novel}
              priority={index}
              markerPage={item.novel_marker.page}
              showEpisodeNumber={false}
            />
          ))}
          <LoadMoreTrigger
            anchor={sortedItems[sortedItems.length - 1]?.novel.id ?? 0}
            onLoadMore={paged.loadMore}
            hasMore={paged.hasMore}
            isLoading={paged.loadingMore}
            loadMoreError={paged.loadMoreError}
            onRetry={paged.retryLoadMore}
          />
        </LazyVStack>
      )}
    </RefreshableScrollView>
  )
}
