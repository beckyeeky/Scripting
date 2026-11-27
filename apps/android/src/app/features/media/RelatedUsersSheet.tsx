import React, { useCallback } from "react"
import { RefreshControl, StyleSheet, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import { nextUsers, userRelated } from "../../../../../../Pix-Scripting/src/api/pixiv"
import type { PixivUserPreview } from "../../../../../../Pix-Scripting/src/types"
import {
  EmptyView,
  ErrorView,
  InlineFooterLoader,
  LoadingView,
  usePixivFeed,
  UserPreviewRow,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

export interface RelatedUsersSheetProps {
  seedUserID: number
  onClose: () => void
}

export function RelatedUsersSheet({ seedUserID, onClose }: RelatedUsersSheetProps) {
  const { accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()

  const feed = usePixivFeed<PixivUserPreview>({
    fetcher: (token) => userRelated(seedUserID, token),
    fetchMore: (url, token) => nextUsers(url, token),
    keyOf: (item) => item.user.id,
    deps: [seedUserID],
  })

  const handleSelectUser = useCallback(
    (userId: number) => {
      onClose()
      nav.push({ name: "user", id: userId })
    },
    [nav, onClose],
  )

  if (feed.loading && feed.items.length === 0) {
    return (
      <View style={styles.root}>
        <LoadingView message="正在加载相关画师…" />
      </View>
    )
  }

  if (feed.error && feed.items.length === 0) {
    return (
      <View style={styles.root}>
        <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <FlashList
        data={feed.items}
        estimatedItemSize={156}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.user.id)}
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: effectiveBottomInset(insets) + 20,
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
          if (feed.hasMore && !feed.loadingMore && !feed.loading) {
            void feed.loadMore()
          }
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyView title="暂无相关推荐画师" />}
        ListFooterComponent={
          feed.items.length > 0 ? (
            <InlineFooterLoader
              loading={feed.loadingMore}
              hasMore={feed.hasMore}
              error={feed.loadMoreError}
              onLoadMore={() => void feed.loadMore()}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <UserPreviewRow preview={item} onSelectUser={handleSelectUser} />
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 360,
  },
})
