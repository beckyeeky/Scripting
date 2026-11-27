import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { cleanHtmlCaption } from "../../../../../../Pix-Scripting/src/api/aiService"
import {
  addNovelBookmark,
  novelDetail,
  novelViewerData,
  relatedNovels,
  removeNovelBookmark,
  type NovelViewerData,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { exportNovelToEpub } from "../../../../../../Pix-Scripting/src/downloader/epubExporter"
import { exportNovelToText } from "../../../../../../Pix-Scripting/src/downloader/novelTextExporter"
import { novelThumbUrlOf } from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedNovelBookmark,
  onNovelBookmarkChanged,
} from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import { recordNovelHistory } from "../../../../../../Pix-Scripting/src/store/history"
import { cacheNovel, getCachedNovel } from "../../../../../../Pix-Scripting/src/store/novelCache"
import { buildNovelPlainTextDocument } from "../../../../../../Pix-Scripting/src/store/novelExport"
import {
  hasOfflineEpisode,
  readOfflineEpisode,
  saveOfflineEpisode,
  synthesizeOfflineNovelDetail,
} from "../../../../../../Pix-Scripting/src/store/novelOfflineLibrary"
import {
  buildEpisodeOutline,
  outlineEntryLabel,
} from "../../../../../../Pix-Scripting/src/store/novelOutline"
import {
  getNovelProgress,
  onNovelProgressChanged,
  type NovelReadingProgress,
} from "../../../../../../Pix-Scripting/src/store/novelProgress"
import type { PixivNovel, PixivNovelDetail } from "../../../../../../Pix-Scripting/src/types"
import { uploadedImageUrl } from "../../../../../../Pix-Scripting/src/ui/novelOfflineCapture"
import { ScriptingPasteboard, ScriptingShareSheet } from "../../../scripting/hostGlobals"
import {
  ActionButton,
  ErrorView,
  formatWordCount,
  HeaderIconButton,
  LoadingView,
  NovelCard,
  PixAvatar,
  PixImage,
  ScreenHeader,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { NovelAISheet } from "./NovelAISheet"
import { parseNovelToChunks } from "./novelHtmlBuilder"

export function NovelDetailScreen({
  novelID,
  seed,
}: {
  novelID: number
  seed?: PixivNovel
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const initialSeed = useMemo(
    () => seed ?? getCachedNovel(novelID) ?? null,
    [novelID, seed],
  )
  const [detail, setDetail] = useState<PixivNovelDetail | PixivNovel | null>(initialSeed)
  const [viewer, setViewer] = useState<NovelViewerData | null>(() => {
    const offline = readOfflineEpisode(novelID)
    return offline
      ? {
          text: offline.text,
          coverUrl: offline.coverUrl ?? undefined,
          title: offline.title,
        }
      : null
  })
  const [related, setRelated] = useState<PixivNovel[]>([])
  const [loading, setLoading] = useState(!initialSeed && !viewer)
  const [refreshing, setRefreshing] = useState(false)
  const [textLoading, setTextLoading] = useState(!viewer)
  const [error, setError] = useState<string | null>(null)
  const [isOfflineOnly, setIsOfflineOnly] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    () => getCachedNovelBookmark(novelID) ?? Boolean(initialSeed?.is_bookmarked),
  )
  const [isOfflineSaved, setIsOfflineSaved] = useState<boolean>(() =>
    hasOfflineEpisode(novelID),
  )
  const [progress, setProgress] = useState<NovelReadingProgress | undefined>(() =>
    getNovelProgress(novelID),
  )
  const [bookmarkBusy, setBookmarkBusy] = useState(false)

  useEffect(() => {
    return onNovelBookmarkChanged((id, bookmarked) => {
      if (id === novelID) setIsBookmarked(bookmarked)
    })
  }, [novelID])

  useEffect(() => {
    return onNovelProgressChanged((id) => {
      if (id === novelID || id === 0) setProgress(getNovelProgress(novelID))
    })
  }, [novelID])

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      else if (!detail) setLoading(true)
      setTextLoading(true)
      setError(null)
      setIsOfflineOnly(false)

      try {
        const [detRes, viewerRes, relRes] = await Promise.allSettled([
          session.call((tk) => novelDetail(novelID, tk)),
          session.call((tk) => novelViewerData(novelID, tk)),
          session.call((tk) => relatedNovels(novelID, tk)),
        ])

        let resolvedDetail: PixivNovelDetail | PixivNovel | null =
          detRes.status === "fulfilled" && detRes.value ? detRes.value : detail
        let resolvedViewer: NovelViewerData | null =
          viewerRes.status === "fulfilled" && viewerRes.value?.text ? viewerRes.value : viewer

        if (!resolvedDetail || !resolvedViewer?.text) {
          const offline = readOfflineEpisode(novelID)
          if (offline) {
            if (!resolvedDetail) {
              resolvedDetail = synthesizeOfflineNovelDetail(offline, initialSeed)
            }
            if (!resolvedViewer?.text) {
              resolvedViewer = {
                text: offline.text,
                coverUrl: offline.coverUrl ?? undefined,
                title: offline.title,
              }
            }
            setIsOfflineOnly(true)
          }
        }

        if (resolvedDetail) {
          setDetail(resolvedDetail)
          cacheNovel(resolvedDetail)
          setIsBookmarked(
            getCachedNovelBookmark(novelID) ?? Boolean(resolvedDetail.is_bookmarked),
          )
          try {
            recordNovelHistory({
              ...resolvedDetail,
              is_muted: "is_muted" in resolvedDetail ? resolvedDetail.is_muted : false,
              visible: "visible" in resolvedDetail ? resolvedDetail.visible : true,
            } as PixivNovel)
          } catch {}
        } else if (detRes.status === "rejected") {
          setError(detRes.reason?.message ?? "无法加载小说详情")
        }

        if (resolvedViewer) {
          setViewer(resolvedViewer)
        }

        if (relRes.status === "fulfilled" && Array.isArray(relRes.value?.items)) {
          setRelated(relRes.value.items.slice(0, 12))
        }
      } catch (err: any) {
        const offline = readOfflineEpisode(novelID)
        if (offline) {
          const synth = synthesizeOfflineNovelDetail(offline, initialSeed)
          if (synth) setDetail(synth)
          setViewer({
            text: offline.text,
            coverUrl: offline.coverUrl ?? undefined,
            title: offline.title,
          })
          setIsOfflineOnly(true)
        } else {
          setError(err?.message ?? "加载失败")
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
        setTextLoading(false)
      }
    },
    [detail, initialSeed, novelID, viewer],
  )

  useEffect(() => {
    void loadAll(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelID])

  const novelText = viewer?.text || (detail && "content" in detail ? detail.content || "" : "")
  const chunks = useMemo(
    () => parseNovelToChunks(novelText, viewer?.textEmbeddedImages),
    [novelText, viewer?.textEmbeddedImages],
  )
  const outline = useMemo(() => buildEpisodeOutline(chunks), [chunks])

  const coverUrl =
    viewer?.coverUrl || (detail ? novelThumbUrlOf(detail) : null) || null

  const openReader = useCallback(
    (override?: { initialPage?: number; initialChunkId?: string | null }) => {
      if (!novelText) {
        overlay.showToast(textLoading ? "正在加载正文，请稍候…" : "正文暂不可用", "info")
        return
      }
      const detFull = detail && "series_prev" in detail ? (detail as PixivNovelDetail) : null
      nav.push({
        name: "novelReader",
        novelId: novelID,
        title: detail?.title || viewer?.title || `小说 #${novelID}`,
        caption: detail?.caption ? cleanHtmlCaption(detail.caption) : undefined,
        text: novelText,
        coverUrl,
        textEmbeddedImages: viewer?.textEmbeddedImages,
        initialPage: override?.initialPage,
        initialChunkId: override?.initialChunkId,
        seriesId: detail?.series?.id ?? null,
        seriesTitle: detail?.series?.title ?? null,
        seriesPrev: detFull?.series_prev
          ? { id: detFull.series_prev.id, title: detFull.series_prev.title }
          : null,
        seriesNext: detFull?.series_next
          ? { id: detFull.series_next.id, title: detFull.series_next.title }
          : null,
        episodeNumber: detail?.episode_number ?? null,
      })
    },
    [coverUrl, detail, nav, novelID, novelText, overlay, progress, textLoading, viewer],
  )

  const handleToggleBookmark = useCallback(async () => {
    if (bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      triggerHaptic("light")
      if (isBookmarked) {
        await session.call((tk) => removeNovelBookmark(novelID, tk))
        setIsBookmarked(false)
        overlay.showToast("已取消收藏", "info")
      } else {
        await session.call((tk) => addNovelBookmark(novelID, "public", tk, []))
        setIsBookmarked(true)
        overlay.showToast("已收藏小说", "success")
      }
    } catch (err: any) {
      overlay.showToast(`收藏失败：${err?.message ?? err}`, "error")
    } finally {
      setBookmarkBusy(false)
    }
  }, [bookmarkBusy, isBookmarked, novelID, overlay])

  const handleSaveOffline = useCallback(() => {
    if (!novelText) {
      overlay.showToast("正文尚未加载完成", "info")
      return
    }
    const saved = saveOfflineEpisode({
      novelId: novelID,
      title: detail?.title || viewer?.title || `小说 ${novelID}`,
      text: novelText,
      author: detail?.user?.name,
      seriesId: detail?.series?.id ?? null,
      episodeNumber: detail?.episode_number ?? null,
      caption: detail?.caption ? cleanHtmlCaption(detail.caption) : null,
      coverUrl,
      tags: (detail?.tags || []).map((t) => t.name).filter(Boolean),
    })
    if (saved) {
      setIsOfflineSaved(true)
      overlay.showToast("已保存到离线书库", "success")
    } else {
      overlay.showToast("离线保存失败", "error")
    }
  }, [coverUrl, detail, novelID, novelText, overlay, viewer?.title])

  const handleExport = useCallback(
    async (kind: "epub" | "txt") => {
      if (!novelText) {
        overlay.showToast("正文尚未加载完成", "info")
        return
      }
      const title = detail?.title || `小说_${novelID}`
      const author = detail?.user?.name || "Pixiv"
      const caption = detail?.caption ? cleanHtmlCaption(detail.caption) : undefined
      try {
        if (kind === "txt") {
          const doc = buildNovelPlainTextDocument({
            title,
            author,
            caption,
            text: novelText,
            sourceUrl: `https://www.pixiv.net/novel/show.php?id=${novelID}`,
          })
          const outPath = exportNovelToText({ title, author, content: doc })
          if (outPath) {
            overlay.showToast("TXT 已导出", "success")
            await ScriptingShareSheet.present([outPath])
          } else {
            overlay.showToast("TXT 导出失败", "error")
          }
          return
        }
        overlay.showToast("正在生成 EPUB…", "info")
        const embeddedMap: Record<string, string> = {}
        if (viewer?.textEmbeddedImages) {
          for (const [k, v] of Object.entries(viewer.textEmbeddedImages)) {
            const u = uploadedImageUrl(v)
            if (u) embeddedMap[k] = u
          }
        }
        const epubPath = await exportNovelToEpub({
          id: novelID,
          title,
          author,
          authorId: detail?.user?.id,
          seriesTitle: detail?.series?.title,
          description: caption,
          tags: (detail?.tags || []).map((t) => t.name),
          createdDate: detail?.create_date,
          isR18: (detail?.x_restrict ?? 0) > 0,
          coverUrl: coverUrl ?? undefined,
          chapters: [
            {
              id: novelID,
              title,
              text: novelText,
              images: Object.keys(embeddedMap).length > 0 ? embeddedMap : undefined,
              caption,
            },
          ],
        })
        if (epubPath) {
          overlay.showToast("EPUB 已生成", "success")
          await ScriptingShareSheet.present([epubPath])
        } else {
          overlay.showToast("EPUB 生成失败", "error")
        }
      } catch (err: any) {
        overlay.showToast(`导出失败：${err?.message ?? err}`, "error")
      }
    },
    [coverUrl, detail, novelID, novelText, overlay, viewer?.textEmbeddedImages],
  )

  const openMoreMenu = useCallback(async () => {
    const actions = [
      { label: "导出 EPUB 电子书" },
      { label: "导出 TXT 文本" },
      { label: isOfflineSaved ? "更新离线缓存" : "保存到离线书库" },
      { label: "收藏标签 / 私密收藏" },
      { label: "复制 Pixiv 链接" },
      { label: "屏蔽该作品作者或标签", destructive: true },
    ]
    const idx = await overlay.presentActionSheet({ title: "更多操作", actions })
    if (idx === 0) await handleExport("epub")
    else if (idx === 1) await handleExport("txt")
    else if (idx === 2) handleSaveOffline()
    else if (idx === 3) overlay.openBookmarkDetail("novel", novelID)
    else if (idx === 4) {
      await ScriptingPasteboard.setString(`https://www.pixiv.net/novel/show.php?id=${novelID}`)
      overlay.showToast("已复制链接", "success")
    } else if (idx === 5 && detail) {
      overlay.openBlockWork({
        user: detail.user
          ? {
              id: detail.user.id,
              name: detail.user.name,
              account: detail.user.account,
              avatarURL: detail.user.profile_image_urls?.medium,
            }
          : null,
        tags: (detail.tags || []).map((t) => t.name),
      })
    }
  }, [detail, handleExport, handleSaveOffline, isOfflineSaved, novelID, overlay])

  if (loading && !detail) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title="小说详情" showBack={nav.canGoBack} onBack={() => nav.pop()} />
        <LoadingView message="正在加载小说详情…" />
      </View>
    )
  }

  if (error && !detail) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <ScreenHeader title="小说详情" showBack={nav.canGoBack} onBack={() => nav.pop()} />
        <ErrorView message={error} onRetry={() => void loadAll(false)} />
      </View>
    )
  }

  const cleanCaption = detail?.caption ? cleanHtmlCaption(detail.caption) : ""
  const isR18 = (detail?.x_restrict ?? 0) > 0
  const isAI = Boolean(detail && "novel_ai_type" in detail && detail.novel_ai_type === 2)
  const detFull = detail && "series_prev" in detail ? (detail as PixivNovelDetail) : null

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="小说详情"
        subtitle={isOfflineOnly ? "离线模式" : undefined}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          <View style={styles.headerActions}>
            <HeaderIconButton
              label={isBookmarked ? "♥" : "♡"}
              color={isBookmarked ? colors.pink : colors.text}
              onPress={() => void handleToggleBookmark()}
            />
            <HeaderIconButton label="⋯" onPress={() => void openMoreMenu()} />
          </View>
        }
      />

      <ScrollView
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadAll(true)}
            tintColor={accent}
            colors={[accent]}
          />
        }
        contentContainerStyle={{
          paddingBottom: effectiveBottomInset(insets) + 28,
        }}
      >
        {/* Hero Card */}
        <View style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
          <View style={styles.heroTop}>
            <View style={styles.coverWrap}>
              <PixImage
                url={coverUrl}
                style={{ width: "100%", aspectRatio: 0.72 }}
                borderRadius={10}
                resizeMode="cover"
                priority={10}
              />
            </View>
            <View style={styles.heroMeta}>
              <View style={styles.badgeRow}>
                {isR18 ? (
                  <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                    <Text style={styles.badgeText}>R-18</Text>
                  </View>
                ) : null}
                {isAI ? (
                  <View style={[styles.badge, { backgroundColor: colors.purple }]}>
                    <Text style={styles.badgeText}>AI</Text>
                  </View>
                ) : null}
                {isOfflineSaved ? (
                  <View style={[styles.badge, { backgroundColor: colors.green }]}>
                    <Text style={styles.badgeText}>已离线</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.title, { color: colors.text }]}>
                {detail?.title || `小说 #${novelID}`}
              </Text>

              {detail?.series?.id ? (
                <Pressable
                  onPress={() => nav.push({ name: "series", kind: "novel", id: detail.series!.id })}
                  style={[styles.seriesPill, { backgroundColor: accentSoft }]}
                >
                  <Text style={[styles.seriesPillText, { color: accent }]} numberOfLines={1}>
                    系列：{detail.series.title || `#${detail.series.id}`} ›
                  </Text>
                </Pressable>
              ) : null}

              <Text style={[styles.statsText, { color: colors.textSecondary }]}>
                {formatWordCount(detail?.text_length || novelText.length)} ·{" "}
                {Math.max(1, detail?.page_count || 1)} 页
              </Text>
              <Text style={[styles.statsText, { color: colors.textTertiary }]}>
                ♥ {detail?.total_bookmarks ?? 0} · 👁 {detail?.total_view ?? 0}
                {detail?.create_date ? ` · ${detail.create_date.slice(0, 10)}` : ""}
              </Text>
            </View>
          </View>

          <ActionButton
            title={
              textLoading && !novelText
                ? "正在加载正文…"
                : progress && (progress.page > 1 || progress.chunkId)
                  ? `继续阅读（第 ${progress.page} 页）`
                  : "开始阅读"
            }
            loading={textLoading && !novelText}
            disabled={!novelText}
            onPress={() => openReader()}
            style={styles.readCta}
          />

          {/* Quick Actions */}
          <View style={styles.quickRow}>
            <QuickChip
              label={isBookmarked ? "已收藏" : "收藏"}
              active={isBookmarked}
              color={isBookmarked ? colors.pink : colors.text}
              onPress={() => void handleToggleBookmark()}
              onLongPress={() => overlay.openBookmarkDetail("novel", novelID)}
            />
            <QuickChip
              label={`评论${detail?.total_comments ? ` ${detail.total_comments}` : ""}`}
              color={colors.text}
              onPress={() => overlay.openComments("novel", novelID)}
            />
            <QuickChip
              label={isOfflineSaved ? "已离线" : "离线"}
              active={isOfflineSaved}
              color={isOfflineSaved ? colors.green : colors.text}
              onPress={handleSaveOffline}
            />
            <QuickChip
              label="AI 导读"
              color={colors.text}
              onPress={() => {
                if (!novelText) {
                  overlay.showToast("正文尚未加载", "info")
                  return
                }
                overlay.presentSheet({
                  title: "AI 导读与续写",
                  fullHeight: true,
                  render: (close) => (
                    <NovelAISheet
                      title={detail?.title || `小说 #${novelID}`}
                      text={novelText}
                      onOpenCustomAISettings={() => nav.push({ name: "customAI" })}
                      onClose={close}
                    />
                  ),
                })
              }}
            />
            <QuickChip
              label="EPUB"
              color={colors.text}
              onPress={() => void handleExport("epub")}
            />
          </View>
        </View>

        {/* Author */}
        {detail?.user && detail.user.id > 0 ? (
          <Pressable
            onPress={() => nav.push({ name: "user", id: detail.user.id, seed: detail.user })}
            style={({ pressed }) => [
              styles.sectionCard,
              styles.authorRow,
              { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              pressed && { opacity: 0.72 },
            ]}
          >
            <PixAvatar url={detail.user.profile_image_urls?.medium} size={42} />
            <View style={styles.flex}>
              <Text style={[styles.authorName, { color: colors.text }]} numberOfLines={1}>
                {detail.user.name}
              </Text>
              <Text style={[styles.authorSub, { color: colors.textSecondary }]} numberOfLines={1}>
                @{detail.user.account || detail.user.id}
              </Text>
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 20 }}>›</Text>
          </Pressable>
        ) : null}

        {/* Series Prev/Next */}
        {detFull?.series_prev || detFull?.series_next ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>系列导航</Text>
            <View style={styles.seriesLinkRow}>
              {detFull.series_prev ? (
                <Pressable
                  onPress={() => nav.push({ name: "novel", id: detFull.series_prev!.id })}
                  style={[styles.seriesLinkBtn, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.seriesLinkDir, { color: colors.textSecondary }]}>‹ 上一话</Text>
                  <Text style={[styles.seriesLinkTitle, { color: colors.text }]} numberOfLines={1}>
                    {detFull.series_prev.title}
                  </Text>
                </Pressable>
              ) : null}
              {detFull.series_next ? (
                <Pressable
                  onPress={() => nav.push({ name: "novel", id: detFull.series_next!.id })}
                  style={[styles.seriesLinkBtn, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.seriesLinkDir, { color: accent }]}>下一话 ›</Text>
                  <Text style={[styles.seriesLinkTitle, { color: colors.text }]} numberOfLines={1}>
                    {detFull.series_next.title}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Caption */}
        {cleanCaption ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>简介</Text>
            <Text selectable={true} style={[styles.captionText, { color: colors.text }]}>
              {cleanCaption}
            </Text>
          </View>
        ) : null}

        {/* Tags */}
        {detail?.tags && detail.tags.length > 0 ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>标签</Text>
            <View style={styles.tagsWrap}>
              {detail.tags.map((tag) => (
                <Pressable
                  key={tag.name}
                  onPress={() => nav.push({ name: "tagFeed", tag: tag.name, kind: "novel" })}
                  style={[styles.tagChip, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.tagText, { color: accent }]}>#{tag.name}</Text>
                  {tag.translated_name ? (
                    <Text style={[styles.tagTrans, { color: colors.textSecondary }]}>
                      {" "}
                      {tag.translated_name}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Outline Preview */}
        {outline.length > 0 ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              本篇目录 ({outline.length})
            </Text>
            {outline.slice(0, 8).map((entry) => (
              <Pressable
                key={`${entry.id}-${entry.chunkIndex}`}
                onPress={() =>
                  openReader({ initialPage: entry.page, initialChunkId: entry.id })
                }
                style={[styles.outlineRow, { borderTopColor: colors.separator }]}
              >
                <Text style={[styles.outlineText, { color: colors.text }]} numberOfLines={1}>
                  {entry.kind === "chapter" ? `§ ${outlineEntryLabel(entry)}` : outlineEntryLabel(entry)}
                </Text>
                <Text style={[styles.outlinePage, { color: colors.textTertiary }]}>
                  P.{entry.page}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Related Novels */}
        {related.length > 0 ? (
          <View style={styles.relatedWrap}>
            <View style={styles.relatedHeader}>
              <Text style={[styles.relatedTitle, { color: colors.text }]}>相关推荐小说</Text>
              <Pressable onPress={() => nav.push({ name: "relatedNovel", id: novelID })}>
                <Text style={{ color: accent, fontSize: 13, fontWeight: "600" }}>查看全部 ›</Text>
              </Pressable>
            </View>
            {related.map((item) => (
              <NovelCard
                key={item.id}
                novel={item}
                onPress={(n) => nav.push({ name: "novel", id: n.id, seed: n })}
                onPressAuthor={(uid) => nav.push({ name: "user", id: uid })}
                onPressSeries={(sid) => nav.push({ name: "series", kind: "novel", id: sid })}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function QuickChip({
  label,
  active = false,
  color,
  onPress,
  onLongPress,
}: {
  label: string
  active?: boolean
  color: string
  onPress: () => void
  onLongPress?: () => void
}) {
  const { colors, accentSoft } = useAppTheme()
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.quickChip,
        { backgroundColor: active ? accentSoft : colors.fill },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.quickChipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  heroCard: {
    marginHorizontal: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  heroTop: {
    flexDirection: "row",
    gap: 14,
  },
  coverWrap: {
    width: 102,
  },
  heroMeta: {
    flex: 1,
    gap: 6,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 23,
  },
  seriesPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },
  seriesPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statsText: {
    fontSize: 12,
  },
  readCta: {
    marginTop: 2,
  },
  quickRow: {
    flexDirection: "row",
    gap: 6,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sectionCard: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  authorName: {
    fontSize: 15,
    fontWeight: "700",
  },
  authorSub: {
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  seriesLinkRow: {
    flexDirection: "row",
    gap: 8,
  },
  seriesLinkBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    gap: 3,
  },
  seriesLinkDir: {
    fontSize: 11,
    fontWeight: "700",
  },
  seriesLinkTitle: {
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
    gap: 6,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tagTrans: {
    fontSize: 11,
  },
  outlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  outlineText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  outlinePage: {
    fontSize: 12,
  },
  relatedWrap: {
    marginTop: 16,
  },
  relatedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  relatedTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
})
