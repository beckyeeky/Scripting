import React, { memo, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { addNovelBookmark, removeNovelBookmark } from "../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { novelThumbUrlOf } from "../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedNovelBookmark,
  onNovelBookmarkChanged,
} from "../../../../../Pix-Scripting/src/store/bookmarkSync"
import type { PixivNovel } from "../../../../../Pix-Scripting/src/types"
import { useOverlay } from "../overlay/OverlayHost"
import { useAppTheme } from "../theme/ThemeProvider"
import { PixImage } from "./PixImage"

export function formatWordCount(len?: number): string {
  if (!len || len <= 0) return ""
  if (len >= 10000) return `${(len / 10000).toFixed(1)}万字`
  return `${len.toLocaleString()}字`
}

export interface NovelCardProps {
  novel: PixivNovel
  rankNumber?: number
  markerPage?: number | null
  badgeText?: string | null
  onPress: (novel: PixivNovel) => void
  onPressAuthor?: (userId: number) => void
  onPressSeries?: (seriesId: number) => void
}

export const NovelCard = memo(function NovelCard({
  novel,
  rankNumber,
  markerPage,
  badgeText,
  onPress,
  onPressAuthor,
  onPressSeries,
}: NovelCardProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const overlay = useOverlay()

  const [bookmarked, setBookmarked] = useState<boolean>(() => {
    const cached = getCachedNovelBookmark(novel.id)
    return cached !== undefined ? cached : Boolean(novel.is_bookmarked)
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const cached = getCachedNovelBookmark(novel.id)
    setBookmarked(cached !== undefined ? cached : Boolean(novel.is_bookmarked))
    return onNovelBookmarkChanged((changedId, nextState) => {
      if (changedId === novel.id) setBookmarked(nextState)
    })
  }, [novel.id, novel.is_bookmarked])

  const coverUrl = novelThumbUrlOf(novel)
  const wordStr = formatWordCount(novel.text_length)
  const isR18 = novel.x_restrict === 1
  const isR18G = novel.x_restrict === 2
  const isAI = novel.novel_ai_type === 2

  async function handleToggleBookmark() {
    if (busy) return
    const next = !bookmarked
    setBookmarked(next)
    setBusy(true)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      await session.call((token) =>
        next
          ? addNovelBookmark(novel.id, "public", token, [])
          : removeNovelBookmark(novel.id, token),
      )
    } catch (e: any) {
      setBookmarked(!next)
      overlay.showToast(e?.message ?? "小说收藏失败", "error")
    } finally {
      setBusy(false)
    }
  }

  function handleLongPress() {
    try {
      triggerHaptic("medium")
    } catch {}
    void overlay.presentActionSheet({
      title: novel.title,
      message: novel.user?.name ? `作者：${novel.user.name}` : undefined,
      actions: [
        {
          label: bookmarked ? "编辑收藏标签 / 取消收藏" : "收藏并设置标签",
          onPress: () => overlay.openBookmarkDetail("novel", novel.id),
        },
        ...(novel.series?.id
          ? [
              {
                label: `查看系列：${novel.series.title || "小说系列"}`,
                onPress: () => onPressSeries?.(novel.series!.id),
              },
            ]
          : []),
        ...(novel.user?.id
          ? [
              {
                label: `查看作者：${novel.user.name}`,
                onPress: () => onPressAuthor?.(novel.user.id),
              },
            ]
          : []),
        {
          label: "屏蔽此作者或标签",
          destructive: true,
          onPress: () =>
            overlay.openBlockWork({
              user: novel.user
                ? {
                    id: novel.user.id,
                    name: novel.user.name,
                    account: novel.user.account,
                    avatarURL: novel.user.profile_image_urls?.medium,
                  }
                : null,
              tags: (novel.tags ?? []).map((t) => t.name),
            }),
        },
      ],
    })
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(novel)}
      onLongPress={handleLongPress}
      delayLongPress={360}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      <View style={styles.coverWrap}>
        <PixImage
          url={coverUrl}
          priority={150}
          resizeMode="cover"
          borderRadius={8}
          style={styles.cover}
        />
        {rankNumber != null ? (
          <View style={styles.rankBadge}>
            <Text style={styles.rankText}>#{rankNumber}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {novel.title || "无题小说"}
          </Text>
          <Pressable
            onPress={(evt) => {
              evt.stopPropagation?.()
              void handleToggleBookmark()
            }}
            onLongPress={(evt) => {
              evt.stopPropagation?.()
              overlay.openBookmarkDetail("novel", novel.id)
            }}
            hitSlop={8}
            style={styles.heartBtn}
          >
            <Text
              style={[
                styles.heartGlyph,
                { color: bookmarked ? colors.pink : colors.textTertiary },
              ]}
            >
              {bookmarked ? "♥" : "♡"}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.metaLine, { color: colors.textSecondary }]} numberOfLines={1}>
          {novel.user?.name || ""}
          {wordStr ? ` · ${wordStr}` : ""}
          {novel.total_bookmarks > 0 ? ` · ♥ ${novel.total_bookmarks}` : ""}
        </Text>

        <View style={styles.pillRow}>
          {novel.series?.title ? (
            <View style={[styles.pill, { backgroundColor: accentSoft }]}>
              <Text style={[styles.pillText, { color: accent }]} numberOfLines={1}>
                系列：{novel.series.title}
              </Text>
            </View>
          ) : null}
          {markerPage != null && markerPage > 0 ? (
            <View style={[styles.pill, { backgroundColor: `${colors.orange}24` }]}>
              <Text style={[styles.pillText, { color: colors.orange }]}>书签 第{markerPage}页</Text>
            </View>
          ) : null}
          {badgeText ? (
            <View style={[styles.pill, { backgroundColor: `${colors.green}22` }]}>
              <Text style={[styles.pillText, { color: colors.green }]}>{badgeText}</Text>
            </View>
          ) : null}
          {isR18 || isR18G ? (
            <View style={[styles.pill, { backgroundColor: `${colors.danger}22` }]}>
              <Text style={[styles.pillText, { color: colors.danger }]}>
                {isR18G ? "R-18G" : "R-18"}
              </Text>
            </View>
          ) : null}
          {isAI ? (
            <View style={[styles.pill, { backgroundColor: `${colors.purple}22` }]}>
              <Text style={[styles.pillText, { color: colors.purple }]}>AI</Text>
            </View>
          ) : null}
        </View>

        {novel.tags && novel.tags.length > 0 ? (
          <Text style={[styles.tagsLine, { color: colors.textTertiary }]} numberOfLines={1}>
            {novel.tags
              .slice(0, 5)
              .map((t) => `#${t.translated_name || t.name}`)
              .join("  ")}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  coverWrap: {
    width: 72,
    height: 102,
  },
  cover: {
    width: 72,
    height: 102,
  },
  rankBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  rankText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    justifyContent: "space-between",
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  heartBtn: {
    padding: 2,
  },
  heartGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  metaLine: {
    fontSize: 12,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 180,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  tagsLine: {
    fontSize: 11,
  },
})
