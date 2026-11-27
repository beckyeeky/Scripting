import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  addWatchlistSeries,
  deleteWatchlistSeries,
  illustrationDetail,
  illustrationSeries,
  nextIllustrationSeries,
  nextNovelSeries,
  novelSeries,
  novelViewerData,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import {
  downloadEntireMangaSeries,
  downloadEntireNovelSeries,
} from "../../../../../../Pix-Scripting/src/downloader/seriesDownloader"
import { imageUrlOf, loadImage } from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedWatchlist,
  onWatchlistChanged,
  recordWatchlist,
} from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import {
  describeSeriesOffline,
  saveNovelSeriesOffline,
} from "../../../../../../Pix-Scripting/src/store/novelSeriesOffline"
import { buildOfflineImageTasks } from "../../../../../../Pix-Scripting/src/ui/novelOfflineCapture"
import { parseNovelToChunks } from "../novel/novelHtmlBuilder"
import type {
  PixivIllustration,
  PixivIllustrationSeriesDetail,
  PixivIllustrationSeriesItem,
  PixivNovel,
  PixivNovelSeriesDetail,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ErrorView,
  HeaderIconButton,
  IllustMasonryFeed,
  LoadingView,
  NovelFeedList,
  PixAvatar,
  PixImage,
  ScreenHeader,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"
import { copyToClipboard, shareItems, stripHtmlToText } from "./mediaHelpers"

function mapSeriesItemToIllust(
  item: PixivIllustrationSeriesItem,
  seriesDetail: PixivIllustrationSeriesDetail | null,
): PixivIllustration {
  return {
    id: item.id,
    title: item.title,
    type: item.illust_type === "ugoira" ? "ugoira" : item.illust_type === "illust" ? "illust" : "manga",
    image_urls: item.image_urls ?? {},
    caption: item.caption ?? "",
    user: item.user ??
      seriesDetail?.user ?? {
        id: 0,
        name: "",
        account: "",
      },
    tags: item.tags ?? [],
    create_date: item.create_date ?? "",
    page_count: item.page_count || 1,
    width: item.width || 800,
    height: item.height || 1000,
    x_restrict: item.x_restrict ?? 0,
    series: seriesDetail ? { id: seriesDetail.id, title: seriesDetail.title } : null,
    meta_single_page: item.meta_single_page,
    meta_pages: item.meta_pages ?? [],
    total_view: item.total_view ?? 0,
    total_bookmarks: item.total_bookmarks ?? 0,
    is_bookmarked: Boolean(item.is_bookmarked),
    is_muted: Boolean(item.is_muted),
    illust_ai_type: item.illust_ai_type ?? 1,
    total_comments: item.total_comments ?? 0,
    comment_access_control: item.comment_access_control ?? 0,
  }
}

export function SeriesDetailScreen({
  kind,
  seriesID,
}: {
  kind: "manga" | "novel"
  seriesID: number
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [mangaDetail, setMangaDetail] = useState<PixivIllustrationSeriesDetail | null>(null)
  const [novelDetail, setNovelDetail] = useState<PixivNovelSeriesDetail | null>(null)
  const [mangaItems, setMangaItems] = useState<PixivIllustration[]>([])
  const [novelItems, setNovelItems] = useState<PixivNovel[]>([])
  const [nextURL, setNextURL] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  const [ascending, setAscending] = useState(true)
  const [watched, setWatched] = useState<boolean>(
    () => getCachedWatchlist(seriesID, kind) ?? false,
  )
  const [watchBusy, setWatchBusy] = useState(false)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const offlineStopRef = useRef(false)
  const [offlineRunning, setOfflineRunning] = useState(false)

  const loadSeries = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      setLoadMoreError(null)
      try {
        if (kind === "manga") {
          const res = await session.call((token) => illustrationSeries(seriesID, token))
          const det = res?.illust_series_detail ?? null
          setMangaDetail(det)
          const rawList = Array.isArray(res?.illusts) ? res.illusts : []
          setMangaItems(rawList.map((it) => mapSeriesItemToIllust(it, det)))
          setNextURL(res?.next_url ?? null)
          if (det) {
            const w = Boolean(det.is_watched ?? det.watchlist_added)
            recordWatchlist(seriesID, "manga", w)
            setWatched(getCachedWatchlist(seriesID, "manga") ?? w)
          }
        } else {
          const res = await session.call((token) => novelSeries(seriesID, token))
          const det = res?.novel_series_detail ?? null
          setNovelDetail(det)
          setNovelItems(Array.isArray(res?.novels) ? res.novels : [])
          setNextURL(res?.next_url ?? null)
          if (det) {
            const w = Boolean(det.is_watched ?? det.watchlist_added)
            recordWatchlist(seriesID, "novel", w)
            setWatched(getCachedWatchlist(seriesID, "novel") ?? w)
          }
        }
      } catch (err: any) {
        setError(err?.message ?? "加载系列详情失败")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [kind, seriesID],
  )

  useEffect(() => {
    void loadSeries(false)
    return () => {
      offlineStopRef.current = true
    }
  }, [loadSeries])

  useEffect(() => {
    return onWatchlistChanged((id, k, next) => {
      if (id === seriesID && k === kind) setWatched(next)
    })
  }, [kind, seriesID])

  const loadMore = useCallback(async () => {
    if (!nextURL || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      if (kind === "manga") {
        const res = await session.call((token) => nextIllustrationSeries(nextURL, token))
        const incoming = (res?.illusts ?? []).map((it) => mapSeriesItemToIllust(it, mangaDetail))
        setMangaItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          return [...prev, ...incoming.filter((x) => !seen.has(x.id))]
        })
        setNextURL(res?.next_url ?? null)
      } else {
        const res = await session.call((token) => nextNovelSeries(nextURL, token))
        const incoming = res?.novels ?? []
        setNovelItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          return [...prev, ...incoming.filter((x) => !seen.has(x.id))]
        })
        setNextURL(res?.next_url ?? null)
      }
    } catch (err: any) {
      setLoadMoreError(err?.message ?? "加载更多话数失败")
    } finally {
      setLoadingMore(false)
    }
  }, [kind, loadingMore, mangaDetail, nextURL])

  const toggleWatchlist = useCallback(async () => {
    if (watchBusy) return
    const next = !watched
    setWatched(next)
    setWatchBusy(true)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      await session.call((token) =>
        next
          ? addWatchlistSeries(seriesID, kind, token)
          : deleteWatchlistSeries(seriesID, kind, token),
      )
      overlay.showToast(next ? "已加入追更清单" : "已移出追更清单", "success")
    } catch (err: any) {
      setWatched(!next)
      overlay.showToast(err?.message ?? "追更操作失败", "error")
    } finally {
      setWatchBusy(false)
    }
  }, [kind, overlay, seriesID, watchBusy, watched])

  const detailTitle =
    (kind === "manga" ? mangaDetail?.title : novelDetail?.title) ||
    (kind === "manga" ? `漫画系列 #${seriesID}` : `小说系列 #${seriesID}`)
  const detailAuthor = kind === "manga" ? mangaDetail?.user : novelDetail?.user
  const detailCaption = stripHtmlToText(
    kind === "manga" ? mangaDetail?.caption : novelDetail?.caption,
  )
  const coverUrl =
    kind === "manga"
      ? mangaDetail?.cover_image_urls?.large || mangaDetail?.cover_image_urls?.medium
      : novelDetail?.cover_image_urls?.large || novelDetail?.cover_image_urls?.medium
  const totalCount =
    kind === "manga"
      ? mangaDetail?.series_work_count ?? mangaItems.length
      : novelDetail?.content_count ?? novelItems.length
  const isConcluded = Boolean(
    kind === "manga" ? mangaDetail?.is_concluded : novelDetail?.is_concluded,
  )

  const runSaveNovelSeriesOffline = useCallback(async () => {
    if (offlineRunning || taskStatus) return
    offlineStopRef.current = false
    setOfflineRunning(true)
    setTaskStatus("正在拉取系列完整目录…")
    try {
      // Gather full series episode list first
      const allNovels: PixivNovel[] = [...novelItems]
      let cursor = nextURL
      const seen = new Set(allNovels.map((n) => n.id))
      while (cursor && !offlineStopRef.current) {
        const nextCursor = cursor
        const page = await session.call((token) => nextNovelSeries(nextCursor, token))
        for (const item of page?.novels ?? []) {
          if (!seen.has(item.id)) {
            seen.add(item.id)
            allNovels.push(item)
          }
        }
        cursor = page?.next_url ?? null
      }

      if (allNovels.length === 0) {
        overlay.showToast("没有可离线保存的章节", "info")
        return
      }

      const result = await saveNovelSeriesOffline({
        seriesId: seriesID,
        title: detailTitle,
        expectedEpisodeCount: novelDetail?.content_count ?? allNovels.length,
        episodes: allNovels.map((n, i) => ({
          novelId: n.id,
          title: n.title,
          episodeNumber: n.episode_number ?? i + 1,
        })),
        fetchEpisode: async (ep) => {
          const item = allNovels.find((n) => n.id === ep.novelId)
          const viewer = await session.call((token) => novelViewerData(ep.novelId, token))
          if (!viewer?.text?.trim()) return null
          const chunks = parseNovelToChunks(viewer.text, viewer.textEmbeddedImages)
          const imageTasks = await buildOfflineImageTasks({
            chunks,
            embeddedImages: viewer.textEmbeddedImages,
            resolveIllustUrl: async (illustId, page) => {
              const det = await session.call((token) => illustrationDetail(illustId, token))
              return imageUrlOf(det, page, "large")
            },
          })
          return {
            text: viewer.text,
            title: viewer.title || item?.title,
            author: item?.user?.name,
            caption: item?.caption ?? null,
            coverUrl: viewer.coverUrl || item?.image_urls?.large || item?.image_urls?.medium || null,
            tags: (item?.tags ?? []).map((t) => t.name),
            imageTasks,
          }
        },
        loadBytes: (url) => loadImage(url, 30),
        shouldStop: () => offlineStopRef.current,
        onProgress: (_done, _total, msg) => setTaskStatus(msg),
      })

      overlay.showToast(describeSeriesOffline(result), result.complete ? "success" : "info")
    } catch (err: any) {
      overlay.showToast(err?.message ?? "离线保存失败", "error")
    } finally {
      setOfflineRunning(false)
      setTaskStatus(null)
    }
  }, [detailTitle, nextURL, novelDetail?.content_count, novelItems, offlineRunning, overlay, seriesID, taskStatus])

  const openDownloadMenu = useCallback(async () => {
    if (taskStatus) return
    if (kind === "manga") {
      const choice = await overlay.presentActionSheet({
        title: `下载漫画系列 · ${detailTitle}`,
        actions: [
          { label: "整本导出为 CBZ 漫画包" },
          { label: "整本导出为 EPUB 电子书" },
          { label: "分享系列链接" },
        ],
      })
      if (choice == null) return
      if (choice === 2) {
        const url = mangaDetail?.url || `https://www.pixiv.net/user/${detailAuthor?.id ?? 0}/series/${seriesID}`
        await shareItems([url])
        return
      }
      const fmt = choice === 0 ? "cbz" : "epub"
      setTaskStatus(`正在导出漫画系列 (${fmt.toUpperCase()})…`)
      try {
        const out = await downloadEntireMangaSeries(seriesID, detailTitle, fmt, (msg) =>
          setTaskStatus(msg),
        )
        overlay.showToast(
          out ? `漫画系列 ${fmt.toUpperCase()} 导出完成` : "导出未完成",
          out ? "success" : "error",
        )
      } catch (err: any) {
        overlay.showToast(err?.message ?? "系列导出失败", "error")
      } finally {
        setTaskStatus(null)
      }
    } else {
      const choice = await overlay.presentActionSheet({
        title: `小说系列导出与离线 · ${detailTitle}`,
        actions: [
          { label: "整本保存至离线书库" },
          { label: "整本导出为原版 EPUB 电子书" },
          { label: "整本导出为已译文 EPUB 电子书" },
          { label: "分享系列链接" },
          { label: "复制系列 ID" },
        ],
      })
      if (choice == null) return
      if (choice === 0) {
        void runSaveNovelSeriesOffline()
      } else if (choice === 1 || choice === 2) {
        const mode = choice === 1 ? "original" : "translated"
        setTaskStatus(mode === "translated" ? "正在导出系列译文 EPUB…" : "正在导出系列 EPUB…")
        try {
          const out = await downloadEntireNovelSeries(
            seriesID,
            detailTitle,
            (msg) => setTaskStatus(msg),
            { mode },
          )
          overlay.showToast(
            out ? "小说系列 EPUB 导出完成" : "导出未完成",
            out ? "success" : "error",
          )
        } catch (err: any) {
          overlay.showToast(err?.message ?? "EPUB 导出失败", "error")
        } finally {
          setTaskStatus(null)
        }
      } else if (choice === 3) {
        await shareItems([`https://www.pixiv.net/novel/series/${seriesID}`])
      } else if (choice === 4) {
        await copyToClipboard(String(seriesID))
        overlay.showToast(`已复制系列 ID: ${seriesID}`, "success")
      }
    }
  }, [detailAuthor?.id, detailTitle, kind, mangaDetail?.url, overlay, runSaveNovelSeriesOffline, seriesID, taskStatus])

  const displayedManga = useMemo(
    () => (ascending ? mangaItems : [...mangaItems].reverse()),
    [ascending, mangaItems],
  )
  const displayedNovels = useMemo(
    () => (ascending ? novelItems : [...novelItems].reverse()),
    [ascending, novelItems],
  )

  const headerComponent = (
    <View style={styles.headerWrap}>
      {taskStatus ? (
        <View style={[styles.taskBanner, { backgroundColor: accentSoft }]}>
          <ActivityIndicator size="small" color={accent} />
          <Text style={[styles.taskBannerText, { color: accent }]} numberOfLines={2}>
            {taskStatus}
          </Text>
          {offlineRunning ? (
            <Pressable
              onPress={() => {
                offlineStopRef.current = true
              }}
              style={[styles.stopBtn, { backgroundColor: colors.danger }]}
            >
              <Text style={styles.stopBtnText}>停止</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.heroCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.heroTop}>
          {coverUrl ? (
            <PixImage url={coverUrl} borderRadius={10} style={styles.cover} />
          ) : null}
          <View style={styles.heroMeta}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: accentSoft }]}>
                <Text style={[styles.badgeText, { color: accent }]}>
                  {kind === "manga" ? "漫画系列" : "小说系列"}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.fill }]}>
                <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                  共 {totalCount} 话 · {isConcluded ? "已完结" : "连载中"}
                </Text>
              </View>
            </View>

            <Text style={[styles.heroTitle, { color: colors.text }]}>{detailTitle}</Text>

            {detailAuthor ? (
              <Pressable
                onPress={() => nav.push({ name: "user", id: detailAuthor.id, seed: detailAuthor })}
                style={styles.authorRow}
              >
                <PixAvatar
                  url={detailAuthor.profile_image_urls?.medium}
                  name={detailAuthor.name}
                  size={24}
                />
                <Text style={[styles.authorName, { color: colors.textSecondary }]} numberOfLines={1}>
                  {detailAuthor.name}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {detailCaption ? (
          <Text style={[styles.caption, { color: colors.textSecondary }]}>{detailCaption}</Text>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            onPress={() => void toggleWatchlist()}
            disabled={watchBusy}
            style={[
              styles.actionBtn,
              {
                backgroundColor: watched ? colors.fill : accent,
                borderColor: watched ? colors.glassBorder : accent,
              },
            ]}
          >
            <Text style={[styles.actionBtnText, { color: watched ? colors.text : "#FFFFFF" }]}>
              {watched ? "✓ 已追更" : "+ 追更"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              try {
                triggerHaptic("selection")
              } catch {}
              setAscending((v) => !v)
            }}
            style={[
              styles.secondaryBtn,
              { backgroundColor: colors.fill, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
              {ascending ? "↑ 正序" : "↓ 倒序"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void openDownloadMenu()}
            disabled={Boolean(taskStatus)}
            style={[
              styles.secondaryBtn,
              { backgroundColor: colors.fill, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>↓ 整本导出</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={detailTitle}
        subtitle={kind === "manga" ? "漫画系列" : "小说系列"}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={<HeaderIconButton label="导出" onPress={() => void openDownloadMenu()} />}
      />

      {loading && mangaItems.length === 0 && novelItems.length === 0 ? (
        <LoadingView message="正在加载系列目录…" />
      ) : error && mangaItems.length === 0 && novelItems.length === 0 ? (
        <ErrorView message={error} onRetry={() => void loadSeries(false)} />
      ) : kind === "manga" ? (
        <IllustMasonryFeed
          items={displayedManga}
          loading={loading}
          refreshing={refreshing}
          loadingMore={loadingMore}
          error={error}
          loadMoreError={loadMoreError}
          hasMore={Boolean(nextURL)}
          onRefresh={() => void loadSeries(true)}
          onLoadMore={() => void loadMore()}
          emptyTitle="该漫画系列暂无公开话数"
          ListHeaderComponent={headerComponent}
        />
      ) : (
        <NovelFeedList
          items={displayedNovels}
          loading={loading}
          refreshing={refreshing}
          loadingMore={loadingMore}
          error={error}
          loadMoreError={loadMoreError}
          hasMore={Boolean(nextURL)}
          onRefresh={() => void loadSeries(true)}
          onLoadMore={() => void loadMore()}
          emptyTitle="该小说系列暂无公开章节"
          ListHeaderComponent={headerComponent}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
  },
  taskBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  taskBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  stopBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  stopBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  heroCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  heroTop: {
    flexDirection: "row",
    gap: 12,
  },
  cover: {
    width: 78,
    height: 108,
  },
  heroMeta: {
    flex: 1,
    gap: 6,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 23,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 2,
  },
  authorName: {
    fontSize: 13,
    fontWeight: "600",
  },
  caption: {
    fontSize: 13,
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
})
