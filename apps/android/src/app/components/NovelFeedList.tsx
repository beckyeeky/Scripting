import React, { useCallback } from "react"
import { RefreshControl, StyleSheet, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import { cacheNovel } from "../../../../../Pix-Scripting/src/store/novelCache"
import type { PixivNovel } from "../../../../../Pix-Scripting/src/types"
import { useAppNav } from "../navigation/NavContext"
import { useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import { NovelCard } from "./NovelCard"
import { EmptyView, ErrorView, InlineFooterLoader, LoadingView } from "./StateViews"

export interface NovelFeedListProps {
  items: PixivNovel[]
  loading?: boolean
  refreshing?: boolean
  loadingMore?: boolean
  error?: string | null
  loadMoreError?: string | null
  hasMore?: boolean
  showRankNumbers?: boolean
  emptyTitle?: string
  emptySubtitle?: string
  bottomPadding?: number
  onRefresh?: () => void
  onLoadMore?: () => void
  onPressItem?: (novel: PixivNovel) => void
  ListHeaderComponent?: React.ReactElement | null
}

export function NovelFeedList({
  items,
  loading = false,
  refreshing = false,
  loadingMore = false,
  error = null,
  loadMoreError = null,
  hasMore = false,
  showRankNumbers = false,
  emptyTitle = "暂无小说",
  emptySubtitle,
  bottomPadding,
  onRefresh,
  onLoadMore,
  onPressItem,
  ListHeaderComponent,
}: NovelFeedListProps) {
  const { accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()

  const handlePress = useCallback(
    (novel: PixivNovel) => {
      cacheNovel(novel)
      if (onPressItem) {
        onPressItem(novel)
      } else {
        nav.push({ name: "novel", id: novel.id, seed: novel })
      }
    },
    [nav, onPressItem],
  )

  const handlePressAuthor = useCallback(
    (userId: number) => nav.push({ name: "user", id: userId }),
    [nav],
  )

  const handlePressSeries = useCallback(
    (seriesId: number) => nav.push({ name: "series", kind: "novel", id: seriesId }),
    [nav],
  )

  if (loading && items.length === 0) {
    return (
      <View style={styles.flex}>
        {ListHeaderComponent}
        <LoadingView />
      </View>
    )
  }

  if (error && items.length === 0) {
    return (
      <View style={styles.flex}>
        {ListHeaderComponent}
        <ErrorView message={error} onRetry={onRefresh} />
      </View>
    )
  }

  const effectiveBottomPad = bottomPadding ?? Math.max(insets.bottom, 16) + 72

  return (
    <View style={styles.flex}>
      <FlashList
        data={items}
        estimatedItemSize={132}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: effectiveBottomPad,
        }}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={accent}
              colors={[accent]}
            />
          ) : undefined
        }
        onEndReached={() => {
          if (hasMore && !loadingMore && !loading && onLoadMore) {
            onLoadMore()
          }
        }}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={
          !loading ? <EmptyView title={emptyTitle} subtitle={emptySubtitle} /> : null
        }
        ListFooterComponent={
          items.length > 0 ? (
            <InlineFooterLoader
              loading={loadingMore}
              hasMore={hasMore}
              error={loadMoreError}
              onLoadMore={onLoadMore}
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <NovelCard
            novel={item}
            rankNumber={showRankNumbers ? index + 1 : undefined}
            markerPage={item.novel_marker?.page ?? null}
            onPress={handlePress}
            onPressAuthor={handlePressAuthor}
            onPressSeries={handlePressSeries}
          />
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
})
