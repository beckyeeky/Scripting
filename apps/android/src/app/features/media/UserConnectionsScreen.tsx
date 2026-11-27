import React, { useState } from "react"
import { RefreshControl, StyleSheet, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  myPixivUsers,
  nextUsers,
  userConnections,
  type Visibility,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import type { PixivUserPreview } from "../../../../../../Pix-Scripting/src/types"
import {
  EmptyView,
  ErrorView,
  InlineFooterLoader,
  LoadingView,
  ScreenHeader,
  SegmentedControl,
  usePixivFeed,
  UserPreviewRow,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

export function UserConnectionsScreen({
  kind,
  userId,
  title,
}: {
  kind: "following" | "follower" | "mypixiv"
  userId?: number
  title?: string
}) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()

  const targetUid = userId ?? session.userID ?? 0
  const isSelf = targetUid === session.userID
  const [restrict, setRestrict] = useState<Visibility>("public")

  const feed = usePixivFeed<PixivUserPreview>({
    enabled: targetUid > 0,
    deps: [kind, targetUid, restrict],
    keyOf: (item) => item.user.id,
    fetcher: (token) => {
      if (kind === "mypixiv") {
        return myPixivUsers(targetUid, token)
      }
      return userConnections(targetUid, kind, isSelf && kind === "following" ? restrict : "public", token)
    },
    fetchMore: (url, token) => nextUsers(url, token),
  })

  const defaultTitle =
    kind === "following" ? "关注列表" : kind === "follower" ? "粉丝列表" : "好P友列表"

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={title || defaultTitle}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        bottom={
          isSelf && kind === "following" ? (
            <View style={styles.segWrap}>
              <SegmentedControl
                value={restrict}
                onChange={setRestrict}
                options={[
                  { value: "public", label: "公开关注" },
                  { value: "private", label: "悄悄关注" },
                ]}
              />
            </View>
          ) : undefined
        }
      />

      {feed.loading && feed.items.length === 0 ? (
        <LoadingView />
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
      ) : (
        <FlashList
          data={feed.items}
          estimatedItemSize={156}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => String(item.user.id)}
          contentContainerStyle={{
            paddingTop: 6,
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
            if (feed.hasMore && !feed.loadingMore && !feed.loading) {
              void feed.loadMore()
            }
          }}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<EmptyView title={`暂无${defaultTitle}`} />}
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
          renderItem={({ item }) => <UserPreviewRow preview={item} />}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  segWrap: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
})
