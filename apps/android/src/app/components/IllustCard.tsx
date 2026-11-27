import React, { memo, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { addBookmark, removeBookmark } from "../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { cardThumbUrlOf } from "../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedIllustBookmark,
  onIllustBookmarkChanged,
} from "../../../../../Pix-Scripting/src/store/bookmarkSync"
import type { PixivIllustration } from "../../../../../Pix-Scripting/src/types"
import { useOverlay } from "../overlay/OverlayHost"
import { useAppTheme } from "../theme/ThemeProvider"
import { clampedAspectRatio, PixImage } from "./PixImage"

export const ILLUST_CARD_META_HEIGHT = 48
export const ILLUST_CARD_GAP = 8

export function computeIllustCardHeight(
  illust: Pick<PixivIllustration, "width" | "height">,
  columnWidth: number,
  compact: boolean,
): number {
  const ratio = clampedAspectRatio(illust.width, illust.height, 0.55, 2.0, 0.82)
  const imageHeight = Math.max(96, Math.round(columnWidth / ratio))
  return imageHeight + (compact ? 0 : ILLUST_CARD_META_HEIGHT)
}

export interface IllustCardProps {
  illust: PixivIllustration
  width: number
  compact?: boolean
  rankNumber?: number
  priority?: number
  onPress: (illust: PixivIllustration) => void
  onPressAuthor?: (userId: number) => void
}

