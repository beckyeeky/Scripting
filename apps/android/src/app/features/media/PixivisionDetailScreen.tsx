import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { pixivisionDetail } from "../../../../../../Pix-Scripting/src/api/pixivision"
import {
  downloadAllPixivisionImagesToAlbum,
  exportPixivisionToEpub,
} from "../../../../../../Pix-Scripting/src/downloader/pixivisionExporter"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import { cacheIllust } from "../../../../../../Pix-Scripting/src/store/illustCache"
import {
  isPixivisionBookmarked,
  onPixivisionBookmarksChanged,
  togglePixivisionBookmark,
} from "../../../../../../Pix-Scripting/src/store/pixivisionBookmarks"
import { getCachedPixivisionDetail } from "../../../../../../Pix-Scripting/src/store/pixivisionCache"
import type {
  PixivIllustration,
  PixivisionArticle,
  PixivisionArtwork,
  PixivisionBodyBlock,
  PixivisionDetail,
} from "../../../../../../Pix-Scripting/src/types"
import {
  clampedAspectRatio,
  ErrorView,
  HeaderIconButton,
  LoadingView,
  PixAvatar,
  PixImage,
  ScreenHeader,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import type { CustomGalleryImage } from "../../navigation/types"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { copyToClipboard, openExternalUrl, shareItems } from "./mediaHelpers"

function buildArtworkSeed(artwork: PixivisionArtwork): PixivIllustration {
  return {
    id: artwork.id,
    title: artwork.title || `作品 #${artwork.id}`,
    type: "illust",
    image_urls: {
      large: artwork.imageURL,
      medium: artwork.thumbURL || artwork.imageURL,
      square_medium: artwork.thumbURL || artwork.imageURL,
    },
    extra_preview_url: artwork.imageURL,
    caption: artwork.comment || "",
    user: {
      id: artwork.authorID || 0,
      name: artwork.authorName || "",
      account: "",
    },
    tags: [],
    create_date: "",
    page_count: 1,
    width: artwork.width || 800,
    height: artwork.height || 800,
    x_restrict: 0,
    meta_pages: [],
    total_view: 0,
    total_bookmarks: 0,
    is_bookmarked: false,
    is_muted: false,
    illust_ai_type: 1,
    total_comments: 0,
    comment_access_control: 0,
  }
}

export function PixivisionDetailScreen({
  articleID,
  seed,
}: {
  articleID: number
  seed?: PixivisionArticle
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [detail, setDetail] = useState<PixivisionDetail | null>(() =>
    getCachedPixivisionDetail(articleID),
  )
  const [loading, setLoading] = useState<boolean>(() => !getCachedPixivisionDetail(articleID))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState<boolean>(() => isPixivisionBookmarked(articleID))
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const loadArticle = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true)
      else if (!detail) setLoading(true)
      setError(null)
      try {
        const fetched = await pixivisionDetail(articleID)
        setDetail(fetched)
      } catch (err: any) {
        if (!detail) setError(err?.message ?? "加载特辑失败")
        else overlay.showToast(err?.message ?? "刷新特辑失败", "error")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [articleID, detail, overlay],
  )

  useEffect(() => {
    let active = true
    const cached = getCachedPixivisionDetail(articleID)
    if (cached) {
      setDetail(cached)
      setLoading(false)
    } else {
      setDetail(null)
      setLoading(true)
    }
    setError(null)
    void pixivisionDetail(articleID)
      .then((res) => {
        if (!active) return
        setDetail(res)
        setError(null)
      })
      .catch((err: any) => {
        if (!active) return
        if (!cached) setError(err?.message ?? "加载特辑失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [articleID])

  useEffect(() => {
    setBookmarked(isPixivisionBookmarked(articleID))
    return onPixivisionBookmarksChanged(() => {
      setBookmarked(isPixivisionBookmarked(articleID))
    })
  }, [articleID])

  // Collect all inline images into a single gallery array for seamless zooming
  const galleryImages = useMemo<CustomGalleryImage[]>(() => {
    if (!detail) return []
    const list: CustomGalleryImage[] = []
    const seen = new Set<string>()
    const add = (url?: string, previewUrl?: string, title?: string) => {
      if (!url || seen.has(url)) return
      seen.add(url)
      list.push({ url, previewUrl, title })
    }
    if (detail.thumbnailURL) add(detail.thumbnailURL, undefined, detail.title)
    for (const block of detail.blocks ?? []) {
      if (block.type === "image") {
        add(block.src, block.thumbURL, block.caption || detail.title)
      } else if (block.type === "illust") {
        add(block.artwork.imageURL, block.artwork.thumbURL, block.artwork.title)
        for (const draft of block.artwork.draftImages ?? []) {
          add(draft.imageURL, draft.thumbURL, draft.caption || block.artwork.title)
        }
      }
    }
    for (const art of detail.artworks ?? []) {
      add(art.imageURL, art.thumbURL, art.title)
    }
    return list
  }, [detail])

  const openGalleryAtUrl = useCallback(
    (targetUrl: string, fallbackTitle?: string) => {
      const idx = galleryImages.findIndex((g) => g.url === targetUrl)
      if (idx >= 0) {
        nav.push({ name: "illustGallery", customImages: galleryImages, initialPage: idx })
      } else {
        nav.push({
          name: "illustGallery",
          customImages: [{ url: targetUrl, title: fallbackTitle }],
          initialPage: 0,
        })
      }
    },
    [galleryImages, nav],
  )

  const openArtwork = useCallback(
    (artwork: PixivisionArtwork) => {
      const seedIllust = buildArtworkSeed(artwork)
      cacheIllust(seedIllust)
      nav.push({ name: "illust", id: artwork.id, seed: seedIllust })
    },
    [nav],
  )

  const handleToggleBookmark = useCallback(() => {
    try {
      triggerHaptic("selection")
    } catch {}
    const next = togglePixivisionBookmark({
      id: articleID,
      title: detail?.title || seed?.title || `特辑 #${articleID}`,
      thumbnailURL: detail?.thumbnailURL || seed?.imageURL,
      category: detail?.categorySlug || seed?.category,
      categoryLabel: detail?.category || seed?.category,
      publishedAt: detail?.date || seed?.date,
      tags: (detail?.tags ?? []).map((t) => t.name),
      bookmarkedAt: Date.now(),
    })
    setBookmarked(next)
    overlay.showToast(next ? "已收藏该特辑" : "已取消收藏特辑", "success")
  }, [articleID, detail, overlay, seed])

  const openExportSheet = useCallback(async () => {
    if (!detail || exportStatus) return
    const webUrl = `https://www.pixivision.net/zh/a/${detail.id}`
    const artCount = detail.artworks?.length ?? 0
    const choice = await overlay.presentActionSheet({
      title: "特辑导出与分享",
      message: detail.title,
      actions: [
        { label: `下载全部特辑插画至相册 (${artCount} 张)`, disabled: artCount === 0 },
        { label: "导出特辑 EPUB 画报至文件" },
        { label: "分享特辑链接" },
        { label: "复制特辑链接" },
        { label: "在浏览器打开" },
      ],
    })
    if (choice == null) return

    if (choice === 0) {
      setExportStatus("正在下载特辑插画…")
      try {
        const res = await downloadAllPixivisionImagesToAlbum(detail, (_c, _t, msg) =>
          setExportStatus(msg),
        )
        overlay.showToast(
          res.success ? `已保存 ${res.downloaded}/${res.total} 张特辑插画` : "下载未完成",
          res.success ? "success" : "error",
        )
      } catch (err: any) {
        overlay.showToast(err?.message ?? "批量下载失败", "error")
      } finally {
        setExportStatus(null)
      }
    } else if (choice === 1) {
      setExportStatus("正在生成特辑 EPUB…")
      try {
        const res = await exportPixivisionToEpub(detail, (_c, _t, msg) => setExportStatus(msg))
        overlay.showToast(
          res.success ? "特辑 EPUB 已保存至下载目录" : res.error || "EPUB 导出失败",
          res.success ? "success" : "error",
        )
      } catch (err: any) {
        overlay.showToast(err?.message ?? "EPUB 导出失败", "error")
      } finally {
        setExportStatus(null)
      }
    } else if (choice === 2) {
      await shareItems([webUrl])
    } else if (choice === 3) {
      await copyToClipboard(webUrl)
      overlay.showToast("链接已复制", "success")
    } else if (choice === 4) {
      await openExternalUrl(webUrl)
    }
  }, [detail, exportStatus, overlay])

  const renderArtworkCard = (artwork: PixivisionArtwork, key: string) => {
    const ratio = clampedAspectRatio(artwork.width, artwork.height, 0.5, 2.0, 0.9)
    return (
      <View
        key={key}
        style={[
          styles.artworkCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        <Pressable onPress={() => openArtwork(artwork)}>
          <PixImage
            url={artwork.imageURL}
            previewUrl={artwork.thumbURL}
            resizeMode="contain"
            showRetry={true}
            showSpinner={true}
            style={{ width: "100%", aspectRatio: ratio }}
          />
        </Pressable>

        <View style={styles.artworkMeta}>
          <Pressable onPress={() => openArtwork(artwork)} style={styles.flex}>
            <Text style={[styles.artworkTitle, { color: colors.text }]} numberOfLines={2}>
              {artwork.title || `作品 #${artwork.id}`}
            </Text>
          </Pressable>

          {artwork.authorName ? (
            <Pressable
              onPress={() => {
                if (artwork.authorID) nav.push({ name: "user", id: artwork.authorID })
              }}
              disabled={!artwork.authorID}
            >
              <Text style={[styles.artworkAuthor, { color: accent }]} numberOfLines={1}>
                by {artwork.authorName}
              </Text>
            </Pressable>
          ) : null}

          {artwork.comment ? (
            <Text style={[styles.artworkComment, { color: colors.textSecondary }]}>
              {artwork.comment}
            </Text>
          ) : null}

          {artwork.draftImages && artwork.draftImages.length > 0 ? (
            <View style={styles.draftRow}>
              {artwork.draftImages.map((draft, dIdx) => (
                <Pressable
                  key={dIdx}
                  onPress={() => openGalleryAtUrl(draft.imageURL, draft.caption || artwork.title)}
                  style={styles.draftThumb}
                >
                  <PixImage
                    url={draft.thumbURL || draft.imageURL}
                    borderRadius={8}
                    style={styles.draftImg}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    )
  }

  const renderBlock = (block: PixivisionBodyBlock, idx: number) => {
    const key = `blk-${idx}-${block.type}`
    switch (block.type) {
      case "heading":
        return (
          <Text
            key={key}
            style={[
              styles.heading,
              {
                color: colors.text,
                fontSize: block.level <= 2 ? 19 : 16,
              },
            ]}
          >
            {block.title}
          </Text>
        )
      case "subheading":
        return (
          <Text key={key} style={[styles.subheading, { color: accent }]}>
            {block.title}
          </Text>
        )
      case "paragraph":
        return (
          <Text key={key} selectable={true} style={[styles.paragraph, { color: colors.text }]}>
            {block.text}
          </Text>
        )
      case "quote":
        return (
          <View
            key={key}
            style={[
              styles.quoteBox,
              { backgroundColor: colors.fill, borderLeftColor: accent },
            ]}
          >
            <Text style={[styles.quoteText, { color: colors.text }]}>{block.text}</Text>
            {block.source ? (
              <Text style={[styles.quoteSource, { color: colors.textSecondary }]}>
                — {block.source}
              </Text>
            ) : null}
          </View>
        )
      case "comment":
        return (
          <View
            key={key}
            style={[
              styles.commentBox,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.paragraph, { color: colors.textSecondary }]}>{block.text}</Text>
          </View>
        )
      case "caption":
      case "credit":
        return (
          <Text key={key} style={[styles.captionNote, { color: colors.textTertiary }]}>
            {block.text}
          </Text>
        )
      case "illust":
        return renderArtworkCard(block.artwork, key)
      case "image": {
        const ratio = clampedAspectRatio(block.width, block.height, 0.5, 2.2, 1.35)
        return (
          <View key={key} style={styles.imageBlock}>
            <Pressable
              onPress={() => openGalleryAtUrl(block.src, block.caption || detail?.title)}
            >
              <PixImage
                url={block.src}
                previewUrl={block.thumbURL}
                resizeMode="contain"
                borderRadius={12}
                showRetry={true}
                style={{ width: "100%", aspectRatio: ratio }}
              />
            </Pressable>
            {block.caption ? (
              <Text style={[styles.captionNote, { color: colors.textSecondary }]}>
                {block.caption}
              </Text>
            ) : null}
          </View>
        )
      }
      case "article_card":
        return (
          <Pressable
            key={key}
            onPress={() =>
              nav.push({ name: "pixivision", id: block.article.id, seed: block.article })
            }
            style={[
              styles.articleEmbedCard,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <PixImage
              url={block.article.thumbURL || block.article.imageURL}
              borderRadius={10}
              style={styles.articleEmbedThumb}
            />
            <View style={styles.flex}>
              <Text style={[styles.articleEmbedCat, { color: accent }]}>
                {block.article.category || "Pixivision"}
              </Text>
              <Text style={[styles.articleEmbedTitle, { color: colors.text }]} numberOfLines={2}>
                {block.article.title}
              </Text>
              {block.article.date ? (
                <Text style={[styles.articleEmbedDate, { color: colors.textTertiary }]}>
                  {block.article.date}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )
      case "profile":
        return (
          <View
            key={key}
            style={[
              styles.profileBlock,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <Pressable
              disabled={!block.profile.userId}
              onPress={() => {
                if (block.profile.userId) nav.push({ name: "user", id: block.profile.userId })
              }}
              style={styles.profileBlockHead}
            >
              <PixAvatar url={block.profile.avatarURL} name={block.profile.name} size={42} />
              <Text style={[styles.profileBlockName, { color: colors.text }]}>
                {block.profile.name}
              </Text>
            </Pressable>
            {block.profile.description ? (
              <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
                {block.profile.description}
              </Text>
            ) : null}
            {block.profile.links && block.profile.links.length > 0 ? (
              <View style={styles.tagsWrap}>
                {block.profile.links.map((lk, lIdx) => (
                  <Pressable
                    key={lIdx}
                    onPress={() => void openExternalUrl(lk.url)}
                    style={[styles.tagChip, { backgroundColor: accentSoft }]}
                  >
                    <Text style={[styles.tagText, { color: accent }]}>{lk.title || lk.url}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        )
      case "qa":
        return (
          <View
            key={key}
            style={[
              styles.qaBox,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.qaQuestion, { color: accent }]}>Q. {block.question}</Text>
            <View style={styles.qaAnswerRow}>
              {block.answerAvatarURL ? (
                <PixAvatar url={block.answerAvatarURL} name="A" size={28} />
              ) : null}
              <Text style={[styles.paragraph, styles.flex, { color: colors.text }]}>
                {block.answer}
              </Text>
            </View>
          </View>
        )
      case "movie":
        return (
          <Pressable
            key={key}
            onPress={() => void openExternalUrl(block.videoURL)}
            style={[
              styles.movieCard,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.movieTitle, { color: accent }]}>▶ 打开内嵌视频</Text>
            <Text style={[styles.movieUrl, { color: colors.textSecondary }]} numberOfLines={1}>
              {block.videoURL}
            </Text>
          </Pressable>
        )
      default:
        return null
    }
  }

  const title = detail?.title || seed?.title || "Pixivision 特辑"
  const coverUrl = detail?.thumbnailURL || seed?.imageURL
  const hasBlocks = Boolean(detail?.blocks && detail.blocks.length > 0)

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={title}
        subtitle={detail?.category || seed?.category}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          <>
            <HeaderIconButton
              label={bookmarked ? "♥" : "♡"}
              color={bookmarked ? colors.pink : colors.text}
              onPress={handleToggleBookmark}
            />
            {detail ? (
              <HeaderIconButton label="导出" onPress={() => void openExportSheet()} />
            ) : null}
          </>
        }
      />

      {loading && !detail ? (
        <LoadingView message="正在加载特辑内容…" />
      ) : error && !detail ? (
        <ErrorView message={error} onRetry={() => void loadArticle(false)} />
      ) : detail ? (
        <ScrollView
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: effectiveBottomInset(insets) + 36 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadArticle(true)}
              tintColor={accent}
              colors={[accent]}
            />
          }
        >
          {exportStatus ? (
            <View style={[styles.statusBanner, { backgroundColor: accentSoft }]}>
              <ActivityIndicator size="small" color={accent} />
              <Text style={[styles.statusText, { color: accent }]} numberOfLines={1}>
                {exportStatus}
              </Text>
            </View>
          ) : null}

          {/* Cover */}
          {coverUrl ? (
            <Pressable onPress={() => openGalleryAtUrl(coverUrl, detail.title)}>
              <PixImage
                url={coverUrl}
                resizeMode="cover"
                borderRadius={14}
                style={styles.coverImage}
              />
            </Pressable>
          ) : null}

          {/* Title & metadata */}
          <View style={styles.headerBlock}>
            <View style={styles.metaRow}>
              {detail.category ? (
                <View style={[styles.catBadge, { backgroundColor: accentSoft }]}>
                  <Text style={[styles.catBadgeText, { color: accent }]}>{detail.category}</Text>
                </View>
              ) : null}
              {detail.date ? (
                <Text style={[styles.dateText, { color: colors.textTertiary }]}>{detail.date}</Text>
              ) : null}
            </View>

            <Text selectable={true} style={[styles.articleTitle, { color: colors.text }]}>
              {detail.title}
            </Text>

            {detail.lead || detail.description ? (
              <Text style={[styles.leadText, { color: colors.textSecondary }]}>
                {detail.lead || detail.description}
              </Text>
            ) : null}
          </View>

          {/* Tags */}
          {detail.tags && detail.tags.length > 0 ? (
            <View style={styles.tagsWrap}>
              {detail.tags.map((t, i) => (
                <Pressable
                  key={`${t.id ?? t.name}-${i}`}
                  onPress={() =>
                    nav.push({
                      name: "tagFeed",
                      tag: t.id ? `${t.id}?name=${encodeURIComponent(t.name)}` : t.name,
                      kind: "pixivision",
                    })
                  }
                  style={[
                    styles.tagChip,
                    { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                  ]}
                >
                  <Text style={[styles.tagText, { color: accent }]}>#{t.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Body blocks or fallback artworks */}
          {hasBlocks
            ? detail.blocks!.map((b, idx) => renderBlock(b, idx))
            : (detail.artworks ?? []).map((art, idx) =>
                renderArtworkCard(art, `fallback-art-${art.id}-${idx}`),
              )}

          {/* Related sections */}
          {(detail.relatedSections ?? []).map((sec, sIdx) =>
            sec.articles.length > 0 ? (
              <View key={`rel-${sIdx}`} style={styles.relatedSection}>
                <Text style={[styles.relatedSectionTitle, { color: colors.text }]}>
                  {sec.title}
                </Text>
                {sec.articles.map((art) => (
                  <Pressable
                    key={`rel-art-${art.id}`}
                    onPress={() => nav.push({ name: "pixivision", id: art.id, seed: art })}
                    style={[
                      styles.articleEmbedCard,
                      { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                    ]}
                  >
                    <PixImage
                      url={art.thumbURL || art.imageURL}
                      borderRadius={10}
                      style={styles.articleEmbedThumb}
                    />
                    <View style={styles.flex}>
                      <Text style={[styles.articleEmbedCat, { color: accent }]}>
                        {art.category || "Pixivision"}
                      </Text>
                      <Text
                        style={[styles.articleEmbedTitle, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {art.title}
                      </Text>
                      {art.date ? (
                        <Text style={[styles.articleEmbedDate, { color: colors.textTertiary }]}>
                          {art.date}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null,
          )}
        </ScrollView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 14,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  coverImage: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  headerBlock: {
    gap: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  catBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  dateText: {
    fontSize: 12,
  },
  articleTitle: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 28,
  },
  leadText: {
    fontSize: 14,
    lineHeight: 22,
  },
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  heading: {
    fontWeight: "800",
    marginTop: 6,
    lineHeight: 26,
  },
  subheading: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 24,
  },
  quoteBox: {
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 22,
    fontStyle: "italic",
  },
  quoteSource: {
    fontSize: 12,
    textAlign: "right",
  },
  commentBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  captionNote: {
    fontSize: 12,
    lineHeight: 18,
  },
  artworkCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  artworkMeta: {
    padding: 12,
    gap: 6,
  },
  artworkTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  artworkAuthor: {
    fontSize: 13,
    fontWeight: "600",
  },
  artworkComment: {
    fontSize: 13,
    lineHeight: 19,
  },
  draftRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  draftThumb: {
    width: 72,
    height: 72,
  },
  draftImg: {
    width: "100%",
    height: "100%",
  },
  imageBlock: {
    gap: 6,
  },
  articleEmbedCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  articleEmbedThumb: {
    width: 96,
    height: 64,
  },
  articleEmbedCat: {
    fontSize: 11,
    fontWeight: "700",
  },
  articleEmbedTitle: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 2,
  },
  articleEmbedDate: {
    fontSize: 11,
    marginTop: 3,
  },
  profileBlock: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  profileBlockHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  profileBlockName: {
    fontSize: 16,
    fontWeight: "700",
  },
  qaBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  qaQuestion: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  qaAnswerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  movieCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 4,
  },
  movieTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  movieUrl: {
    fontSize: 12,
  },
  relatedSection: {
    marginTop: 8,
    gap: 8,
  },
  relatedSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
})
