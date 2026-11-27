import React, { useCallback } from "react"
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  nextNotifications,
  notifications,
  notificationViewMore,
  type PixivNotification,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { ScriptingSafari } from "../../../scripting/hostGlobals"
import {
  EmptyView,
  ErrorView,
  InlineFooterLoader,
  LoadingView,
  PixAvatar,
  PixImage,
  ScreenHeader,
  usePixivFeed,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { parseRouteString } from "../../navigation/routeParser"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

function formatNotificationTime(raw: string): string {
  if (!raw) return ""
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return raw
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return "刚刚"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function NotificationsScreen({
  moreNotificationID,
}: {
  moreNotificationID?: number
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()

  const feed = usePixivFeed<PixivNotification>({
    fetcher: useCallback(
      (token: string) =>
        moreNotificationID
          ? notificationViewMore(moreNotificationID, token)
          : notifications(token),
      [moreNotificationID],
    ),
    fetchMore: nextNotifications,
    keyOf: (item) => item.id,
    deps: [moreNotificationID ?? 0],
  })

  function handleOpenNotification(item: PixivNotification) {
    const url = (item.target_url || "").trim()
    if (!url) return
    const parsed = parseRouteString(url)
    if (parsed.name !== "notFound") {
      nav.push(parsed)
      return
    }
    if (/^https?:\/\//i.test(url)) {
      void ScriptingSafari.openURL(url)
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={moreNotificationID ? "更多通知" : "我的通知"}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
      />

      {feed.loading && feed.items.length === 0 ? (
        <LoadingView message="正在加载通知…" />
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
      ) : (
        <FlashList
          data={feed.items}
          estimatedItemSize={88}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingTop: 8,
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
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <EmptyView title="暂无通知" subtitle="收藏、关注、评论或作品互动消息将显示在此处。" />
          }
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
          renderItem={({ item }) => {
            const leftImg = item.content?.left_image || item.content?.left_icon
            const rightImg = item.content?.right_image || item.content?.right_icon
            return (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <Pressable
                  onPress={() => handleOpenNotification(item)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.avatarWrap}>
                    <PixAvatar url={leftImg} name="N" size={42} />
                    {!item.is_read ? (
                      <View style={[styles.unreadDot, { backgroundColor: accent }]} />
                    ) : null}
                  </View>

                  <View style={styles.body}>
                    <Text style={[styles.text, { color: colors.text }]} numberOfLines={3}>
                      {item.content?.text || "收到一条新通知"}
                    </Text>
                    <Text style={[styles.time, { color: colors.textTertiary }]}>
                      {formatNotificationTime(item.created_datetime)}
                    </Text>
                  </View>

                  {rightImg ? (
                    <PixImage
                      url={rightImg}
                      borderRadius={8}
                      style={styles.rightThumb}
                    />
                  ) : null}
                </Pressable>

                {item.view_more ? (
                  <Pressable
                    onPress={() => nav.push({ name: "notificationsMore", id: item.id })}
                    style={[
                      styles.moreBtn,
                      {
                        borderTopColor: colors.separator,
                        backgroundColor: item.view_more.unread_exists ? accentSoft : "transparent",
                      },
                    ]}
                  >
                    <Text style={[styles.moreBtnText, { color: accent }]} numberOfLines={1}>
                      {item.view_more.title || "查看更多相关通知"} ›
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  card: {
    marginHorizontal: 12,
    marginVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  avatarWrap: {
    position: "relative",
  },
  unreadDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  time: {
    fontSize: 11,
  },
  rightThumb: {
    width: 52,
    height: 52,
  },
  moreBtn: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: "center",
  },
  moreBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
})