export const IllustCard = memo(function IllustCard({
  illust,
  width,
  compact = true,
  rankNumber,
  priority = 200,
  onPress,
  onPressAuthor,
}: IllustCardProps) {
  const { colors, settings } = useAppTheme()
  const overlay = useOverlay()

  const [bookmarked, setBookmarked] = useState<boolean>(() => {
    const cached = getCachedIllustBookmark(illust.id)
    return cached !== undefined ? cached : Boolean(illust.is_bookmarked)
  })
  const [bookmarkBusy, setBookmarkBusy] = useState(false)

  useEffect(() => {
    const cached = getCachedIllustBookmark(illust.id)
    setBookmarked(cached !== undefined ? cached : Boolean(illust.is_bookmarked))
    return onIllustBookmarkChanged((changedId, nextState) => {
      if (changedId === illust.id) {
        setBookmarked(nextState)
      }
    })
  }, [illust.id, illust.is_bookmarked])

  const ratio = clampedAspectRatio(illust.width, illust.height, 0.55, 2.0, 0.82)
  const imageHeight = Math.max(96, Math.round(width / ratio))
  const imageUrl = cardThumbUrlOf(illust)

  async function handleToggleBookmark() {
    if (bookmarkBusy) return
    const next = !bookmarked
    setBookmarked(next)
    setBookmarkBusy(true)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      await session.call((token) =>
        next ? addBookmark(illust.id, "public", [], token) : removeBookmark(illust.id, token),
      )
    } catch (e: any) {
      setBookmarked(!next)
      overlay.showToast(e?.message ?? "收藏操作失败", "error")
    } finally {
      setBookmarkBusy(false)
    }
  }

  function handleLongPressBookmark() {
    try {
      triggerHaptic("medium")
    } catch {}
    if (settings.longPressBookmarkAction === "detail" || settings.longPressBookmarkAction === "off") {
      overlay.openBookmarkDetail("illust", illust.id)
    } else {
      overlay.openBookmarkDetail("illust", illust.id)
    }
  }

  function handleLongPressCard() {
    try {
      triggerHaptic("medium")
    } catch {}
    void overlay.presentActionSheet({
      title: illust.title || `作品 #${illust.id}`,
      message: illust.user?.name ? `画师：${illust.user.name}` : undefined,
      actions: [
        {
          label: bookmarked ? "编辑收藏标签 / 取消收藏" : "收藏并设置标签",
          onPress: () => overlay.openBookmarkDetail("illust", illust.id),
        },
        ...(illust.user?.id
          ? [
              {
                label: `查看画师：${illust.user.name}`,
                onPress: () => onPressAuthor?.(illust.user.id),
              },
            ]
          : []),
        {
          label: "屏蔽此画师或标签",
          destructive: true,
          onPress: () =>
            overlay.openBlockWork({
              user: illust.user
                ? {
                    id: illust.user.id,
                    name: illust.user.name,
                    account: illust.user.account,
                    avatarURL: illust.user.profile_image_urls?.medium,
                  }
                : null,
              tags: (illust.tags ?? []).map((t) => t.name),
            }),
        },
      ],
    })
  }

  const pageCount = Math.max(1, illust.page_count || 1)
  const isUgoira = illust.type === "ugoira"
  const isR18 = illust.x_restrict === 1
  const isR18G = illust.x_restrict === 2
  const isAI = illust.illust_ai_type === 2

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={illust.title || `作品 ${illust.id}`}
      onPress={() => onPress(illust)}
      onLongPress={handleLongPressCard}
      delayLongPress={360}
      style={[
        styles.card,
        {
          width,
          backgroundColor: colors.surface,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      <View style={{ width, height: imageHeight }}>
        <PixImage
          url={imageUrl}
          priority={priority}
          resizeMode="cover"
          style={{ width, height: imageHeight }}
        />

        {/* Top-left rank / R18 / AI badges */}
        <View style={styles.topLeftBadges} pointerEvents="none">
          {rankNumber != null ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    rankNumber === 1
                      ? "rgba(255, 196, 0, 0.92)"
                      : rankNumber === 2
                        ? "rgba(156, 163, 175, 0.92)"
                        : rankNumber === 3
                          ? "rgba(205, 127, 50, 0.92)"
                          : "rgba(0, 0, 0, 0.62)",
                },
              ]}
            >
              <Text style={styles.badgeText}>#{rankNumber}</Text>
            </View>
          ) : null}
          {isR18 || isR18G ? (
            <View style={[styles.badge, { backgroundColor: "rgba(255, 59, 48, 0.88)" }]}>
              <Text style={styles.badgeText}>{isR18G ? "R-18G" : "R-18"}</Text>
            </View>
          ) : null}
          {isAI ? (
            <View style={[styles.badge, { backgroundColor: "rgba(175, 82, 222, 0.86)" }]}>
              <Text style={styles.badgeText}>AI</Text>
            </View>
          ) : null}
        </View>

        {/* Top-right page count / GIF badge */}
        <View style={styles.topRightBadges} pointerEvents="none">
          {isUgoira ? (
            <View style={[styles.badge, { backgroundColor: "rgba(0, 0, 0, 0.68)" }]}>
              <Text style={styles.badgeText}>GIF</Text>
            </View>
          ) : pageCount > 1 ? (
            <View style={[styles.badge, { backgroundColor: "rgba(0, 0, 0, 0.68)" }]}>
              <Text style={styles.badgeText}>{pageCount}P</Text>
            </View>
          ) : null}
        </View>

        {/* Bottom-right quick bookmark heart */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? "取消收藏" : "收藏"}
          onPress={(evt) => {
            evt.stopPropagation?.()
            void handleToggleBookmark()
          }}
          onLongPress={(evt) => {
            evt.stopPropagation?.()
            handleLongPressBookmark()
          }}
          hitSlop={8}
          style={styles.heartBtn}
        >
          <Text style={[styles.heartGlyph, { color: bookmarked ? "#FF375F" : "#FFFFFF" }]}>
            {bookmarked ? "♥" : "♡"}
          </Text>
        </Pressable>
      </View>

      {!compact ? (
        <View style={styles.meta}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {illust.title || "无题"}
          </Text>
          <Text style={[styles.author, { color: colors.textSecondary }]} numberOfLines={1}>
            {illust.user?.name || ""}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  topLeftBadges: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    gap: 4,
  },
  topRightBadges: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    gap: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  heartBtn: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  heartGlyph: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
  meta: {
    height: ILLUST_CARD_META_HEIGHT,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center",
    gap: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
  },
  author: {
    fontSize: 11,
  },
})
