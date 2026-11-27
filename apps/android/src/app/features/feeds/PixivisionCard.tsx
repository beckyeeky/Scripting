import React, { memo, useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  isPixivisionBookmarked,
  onPixivisionBookmarksChanged,
  togglePixivisionBookmark,
} from "../../../../../../Pix-Scripting/src/store/pixivisionBookmarks"
import type { PixivisionArticle } from "../../../../../../Pix-Scripting/src/types"
import { PixImage } from "../../components/PixImage"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"

export interface PixivisionCardProps {
  article: PixivisionArticle
  onPress?: (article: PixivisionArticle) => void
}

export const PixivisionCard = memo(function PixivisionCard({
  article,
  onPress,
}: PixivisionCardProps) {
  const { colors, accent } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [bookmarked, setBookmarked] = useState<boolean>(() =>
    isPixivisionBookmarked(article.id),
  )

  useEffect(() => {
    setBookmarked(isPixivisionBookmarked(article.id))
    return onPixivisionBookmarksChanged(() => {
      setBookmarked(isPixivisionBookmarked(article.id))
    })
  }, [article.id])

  function handleOpen() {
    if (onPress) {
      onPress(article)
    } else {
      nav.push({ name: "pixivision", id: article.id, seed: article })
    }
  }

  function handleToggleBookmark() {
    try {
      triggerHaptic("selection")
    } catch {}
    const next = togglePixivisionBookmark({
      id: article.id,
      title: article.title,
      thumbnailURL: article.thumbURL || article.imageURL,
      category: article.category,
      categoryLabel: article.category,
      publishedAt: article.date,
      tags: article.tags?.map((t) => t.name).filter(Boolean),
      bookmarkedAt: Date.now(),
    })
    setBookmarked(next)
    overlay.showToast(next ? "已收藏特辑" : "已取消收藏特辑", "info")
  }

  const coverUrl = article.imageURL || article.thumbURL || null
  const previewUrl = article.thumbURL && article.thumbURL !== coverUrl ? article.thumbURL : null

  return (
    <Pressable
      onPress={handleOpen}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.glassBorder,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.coverWrap}>
        <PixImage
          url={coverUrl}
          previewUrl={previewUrl}
          resizeMode="cover"
          style={styles.coverImage}
          showSpinner={false}
        />

        {article.category ? (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText} numberOfLines={1}>
              {article.category}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? "取消收藏特辑" : "收藏特辑"}
          onPress={handleToggleBookmark}
          hitSlop={8}
          style={[
            styles.bookmarkBtn,
            { backgroundColor: bookmarked ? colors.pink : "rgba(0,0,0,0.48)" },
          ]}
        >
          <Text style={styles.bookmarkIcon}>{bookmarked ? "♥" : "♡"}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {article.title}
        </Text>

        <View style={styles.metaRow}>
          {article.date ? (
            <Text style={[styles.date, { color: colors.textTertiary }]} numberOfLines={1}>
              {article.date}
            </Text>
          ) : null}
          {Array.isArray(article.tags) && article.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {article.tags.slice(0, 3).map((tag, idx) => (
                <Pressable
                  key={`${tag.id ?? tag.name}-${idx}`}
                  onPress={() => {
                    const key = tag.id ? `${tag.id}?name=${encodeURIComponent(tag.name)}` : tag.name
                    nav.push({ name: "tagFeed", tag: key, kind: "pixivision" })
                  }}
                  style={[styles.tagPill, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.tagText, { color: accent }]} numberOfLines={1}>
                    #{tag.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  coverWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    position: "relative",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  categoryBadge: {
    position: "absolute",
    left: 10,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.56)",
  },
  categoryText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  bookmarkBtn: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  bookmarkIcon: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  body: {
    padding: 12,
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  date: {
    fontSize: 12,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    flexWrap: "wrap",
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "600",
  },
})
