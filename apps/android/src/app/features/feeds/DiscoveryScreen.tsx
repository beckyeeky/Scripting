import React, { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshControl, StyleSheet, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  newIllustrations,
  newNovels,
  nextIllustrations,
  nextNovels,
  nextPixivision,
  pixivisionHome,
  recommendations,
  recommendedNovels,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import type {
  PixivIllustration,
  PixivNovel,
  PixivisionArticle,
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
import { useAppNav } from "../../navigation/NavContext"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { PixivisionCard } from "./PixivisionCard"

type ExploreMode = "recommended" | "latest" | "pixivision"
type FeedKind = "illustration" | "manga" | "novel"

const MODE_CHIPS: ReadonlyArray<ChipItem<ExploreMode>> = [
  { value: "recommended", label: "推荐" },
  { value: "latest", label: "最新" },
  { value: "pixivision", label: "Pixivision 特辑" },
]

function DiscoveryIllustFeed({
  mode,
  kind,
  heroFirst,
}: {
  mode: "recommended" | "latest"
  kind: "illustration" | "manga"
  heroFirst: boolean
}) {
  const feed = usePixivFeed<PixivIllustration>({
    fetcher: (token) =>
      mode === "recommended" ? recommendations(kind, token) : newIllustrations(kind, token),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => items.filter((item) => isIllustContentVisible(item)),
    deps: [mode, kind],
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
      heroFirst={heroFirst}
      emptyTitle={mode === "recommended" ? "暂无推荐作品" : "暂无最新作品"}
      emptySubtitle="下拉刷新或检查过滤与屏蔽设置"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function DiscoveryNovelFeed({ mode }: { mode: "recommended" | "latest" }) {
  const feed = usePixivFeed<PixivNovel>({
    fetcher: (token) =>
      mode === "recommended" ? recommendedNovels(token) : newNovels(token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => items.filter((item) => isNovelContentVisible(item)),
    deps: [mode],
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
      emptyTitle={mode === "recommended" ? "暂无推荐小说" : "暂无最新小说"}
      emptySubtitle="下拉刷新或检查过滤与屏蔽设置"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function DiscoveryPixivisionFeed() {
  const { accent } = useAppTheme()
  const insets = useSafeInsets()

  const feed = usePixivFeed<PixivisionArticle>({
    fetcher: () => pixivisionHome(),
    fetchMore: (nextURL) => nextPixivision(nextURL),
    publicEndpoint: true,
    deps: ["pixivision-home"],
  })

  const renderItem = useCallback(
    ({ item }: { item: PixivisionArticle }) => <PixivisionCard article={item} />,
    [],
  )

  if (feed.loading && feed.items.length === 0) {
    return <LoadingView />
  }
  if (feed.error && feed.items.length === 0) {
    return <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
  }
  if (!feed.loading && feed.items.length === 0) {
    return (
      <EmptyView
        title="暂无 Pixivision 特辑"
        subtitle="下拉重新加载"
        actionLabel="重试"
        onAction={() => void feed.refresh()}
      />
    )
  }

  return (
    <FlashList
      data={feed.items}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      estimatedItemSize={290}
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

export function DiscoveryScreen() {
  const { colors, settings } = useAppTheme()
  const nav = useAppNav()

  const [mode, setMode] = useState<ExploreMode>("recommended")
  const [kind, setKind] = useState<FeedKind>("illustration")

  useEffect(() => {
    if (settings.hideNovels && kind === "novel") {
      setKind("illustration")
    }
  }, [settings.hideNovels, kind])

  const kindChips = useMemo<ChipItem<FeedKind>[]>(() => {
    const list: ChipItem<FeedKind>[] = [
      { value: "illustration", label: "插画" },
      { value: "manga", label: "漫画" },
    ]
    if (!settings.hideNovels) {
      list.push({ value: "novel", label: "小说" })
    }
    return list
  }, [settings.hideNovels])

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="探索"
        right={
          mode === "pixivision" ? (
            <HeaderIconButton
              label="♥ 收藏"
              onPress={() => nav.push({ name: "library", initialKind: "pixivision" })}
            />
          ) : undefined
        }
        bottom={
          <View style={styles.controls}>
            <ChipBar items={MODE_CHIPS} selected={mode} onSelect={setMode} />
            {mode !== "pixivision" ? (
              <ChipBar items={kindChips} selected={kind} onSelect={setKind} compact={true} />
            ) : null}
          </View>
        }
      />

      <View style={styles.body}>
        {mode === "pixivision" ? (
          <DiscoveryPixivisionFeed />
        ) : kind === "novel" ? (
          <DiscoveryNovelFeed mode={mode} />
        ) : (
          <DiscoveryIllustFeed
            mode={mode}
            kind={kind}
            heroFirst={settings.heroFirstFeedCard}
          />
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
