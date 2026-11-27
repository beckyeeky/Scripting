import React, { useCallback, useMemo } from "react"
import {
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native"
import { MasonryFlashList } from "@shopify/flash-list"
import { cacheIllust } from "../../../../../Pix-Scripting/src/store/illustCache"
import { resolveFeedColumnCount } from "../../../../../Pix-Scripting/src/ui/feedColumns"
import type { PixivIllustration } from "../../../../../Pix-Scripting/src/types"
import { useAppNav } from "../navigation/NavContext"
import { useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import { computeIllustCardHeight, ILLUST_CARD_GAP, IllustCard } from "./IllustCard"
import { EmptyView, ErrorView, InlineFooterLoader, LoadingView } from "./StateViews"

const HORIZONTAL_PADDING = 10

export interface IllustMasonryFeedProps {
  items: PixivIllustration[]
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
  onPressItem?: (illust: PixivIllustration) => void
  ListHeaderComponent?: React.ReactElement | null
}

export function IllustMasonryFeed({
  items,
  loading = false,
  refreshing = false,
  loadingMore = false,
  error = null,
  loadMoreError = null,
  hasMore = false,
  showRankNumbers = false,
  emptyTitle = "暂无作品",
  emptySubtitle,
  bottomPadding,
  onRefresh,
  onLoadMore,
  onPressItem,
  ListHeaderComponent,
}: IllustMasonryFeedProps) {
  const { settings, accent, colors } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()

  const isLandscape = windowWidth > windowHeight
  const numColumns = resolveFeedColumnCount(windowWidth, isLandscape, {
    portrait: settings.feedColumnCapPortrait,
    landscape: settings.feedColumnCapLandscape,
  })
  const compact = settings.compactIllustCard

  const usableWidth = Math.max(200, windowWidth - HORIZONTAL_PADDING * 2)
  const columnWidth = Math.floor((usableWidth - ILLUST_CARD_GAP * (numColumns - 1)) / numColumns)

  const handlePress = useCallback(
    (illust: PixivIllustration) => {
      cacheIllust(illust)
      if (onPressItem) {
        onPressItem(illust)
      } else {
        nav.push({ name: "illust", id: illust.id, seed: illust })
      }
    },
    [nav, onPressItem],
  )

  const handlePressAuthor = useCallback(
    (userId: number) => {
      nav.push({ name: "user", id: userId })
    },
    [nav],
  )

  const extraData = useMemo(
    () => ({ columnWidth, compact, showRankNumbers, isDark: colors.bg }),
    [columnWidth, compact, showRankNumbers, colors.bg],
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
      <MasonryFlashList
        key={`masonry-${numColumns}-${compact ? "c" : "f"}`}
        data={items}
        numColumns={numColumns}
        estimatedItemSize={220}
        optimizeItemArrangement={true}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        extraData={extraData}
        contentContainerStyle={{
          paddingHorizontal: HORIZONTAL_PADDING - ILLUST_CARD_GAP / 2,
          paddingTop: 6,
          paddingBottom: effectiveBottomPad,
        }}
        overrideItemLayout={(layout, item) => {
          layout.size = computeIllustCardHeight(item, columnWidth, compact) + ILLUST_CARD_GAP
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
          <View style={styles.cell}>
            <IllustCard
              illust={item}
              width={columnWidth}
              compact={compact}
              rankNumber={showRankNumbers ? index + 1 : undefined}
              priority={Math.min(1000, index * 5)}
              onPress={handlePress}
              onPressAuthor={handlePressAuthor}
            />
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  cell: {
    paddingHorizontal: ILLUST_CARD_GAP / 2,
    paddingBottom: ILLUST_CARD_GAP,
    alignItems: "center",
  },
})
