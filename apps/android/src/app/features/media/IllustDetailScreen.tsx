import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import {
  addBookmark,
  deleteIllust,
  followUser,
  illustrationDetail,
  relatedIllustrations,
  removeBookmark,
  unfollowUser,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { exportMangaToCbz } from "../../../../../../Pix-Scripting/src/downloader/cbzExporter"
import { exportMangaToEpub } from "../../../../../../Pix-Scripting/src/downloader/epubExporter"
import { exportIllustToZip } from "../../../../../../Pix-Scripting/src/downloader/illustZipExporter"
import { downloadIllustToAlbum } from "../../../../../../Pix-Scripting/src/downloader/photoAlbum"
import { exportUgoiraToAlbum, exportUgoiraZip } from "../../../../../../Pix-Scripting/src/downloader/ugoiraExporter"
import {
  imageUrlOf,
  resolveIllustUnderlayUrl,
} from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedIllustBookmark,
  onIllustBookmarkChanged,
  recordIllustBookmark,
} from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import { isIllustContentVisible } from "../../../../../../Pix-Scripting/src/store/contentFilter"
import { recordHistory } from "../../../../../../Pix-Scripting/src/store/history"
import { cacheIllust, getCachedIllust } from "../../../../../../Pix-Scripting/src/store/illustCache"
import { getDetailImageQuality, getDownloadImageQuality } from "../../../../../../Pix-Scripting/src/store/settings"
import {
  getEffectiveFollowState,
  onUserFollowChanged,
  recordUserFollowed,
} from "../../../../../../Pix-Scripting/src/store/userFollow"
import type { PixivIllustration } from "../../../../../../Pix-Scripting/src/types"
import {
  clampedAspectRatio,
  ErrorView,
  HeaderIconButton,
  IllustCard,
  ILLUST_CARD_GAP,
  LoadingView,
  PixAvatar,
  PixImage,
  ScreenHeader,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { IllustAISheet, type IllustAIMode } from "./IllustAISheet"
import {
  copyToClipboard,
  formatMetricCount,
  formatShortDate,
  getIllustDownloadUrls,
  getIllustPageCount,
  handlePixivHref,
  openExternalUrl,
  parseCaptionSegments,
  shareItems,
} from "./mediaHelpers"
import { RelatedUsersSheet } from "./RelatedUsersSheet"
import { UgoiraPlayer } from "./UgoiraPlayer"

const INITIAL_VISIBLE_PAGES = 6

export function IllustDetailScreen({
  illustID,
  seed,
}: {
  illustID: number
  seed?: PixivIllustration
}) {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()
  const { width: windowWidth } = useWindowDimensions()

  const initialIllust = useMemo(() => {
    const found = seed ?? getCachedIllust(illustID) ?? null
    if (found) cacheIllust(found)
    return found
  }, [illustID, seed])

  const [illust, setIllust] = useState<PixivIllustration | null>(initialIllust)
  const [loading, setLoading] = useState<boolean>(!initialIllust)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [bookmarked, setBookmarked] = useState<boolean>(() => {
    const cached = getCachedIllustBookmark(illustID)
    if (cached !== undefined) return cached
    return Boolean(initialIllust?.is_bookmarked)
  })
  const [bookmarkBusy, setBookmarkBusy] = useState(false)

  const [followed, setFollowed] = useState<boolean>(() =>
    initialIllust?.user?.id
      ? getEffectiveFollowState(initialIllust.user.id, Boolean(initialIllust.user.is_followed)).followed
      : false,
  )
  const [followBusy, setFollowBusy] = useState(false)

  const [showAllPages, setShowAllPages] = useState(false)
  const [pageRatios, setPageRatios] = useState<Record<number, number>>({})
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)

  const [related, setRelated] = useState<PixivIllustration[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)

  const detailQuality = getDetailImageQuality()

  const loadDetail = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true)
      else if (!illust) setLoading(true)
      setError(null)
      try {
        const fetched = await session.call((token) => illustrationDetail(illustID, token))
        cacheIllust(fetched)
        setIllust(fetched)
        recordIllustBookmark(fetched.id, Boolean(fetched.is_bookmarked))
        setBookmarked(getCachedIllustBookmark(fetched.id) ?? Boolean(fetched.is_bookmarked))
        if (fetched.user?.id) {
          recordUserFollowed(fetched.user.id, Boolean(fetched.user.is_followed))
          setFollowed(
            getEffectiveFollowState(fetched.user.id, Boolean(fetched.user.is_followed)).followed,
          )
        }
        try {
          recordHistory(fetched)
        } catch {}
      } catch (err: any) {
        if (!illust) setError(err?.message ?? "加载作品详情失败")
        else overlay.showToast(err?.message ?? "刷新详情失败", "error")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [illustID, illust, overlay],
  )

  useEffect(() => {
    let active = true
    const cached = seed ?? getCachedIllust(illustID) ?? null
    if (cached) {
      setIllust(cached)
      setLoading(false)
      try {
        recordHistory(cached)
      } catch {}
    }
    setShowAllPages(false)
    setPageRatios({})
    void (async () => {
      try {
        const fetched = await session.call((token) => illustrationDetail(illustID, token))
        if (!active) return
        cacheIllust(fetched)
        setIllust(fetched)
        setError(null)
        recordIllustBookmark(fetched.id, Boolean(fetched.is_bookmarked))
        setBookmarked(getCachedIllustBookmark(fetched.id) ?? Boolean(fetched.is_bookmarked))
        if (fetched.user?.id) {
          recordUserFollowed(fetched.user.id, Boolean(fetched.user.is_followed))
          setFollowed(
            getEffectiveFollowState(fetched.user.id, Boolean(fetched.user.is_followed)).followed,
          )
        }
        try {
          recordHistory(fetched)
        } catch {}
      } catch (err: any) {
        if (!active) return
        if (!cached) setError(err?.message ?? "加载作品详情失败")
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [illustID, seed])

  // Fetch related illusts preview
  useEffect(() => {
    let active = true
    setRelatedLoading(true)
    void session
      .call((token) => relatedIllustrations(illustID, token))
      .then((page) => {
        if (!active) return
        const filtered = (page.items ?? []).filter((item) => isIllustContentVisible(item))
        setRelated(filtered.slice(0, 8))
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRelatedLoading(false)
      })
    return () => {
      active = false
    }
  }, [illustID])

  // Sync bookmark & follow stores
  useEffect(() => {
    return onIllustBookmarkChanged((id, next) => {
      if (id === illustID) setBookmarked(next)
    })
  }, [illustID])

  const authorId = illust?.user?.id ?? 0
  useEffect(() => {
    if (!authorId) return
    setFollowed(getEffectiveFollowState(authorId, Boolean(illust?.user?.is_followed)).followed)
    return onUserFollowChanged((uid, next) => {
      if (uid === authorId) setFollowed(next)
    })
  }, [authorId, illust?.user?.is_followed])

  const toggleBookmark = useCallback(async () => {
    if (!illust || bookmarkBusy) return
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
    } catch (err: any) {
      setBookmarked(!next)
      overlay.showToast(err?.message ?? "收藏操作失败", "error")
    } finally {
      setBookmarkBusy(false)
    }
  }, [bookmarked, bookmarkBusy, illust, overlay])

  const toggleFollow = useCallback(
    async (restrict: "public" | "private" = "public", forceFollow?: boolean) => {
      if (!illust?.user?.id || followBusy || illust.user.id === session.userID) return
      const targetFollow = forceFollow ?? !followed
      const prev = followed
      setFollowed(targetFollow)
      setFollowBusy(true)
      try {
        triggerHaptic("selection")
      } catch {}
      try {
        await session.call((token) =>
          targetFollow
            ? followUser(illust.user.id, restrict, token)
            : unfollowUser(illust.user.id, token),
        )
        if (targetFollow && restrict === "private") {
          overlay.showToast("已悄悄关注该画师", "success")
        }
      } catch (err: any) {
        setFollowed(prev)
        overlay.showToast(err?.message ?? "关注操作失败", "error")
      } finally {
        setFollowBusy(false)
      }
    },
    [followBusy, followed, illust?.user?.id, overlay],
  )

  const openFollowMenu = useCallback(async () => {
    if (!illust?.user?.id || illust.user.id === session.userID) return
    const idx = await overlay.presentActionSheet({
      title: illust.user.name,
      actions: [
        { label: "公开关注" },
        { label: "悄悄关注（私密）" },
        ...(followed ? [{ label: "取消关注", destructive: true }] : []),
      ],
    })
    if (idx === 0) void toggleFollow("public", true)
    else if (idx === 1) void toggleFollow("private", true)
    else if (idx === 2) void toggleFollow("public", false)
  }, [followed, illust?.user, overlay, toggleFollow])

  const openAISheet = useCallback(
    (initialMode: IllustAIMode = "caption") => {
      if (!illust) return
      overlay.presentSheet({
        title: "AI 助手",
        fullHeight: true,
        render: (close) => (
          <IllustAISheet illust={illust} initialMode={initialMode} onClose={close} />
        ),
      })
    },
    [illust, overlay],
  )

  const openRelatedUsers = useCallback(() => {
    if (!illust?.user?.id) return
    overlay.presentSheet({
      title: `与 ${illust.user.name} 相关的画师`,
      fullHeight: true,
      render: (close) => <RelatedUsersSheet seedUserID={illust.user.id} onClose={close} />,
    })
  }, [illust?.user, overlay])

  const openDownloadSheet = useCallback(async () => {
    if (!illust || downloadStatus) return
    const pageCount = getIllustPageCount(illust)
    const isUgoira = illust.type === "ugoira"

    if (isUgoira) {
      const choice = await overlay.presentActionSheet({
        title: "下载动图",
        message: illust.title,
        actions: [
          { label: "导出高清 MP4 至系统相册" },
          { label: "导出高清 GIF 至系统相册" },
          { label: "导出原始帧 ZIP 至下载目录" },
        ],
      })
      if (choice == null) return
      setDownloadStatus("正在准备动图导出…")
      try {
        const res =
          choice === 0
            ? await exportUgoiraToAlbum(illust, (msg) => setDownloadStatus(msg), "mp4")
            : choice === 1
              ? await exportUgoiraToAlbum(illust, (msg) => setDownloadStatus(msg), "gif")
              : await exportUgoiraZip(illust, (msg) => setDownloadStatus(msg))
        if (res.success) {
          overlay.showToast(
            choice === 2 ? "已保存动图原始 ZIP" : "已保存动图至系统相册",
            "success",
          )
        } else {
          overlay.showToast(res.error || "导出失败", "error")
        }
      } catch (err: any) {
        overlay.showToast(err?.message ?? "导出失败", "error")
      } finally {
        setDownloadStatus(null)
      }
      return
    }

    const choice = await overlay.presentActionSheet({
      title: `下载与导出 (${pageCount}P)`,
      message: illust.title,
      actions: [
        { label: `保存全部图片至相册 (${pageCount} 张)` },
        { label: "打包导出为 ZIP 归档" },
        { label: "导出为 CBZ 漫画包" },
        { label: "导出为 EPUB 漫画电子书" },
      ],
    })
    if (choice == null) return

    setDownloadStatus("正在下载…")
    try {
      if (choice === 0) {
        const quality = getDownloadImageQuality()
        const ok = await downloadIllustToAlbum(illust, quality, (curr, total) => {
          setDownloadStatus(`正在保存至相册 (${curr}/${total})…`)
        })
        overlay.showToast(ok ? "已保存至系统相册 Pix-Scripting" : "保存失败", ok ? "success" : "error")
      } else if (choice === 1) {
        const urls = getIllustDownloadUrls(illust)
        const res = await exportIllustToZip({
          illust,
          imageUrls: urls,
          onProgress: (msg) => setDownloadStatus(msg),
        })
        if (res.success && res.path) {
          overlay.showToast("ZIP 导出完成", "success")
        } else {
          overlay.showToast(res.error || "ZIP 导出失败", "error")
        }
      } else if (choice === 2) {
        const urls = getIllustDownloadUrls(illust)
        const res = await exportMangaToCbz({
          id: illust.id,
          title: illust.title,
          author: illust.user?.name || "Unknown",
          authorId: illust.user?.id,
          description: illust.caption,
          tags: (illust.tags ?? []).map((t) => t.name),
          createdDate: illust.create_date,
          isR18: illust.x_restrict > 0,
          pages: urls.map((url, idx) => ({ pageIndex: idx + 1, url })),
          onProgress: (msg) => setDownloadStatus(msg),
        })
        if (res.success && res.path) {
          overlay.showToast("CBZ 漫画导出完成", "success")
        } else {
          overlay.showToast(res.error || "CBZ 导出失败", "error")
        }
      } else if (choice === 3) {
        const urls = getIllustDownloadUrls(illust)
        const res = await exportMangaToEpub({
          id: illust.id,
          title: illust.title,
          author: illust.user?.name || "Unknown",
          authorId: illust.user?.id,
          description: illust.caption,
          tags: (illust.tags ?? []).map((t) => t.name),
          createdDate: illust.create_date,
          isR18: illust.x_restrict > 0,
          pages: urls.map((url, idx) => ({ pageIndex: idx + 1, url })),
          onProgress: (msg) => setDownloadStatus(msg),
        })
        if (res.success && res.path) {
          overlay.showToast("EPUB 电子书导出完成", "success")
        } else {
          overlay.showToast(res.error || "EPUB 导出失败", "error")
        }
      }
    } catch (err: any) {
      overlay.showToast(err?.message ?? "下载导出失败", "error")
    } finally {
      setDownloadStatus(null)
    }
  }, [downloadStatus, illust, overlay])

  const openMoreMenu = useCallback(async () => {
    if (!illust) return
    const webUrl = `https://www.pixiv.net/artworks/${illust.id}`
    const isOwn = illust.user?.id === session.userID
    const actions = [
      { label: "分享作品链接" },
      { label: "复制作品链接" },
      { label: "复制作品 ID" },
      { label: "在浏览器打开" },
      { label: "编辑收藏标签与隐私" },
      { label: "屏蔽该作者或标签", destructive: true },
      ...(isOwn ? [{ label: "删除我的作品", destructive: true }] : []),
    ]
    const idx = await overlay.presentActionSheet({
      title: illust.title,
      actions,
    })
    if (idx === 0) {
      await shareItems([webUrl])
    } else if (idx === 1) {
      await copyToClipboard(webUrl)
      overlay.showToast("链接已复制", "success")
    } else if (idx === 2) {
      await copyToClipboard(String(illust.id))
      overlay.showToast(`已复制 ID: ${illust.id}`, "success")
    } else if (idx === 3) {
      await openExternalUrl(webUrl)
    } else if (idx === 4) {
      overlay.openBookmarkDetail("illust", illust.id)
    } else if (idx === 5) {
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
      })
    } else if (isOwn && idx === 6) {
      const ok = await overlay.confirm({
        title: "删除作品",
        message: "确定要从 Pixiv 永久删除此作品吗？此操作不可撤销。",
        confirmLabel: "删除",
        destructive: true,
      })
      if (!ok) return
      try {
        await session.call((token) => deleteIllust(illust.id, token))
        overlay.showToast("作品已删除", "success")
        nav.pop()
      } catch (err: any) {
        overlay.showToast(err?.message ?? "删除失败", "error")
      }
    }
  }, [illust, nav, overlay])

  const captionSegments = useMemo(() => parseCaptionSegments(illust?.caption), [illust?.caption])
  const pageCount = getIllustPageCount(illust)
  const visiblePageCount = showAllPages ? pageCount : Math.min(pageCount, INITIAL_VISIBLE_PAGES)
  const relatedColWidth = Math.floor((Math.max(240, windowWidth - 24) - ILLUST_CARD_GAP) / 2)

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={illust?.title || "作品详情"}
        subtitle={illust?.user?.name}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          illust ? (
            <>
              <HeaderIconButton label="AI" onPress={() => openAISheet("caption")} />
              <HeaderIconButton label="⋯" onPress={() => void openMoreMenu()} />
            </>
          ) : null
        }
      />

      {loading && !illust ? (
        <LoadingView message="正在加载作品…" />
      ) : error && !illust ? (
        <ErrorView message={error} onRetry={() => void loadDetail(false)} />
      ) : illust ? (
        <ScrollView
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingBottom: effectiveBottomInset(insets) + 32,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadDetail(true)}
              tintColor={accent}
              colors={[accent]}
            />
          }
        >
          {/* Download progress banner */}
          {downloadStatus ? (
            <View style={[styles.downloadBanner, { backgroundColor: accentSoft }]}>
              <ActivityIndicator size="small" color={accent} />
              <Text style={[styles.downloadBannerText, { color: accent }]} numberOfLines={1}>
                {downloadStatus}
              </Text>
            </View>
          ) : null}

          {/* Media section: Ugoira or Vertical Multi-Page Viewer */}
          {illust.type === "ugoira" ? (
            <UgoiraPlayer illust={illust} />
          ) : (
            <View style={styles.pagesWrap}>
              {Array.from({ length: visiblePageCount }, (_, idx) => {
                const url = imageUrlOf(illust, idx, detailQuality)
                const previewUrl = resolveIllustUnderlayUrl(illust, idx)
                const ratio =
                  pageRatios[idx] ??
                  (idx === 0
                    ? clampedAspectRatio(illust.width, illust.height, 0.38, 2.4, 0.85)
                    : clampedAspectRatio(illust.width, illust.height, 0.45, 2.2, 0.85))
                return (
                  <Pressable
                    key={`${illust.id}-p-${idx}`}
                    onPress={() =>
                      nav.push({
                        name: "illustGallery",
                        illust,
                        initialPage: idx,
                      })
                    }
                    style={[styles.pageItem, { backgroundColor: colors.surface }]}
                  >
                    <PixImage
                      url={url}
                      previewUrl={previewUrl}
                      priority={idx * 5}
                      resizeMode="contain"
                      showRetry={true}
                      showSpinner={true}
                      style={{ width: "100%", aspectRatio: ratio }}
                      onNaturalSize={(w, h) => {
                        if (w > 0 && h > 0) {
                          const nextRatio = clampedAspectRatio(w, h, 0.35, 2.6, ratio)
                          setPageRatios((prev) =>
                            prev[idx] && Math.abs(prev[idx] - nextRatio) < 0.02
                              ? prev
                              : { ...prev, [idx]: nextRatio },
                          )
                        }
                      }}
                    />
                    {pageCount > 1 ? (
                      <View style={styles.pageBadge} pointerEvents="none">
                        <Text style={styles.pageBadgeText}>
                          {idx + 1} / {pageCount}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                )
              })}

              {!showAllPages && pageCount > INITIAL_VISIBLE_PAGES ? (
                <Pressable
                  onPress={() => setShowAllPages(true)}
                  style={[
                    styles.expandBtn,
                    { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                  ]}
                >
                  <Text style={[styles.expandBtnText, { color: accent }]}>
                    展开其余 {pageCount - INITIAL_VISIBLE_PAGES} 页（共 {pageCount} 页）
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {/* Action toolbar */}
          <View
            style={[
              styles.actionBar,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <Pressable
              onPress={() => void toggleBookmark()}
              onLongPress={() => {
                try {
                  triggerHaptic("medium")
                } catch {}
                overlay.openBookmarkDetail("illust", illust.id)
              }}
              disabled={bookmarkBusy}
              style={styles.actionCell}
            >
              <Text style={[styles.actionIcon, { color: bookmarked ? colors.pink : colors.text }]}>
                {bookmarked ? "♥" : "♡"}
              </Text>
              <Text
                style={[styles.actionLabel, { color: bookmarked ? colors.pink : colors.textSecondary }]}
              >
                {bookmarked ? "已收藏" : "收藏"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => overlay.openComments("illust", illust.id)}
              style={styles.actionCell}
            >
              <Text style={[styles.actionIcon, { color: colors.text }]}>💬</Text>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>
                评论{illust.total_comments > 0 ? ` ${illust.total_comments}` : ""}
              </Text>
            </Pressable>

            <Pressable onPress={() => openAISheet("ocr")} style={styles.actionCell}>
              <Text style={[styles.actionIcon, { color: accent }]}>✦</Text>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>AI 汉化</Text>
            </Pressable>

            <Pressable
              onPress={() => void openDownloadSheet()}
              disabled={Boolean(downloadStatus)}
              style={styles.actionCell}
            >
              <Text style={[styles.actionIcon, { color: colors.text }]}>↓</Text>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>下载</Text>
            </Pressable>

            <Pressable
              onPress={() => void shareItems([`https://www.pixiv.net/artworks/${illust.id}`])}
              style={styles.actionCell}
            >
              <Text style={[styles.actionIcon, { color: colors.text }]}>↗</Text>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>分享</Text>
            </Pressable>
          </View>

          {/* Title & metadata card */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
            ]}
          >
            <View style={styles.pillRow}>
              {illust.x_restrict === 1 ? (
                <View style={[styles.metaPill, { backgroundColor: colors.danger }]}>
                  <Text style={styles.metaPillWhite}>R-18</Text>
                </View>
              ) : null}
              {illust.x_restrict === 2 ? (
                <View style={[styles.metaPill, { backgroundColor: colors.danger }]}>
                  <Text style={styles.metaPillWhite}>R-18G</Text>
                </View>
              ) : null}
              {illust.illust_ai_type === 2 ? (
                <View style={[styles.metaPill, { backgroundColor: colors.purple }]}>
                  <Text style={styles.metaPillWhite}>AI</Text>
                </View>
              ) : null}
              {illust.type === "manga" ? (
                <View style={[styles.metaPill, { backgroundColor: colors.fill }]}>
                  <Text style={[styles.metaPillText, { color: colors.textSecondary }]}>漫画</Text>
                </View>
              ) : null}
              {pageCount > 1 ? (
                <View style={[styles.metaPill, { backgroundColor: colors.fill }]}>
                  <Text style={[styles.metaPillText, { color: colors.textSecondary }]}>
                    {pageCount}P
                  </Text>
                </View>
              ) : null}
            </View>

            <Text selectable={true} style={[styles.title, { color: colors.text }]}>
              {illust.title}
            </Text>

            <View style={styles.statsRow}>
              <Text style={[styles.statText, { color: colors.textSecondary }]}>
                浏览 {formatMetricCount(illust.total_view)}
              </Text>
              <Text style={[styles.statText, { color: colors.textSecondary }]}>
                · 收藏 {formatMetricCount(illust.total_bookmarks)}
              </Text>
              <Text style={[styles.statText, { color: colors.textSecondary }]}>
                · {illust.width}×{illust.height}
              </Text>
              <Text style={[styles.statText, { color: colors.textTertiary }]}>
                · {formatShortDate(illust.create_date)}
              </Text>
            </View>
          </View>

          {/* Author bar */}
          {illust.user ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <View style={styles.authorRow}>
                <Pressable
                  onPress={() => nav.push({ name: "user", id: illust.user.id, seed: illust.user })}
                  style={styles.authorInfo}
                >
                  <PixAvatar
                    url={illust.user.profile_image_urls?.medium}
                    name={illust.user.name}
                    size={44}
                  />
                  <View style={styles.authorNames}>
                    <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>
                      {illust.user.name}
                    </Text>
                    <Text style={[styles.authorAccount, { color: colors.textSecondary }]} numberOfLines={1}>
                      @{illust.user.account}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.authorBtns}>
                  <Pressable
                    onPress={openRelatedUsers}
                    style={[styles.smallBtn, { backgroundColor: colors.fill }]}
                  >
                    <Text style={[styles.smallBtnText, { color: colors.textSecondary }]}>相关画师</Text>
                  </Pressable>

                  {illust.user.id !== session.userID ? (
                    <Pressable
                      onPress={() => void toggleFollow("public")}
                      onLongPress={() => void openFollowMenu()}
                      disabled={followBusy}
                      style={[
                        styles.followBtn,
                        {
                          backgroundColor: followed ? colors.fill : accent,
                          borderColor: followed ? colors.glassBorder : accent,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.followBtnText,
                          { color: followed ? colors.text : "#FFFFFF" },
                        ]}
                      >
                        {followed ? "已关注" : "关注"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          {/* Series card */}
          {illust.series?.id ? (
            <Pressable
              onPress={() =>
                nav.push({ name: "series", kind: "manga", id: illust.series!.id })
              }
              style={[
                styles.seriesCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <View style={[styles.seriesBadge, { backgroundColor: accentSoft }]}>
                <Text style={[styles.seriesBadgeText, { color: accent }]}>系列</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.seriesTitle, { color: colors.text }]} numberOfLines={1}>
                  {illust.series.title || `漫画系列 #${illust.series.id}`}
                </Text>
                <Text style={[styles.seriesSub, { color: colors.textSecondary }]}>
                  点击查看系列全部话数与追更
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
            </Pressable>
          ) : null}

          {/* Caption card */}
          {captionSegments.length > 0 ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <View style={styles.sectionHeaderInline}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>作品简介</Text>
                <Pressable onPress={() => openAISheet("caption")} hitSlop={8}>
                  <Text style={[styles.linkAction, { color: accent }]}>✦ AI 翻译</Text>
                </Pressable>
              </View>
              <Text selectable={true} style={[styles.captionText, { color: colors.text }]}>
                {captionSegments.map((seg, i) =>
                  seg.type === "link" && seg.href ? (
                    <Text
                      key={i}
                      style={{ color: accent, textDecorationLine: "underline" }}
                      onPress={() => handlePixivHref(seg.href!, nav)}
                    >
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={i}>{seg.text}</Text>
                  ),
                )}
              </Text>
            </View>
          ) : null}

          {/* Tags card */}
          {Array.isArray(illust.tags) && illust.tags.length > 0 ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>标签</Text>
              <View style={styles.tagsWrap}>
                {illust.tags.map((tag) => (
                  <Pressable
                    key={tag.name}
                    onPress={() => nav.push({ name: "tagFeed", tag: tag.name, kind: "illust" })}
                    style={[
                      styles.tagChip,
                      { backgroundColor: colors.fill, borderColor: colors.glassBorder },
                    ]}
                  >
                    <Text style={[styles.tagPrimary, { color: accent }]}>#{tag.name}</Text>
                    {tag.translated_name ? (
                      <Text style={[styles.tagTranslated, { color: colors.textSecondary }]}>
                        {tag.translated_name}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Related illusts preview */}
          <View style={styles.relatedSection}>
            <View style={styles.relatedHeader}>
              <Text style={[styles.relatedTitle, { color: colors.text }]}>相关推荐</Text>
              <Pressable
                onPress={() => nav.push({ name: "relatedIllust", id: illust.id })}
                hitSlop={8}
              >
                <Text style={[styles.linkAction, { color: accent }]}>查看全部 ›</Text>
              </Pressable>
            </View>

            {relatedLoading && related.length === 0 ? (
              <View style={styles.relatedLoader}>
                <ActivityIndicator size="small" color={accent} />
              </View>
            ) : related.length > 0 ? (
              <View style={styles.relatedGrid}>
                {related.map((item, idx) => (
                  <IllustCard
                    key={item.id}
                    illust={item}
                    width={relatedColWidth}
                    compact={settings.compactIllustCard}
                    priority={200 + idx * 10}
                    onPress={(it) => {
                      cacheIllust(it)
                      nav.push({ name: "illust", id: it.id, seed: it })
                    }}
                    onPressAuthor={(uid) => nav.push({ name: "user", id: uid })}
                  />
                ))}
              </View>
            ) : (
              <Text style={[styles.emptyRelated, { color: colors.textTertiary }]}>暂无相关推荐</Text>
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  downloadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  downloadBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  pagesWrap: {
    gap: 4,
  },
  pageItem: {
    width: "100%",
    position: "relative",
  },
  pageBadge: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: "rgba(0,0,0,0.62)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pageBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  expandBtn: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  expandBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginHorizontal: 12,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionCell: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 58,
    gap: 3,
  },
  actionIcon: {
    fontSize: 19,
    fontWeight: "700",
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  card: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  metaPillWhite: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  statText: {
    fontSize: 12,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  authorInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  authorNames: {
    flex: 1,
    gap: 2,
  },
  authorName: {
    fontSize: 15,
    fontWeight: "700",
  },
  authorAccount: {
    fontSize: 12,
  },
  authorBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  seriesCard: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  seriesBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  seriesBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  seriesTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  seriesSub: {
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
  },
  sectionHeaderInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  linkAction: {
    fontSize: 13,
    fontWeight: "600",
  },
  captionText: {
    fontSize: 14,
    lineHeight: 21,
  },
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagPrimary: {
    fontSize: 13,
    fontWeight: "600",
  },
  tagTranslated: {
    fontSize: 12,
  },
  relatedSection: {
    marginTop: 18,
    paddingHorizontal: 12,
    gap: 10,
  },
  relatedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  relatedTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  relatedLoader: {
    paddingVertical: 20,
    alignItems: "center",
  },
  relatedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: ILLUST_CARD_GAP,
  },
  emptyRelated: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
})
