import React, { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshControl, StyleSheet, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  followingFeed,
  followingNovels,
  myPixivFeed,
  myPixivNovels,
  nextIllustrations,
  nextNovels,
  nextWatchlist,
  watchlistManga,
  watchlistNovels,
  type FollowRestriction,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { onWatchlistChanged } from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import { loadBlocklist } from "../../../../../../Pix-Scripting/src/store/blocklist"
import { updateSettings } from "../../../../../../Pix-Scripting/src/store/settings"
import type {
  PixivIllustration,
  PixivNovel,
  PixivWatchlistSeries,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  EmptyView,
  ErrorView,
  HeaderIconButton,
  IllustMasonryFeed,
  InlineFooterLoader,
  LoadingView,
  NovelFeedList,
  ScreenHeader,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { WatchlistSeriesCard } from "./WatchlistSeriesCard"

type FollowMode = "following" | "watchlist" | "friends"
type WorkKind = "illust" | "novel"
type WatchKind = "manga" | "novel"

const MODE_CHIPS: ReadonlyArray<ChipItem<FollowMode>> = [
  { value: "following", label: "关注动态" },
  { value: "watchlist", label: "追更列表" },
  { value: "friends", label: "好P友" },
]

const RESTRICT_LABELS: Record<FollowRestriction, string> = {
  all: "全部关注",
  public: "公开关注",
  private: "私密关注",
}

const RESTRICT_CYCLE: FollowRestriction[] = ["all", "public", "private"]

function FollowingIllustFeed({
  mode,
  restrict,
}: {
  mode: "following" | "friends"
  restrict: FollowRestriction
}) {
  const { settings } = useAppTheme()
  const exempt = settings.exemptFilterForPersonal

  const feed = usePixivFeed<PixivIllustration>({
    fetcher: (token) =>
      mode === "following" ? followingFeed(restrict, token) : myPixivFeed(token),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const bl = loadBlocklist()
      return items.filter((item) =>
        isIllustContentVisible(item, settings, bl, { exemptRestrictions: exempt }),
      )
    },
    deps: [mode, restrict, exempt],
  })

  return (
    <IllustMasonryFeed
      items={feed.items}
      loading={feed.loading}
      refreshing={feed.refreshing}
      loadingMore={feed.loadingMore}
      error={feed.error}
      loadMoreError={feed.loadMoreError}
      hasMore={feed.hasMore}
      emptyTitle={mode === "following" ? "暂无关注画师的新作" : "暂无好P友新作"}
      emptySubtitle="下拉刷新，或在探索/搜索中关注更多创作者"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function FollowingNovelFeed({
  mode,
  restrict,
}: {
  mode: "following" | "friends"
  restrict: FollowRestriction
}) {
  const { settings } = useAppTheme()
  const exempt = settings.exemptFilterForPersonal

  const feed = usePixivFeed<PixivNovel>({
    fetcher: (token) =>
      mode === "following" ? followingNovels(restrict, token) : myPixivNovels(token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const bl = loadBlocklist()
      return items.filter((item) =>
        isNovelContentVisible(item, settings, bl, { exemptRestrictions: exempt }),
      )
    },
    deps: [mode, restrict, exempt],
  })

  return (
    <NovelFeedList
      items={feed.items}
      loading={feed.loading}
      refreshing={feed.refreshing}
      loadingMore={feed.loadingMore}
      error={feed.error}
      loadMoreError={feed.loadMoreError}
      hasMore={feed.hasMore}
      emptyTitle={mode === "following" ? "暂无关注作者的新小说" : "暂无好P友小说"}
      emptySubtitle="下拉刷新或切换筛选范围"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function WatchlistFeed({ kind }: { kind: WatchKind }) {
  const { accent, settings } = useAppTheme()
  const insets = useSafeInsets()

  const feed = usePixivFeed<PixivWatchlistSeries>({
    fetcher: (token) => (kind === "manga" ? watchlistManga(token) : watchlistNovels(token)),
    fetchMore: (nextURL, token) => nextWatchlist(nextURL, token),
    deps: [kind],
  })

  useEffect(() => {
    return onWatchlistChanged((seriesId, changedKind, watched) => {
      if (changedKind !== kind) return
      if (!watched) {
        feed.setRawItems((prev) => prev.filter((item) => item.id !== seriesId))
      } else {
        void feed.refresh()
      }
    })
  }, [kind, feed.setRawItems, feed.refresh])

  const displayItems = useMemo(() => {
    if (settings.watchlistSortOrder === "desc") {
      return [...feed.items].reverse()
    }
    return feed.items
  }, [feed.items, settings.watchlistSortOrder])

  const handleUnwatched = useCallback(
    (seriesId: number) => {
      feed.setRawItems((prev) => prev.filter((item) => item.id !== seriesId))
    },
    [feed.setRawItems],
  )

  const renderItem = useCallback(
    ({ item }: { item: PixivWatchlistSeries }) => (
      <WatchlistSeriesCard series={item} kind={kind} onUnwatched={handleUnwatched} />
    ),
    [kind, handleUnwatched],
  )

  if (feed.loading && displayItems.length === 0) {
    return <LoadingView />
  }
  if (feed.error && displayItems.length === 0) {
    return <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
  }
  if (!feed.loading && displayItems.length === 0) {
    return (
      <EmptyView
        title={kind === "manga" ? "暂无漫画追更" : "暂无小说追更"}
        subtitle="在系列详情页点击「追更」即可订阅更新"
        actionLabel="刷新"
        onAction={() => void feed.refresh()}
      />
    )
  }

  return (
    <FlashList
      data={displayItems}
      keyExtractor={(item) => `${kind}-${item.id}`}
      renderItem={renderItem}
      estimatedItemSize={132}
      contentContainerStyle={{
        paddingTop: 10,
        paddingBottom: effectiveBottomInset(insets) + 28,
      }}
      refreshControl={
        <RefreshControl
          refreshing={feed.refreshing}
          onRefresh={() => void feed.refresh()}
          tintColor={accent}
          colors={[accent]}
        />
      }
      onEndReached={() => {
        if (feed.hasMore && !feed.loadingMore) void feed.loadMore()
      }}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        <InlineFooterLoader
          loading={feed.loadingMore}
          hasMore={feed.hasMore}
          error={feed.loadMoreError}
          onLoadMore={() => void feed.loadMore()}
        />
      }
    />
  )
}

export function FollowFeedScreen() {
  const { colors, settings } = useAppTheme()

  const [mode, setMode] = useState<FollowMode>("following")
  const [restrict, setRestrict] = useState<FollowRestriction>("all")
  const [followKind, setFollowKind] = useState<WorkKind>("illust")
  const [watchKind, setWatchKind] = useState<WatchKind>("manga")
  const [friendKind, setFriendKind] = useState<WorkKind>("illust")

  useEffect(() => {
    if (settings.hideNovels) {
      setFollowKind("illust")
      setWatchKind("manga")
      setFriendKind("illust")
    }
  }, [settings.hideNovels])

  const subChips = useMemo<ChipItem<string>[]>(() => {
    if (mode === "watchlist") {
      const list: ChipItem<string>[] = [{ value: "manga", label: "漫画系列" }]
      if (!settings.hideNovels) list.push({ value: "novel", label: "小说系列" })
      return list
    }
    const list: ChipItem<string>[] = [{ value: "illust", label: "插画·漫画" }]
    if (!settings.hideNovels) list.push({ value: "novel", label: "小说" })
    return list
  }, [mode, settings.hideNovels])

  const selectedSub =
    mode === "following" ? followKind : mode === "watchlist" ? watchKind : friendKind

  function handleSelectSub(value: string) {
    if (mode === "following") setFollowKind(value as WorkKind)
    else if (mode === "watchlist") setWatchKind(value as WatchKind)
    else setFriendKind(value as WorkKind)
  }

  function cycleRestrict() {
    const idx = RESTRICT_CYCLE.indexOf(restrict)
    setRestrict(RESTRICT_CYCLE[(idx + 1) % RESTRICT_CYCLE.length])
  }

  function toggleWatchlistOrder() {
    updateSettings({
      watchlistSortOrder: settings.watchlistSortOrder === "asc" ? "desc" : "asc",
    })
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="关注"
        subtitle={mode === "following" ? RESTRICT_LABELS[restrict] : undefined}
        right={
          mode === "following" ? (
            <HeaderIconButton
              label={RESTRICT_LABELS[restrict]}
              onPress={cycleRestrict}
            />
          ) : mode === "watchlist" ? (
            <HeaderIconButton
              label={settings.watchlistSortOrder === "asc" ? "默认序" : "倒序"}
              onPress={toggleWatchlistOrder}
            />
          ) : undefined
        }
        bottom={
          <View style={styles.controls}>
            <ChipBar items={MODE_CHIPS} selected={mode} onSelect={setMode} />
            {subChips.length > 1 ? (
              <ChipBar
                items={subChips}
                selected={selectedSub}
                onSelect={handleSelectSub}
                compact={true}
              />
            ) : null}
          </View>
        }
      />

      <View style={styles.body}>
        {mode === "watchlist" ? (
          <WatchlistFeed kind={watchKind} />
        ) : mode === "following" ? (
          followKind === "novel" ? (
            <FollowingNovelFeed mode="following" restrict={restrict} />
          ) : (
            <FollowingIllustFeed mode="following" restrict={restrict} />
          )
        ) : friendKind === "novel" ? (
          <FollowingNovelFeed mode="friends" restrict="all" />
        ) : (
          <FollowingIllustFeed mode="friends" restrict="all" />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  controls: {
    gap: 2,
    paddingBottom: 6,
  },
  body: {
    flex: 1,
  },
})
