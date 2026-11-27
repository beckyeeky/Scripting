import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  nextNovelMarkers,
  nextNovels,
  novelMarkers,
  userNovelBookmarks,
  type Visibility,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { exportNovelToEpub } from "../../../../../../Pix-Scripting/src/downloader/epubExporter"
import { exportNovelToText } from "../../../../../../Pix-Scripting/src/downloader/novelTextExporter"
import { buildNovelPlainTextDocument } from "../../../../../../Pix-Scripting/src/store/novelExport"
import {
  listOfflineEpisodes,
  readOfflineEpisode,
  removeOfflineEpisode,
  type OfflineEpisodeSummary,
} from "../../../../../../Pix-Scripting/src/store/novelOfflineLibrary"
import {
  getNovelProgress,
  hasNovelReadingProgress,
  onNovelProgressChanged,
} from "../../../../../../Pix-Scripting/src/store/novelProgress"
import type { PixivNovel, PixivNovelMarker } from "../../../../../../Pix-Scripting/src/types"
import { ScriptingShareSheet } from "../../../scripting/hostGlobals"
import {
  ChipBar,
  EmptyView,
  formatWordCount,
  NovelFeedList,
  ScreenHeader,
  SegmentedControl,
  ThemedTextInput,
  usePixivFeed,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

type LibraryTab = "offline" | "markers" | "bookmarks"

export function NovelLibraryScreen() {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [tab, setTab] = useState<LibraryTab>("offline")
  const [offlineList, setOfflineList] = useState<OfflineEpisodeSummary[]>(() =>
    listOfflineEpisodes(),
  )
  const [offlineFilter, setOfflineFilter] = useState<"all" | "reading">("all")
  const [offlineQuery, setOfflineQuery] = useState("")
  const [bookmarkVisibility, setBookmarkVisibility] = useState<Visibility>("public")

  const reloadOffline = useCallback(() => {
    setOfflineList(listOfflineEpisodes().sort((a, b) => (b.lastAccessAt || b.savedAt) - (a.lastAccessAt || a.savedAt)))
  }, [])

  useEffect(() => {
    reloadOffline()
    return onNovelProgressChanged(() => reloadOffline())
  }, [reloadOffline])

  const markerFeed = usePixivFeed<PixivNovelMarker>({
    enabled: tab === "markers",
    deps: [],
    fetcher: (token) => novelMarkers(token),
    fetchMore: (nextURL, token) => nextNovelMarkers(nextURL, token),
    keyOf: (item) => item.novel.id,
  })

  const bookmarkFeed = usePixivFeed<PixivNovel>({
    enabled: tab === "bookmarks" && Boolean(session.userID),
    deps: [bookmarkVisibility],
    fetcher: (token) =>
      userNovelBookmarks(session.userID ?? 0, bookmarkVisibility, null, token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
    keyOf: (item) => item.id,
  })

  const markerNovels = useMemo<PixivNovel[]>(
    () =>
      markerFeed.items.map((m) => ({
        ...m.novel,
        novel_marker: m.novel_marker,
      })),
    [markerFeed.items],
  )

  const filteredOffline = useMemo(() => {
    const q = offlineQuery.trim().toLowerCase()
    return offlineList.filter((ep) => {
      if (offlineFilter === "reading" && !hasNovelReadingProgress(ep.novelId)) return false
      if (q) {
        const hay = `${ep.title} ${ep.author || ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [offlineFilter, offlineList, offlineQuery])

  const openOfflineReader = useCallback(
    (summary: OfflineEpisodeSummary) => {
      const rec = readOfflineEpisode(summary.novelId)
      if (!rec || !rec.text) {
        overlay.showToast("离线正文文件不存在或已损坏", "error")
        return
      }
      nav.push({
        name: "novelReader",
        novelId: rec.novelId,
        title: rec.title,
        caption: rec.caption ?? undefined,
        text: rec.text,
        coverUrl: rec.coverUrl ?? null,
        seriesId: rec.seriesId ?? null,
        episodeNumber: rec.episodeNumber ?? null,
      })
    },
    [nav, overlay],
  )

  const handleOfflineMenu = useCallback(
    async (summary: OfflineEpisodeSummary) => {
      const idx = await overlay.presentActionSheet({
        title: summary.title,
        actions: [
          { label: "离线阅读" },
          { label: "查看作品详情" },
          { label: "导出 EPUB" },
          { label: "导出 TXT" },
          { label: "删除离线缓存", destructive: true },
        ],
      })
      if (idx === 0) {
        openOfflineReader(summary)
      } else if (idx === 1) {
        nav.push({ name: "novel", id: summary.novelId })
      } else if (idx === 2 || idx === 3) {
        const rec = readOfflineEpisode(summary.novelId)
        if (!rec) return
        try {
          if (idx === 3) {
            const doc = buildNovelPlainTextDocument({
              title: rec.title,
              author: rec.author || "Pixiv",
              caption: rec.caption,
              text: rec.text,
            })
            const outPath = exportNovelToText({
              title: rec.title,
              author: rec.author || "Pixiv",
              content: doc,
            })
            if (outPath) await ScriptingShareSheet.present([outPath])
          } else {
            overlay.showToast("正在生成 EPUB…", "info")
            const epubPath = await exportNovelToEpub({
              id: rec.novelId,
              title: rec.title,
              author: rec.author || "Pixiv",
              description: rec.caption ?? undefined,
              coverUrl: rec.coverUrl ?? undefined,
              chapters: [{ id: rec.novelId, title: rec.title, text: rec.text }],
            })
            if (epubPath) await ScriptingShareSheet.present([epubPath])
          }
        } catch (err: any) {
          overlay.showToast(`导出失败：${err?.message ?? err}`, "error")
        }
      } else if (idx === 4) {
        const ok = await overlay.confirm({
          title: "删除离线小说",
          message: `确定删除《${summary.title}》的离线缓存吗？`,
          confirmLabel: "删除",
          destructive: true,
        })
        if (ok) {
          removeOfflineEpisode(summary.novelId)
          reloadOffline()
          overlay.showToast("已删除离线缓存", "info")
        }
      }
    },
    [nav, openOfflineReader, overlay, reloadOffline],
  )

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="小说书库"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        bottom={
          <View style={styles.tabWrap}>
            <SegmentedControl<LibraryTab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "offline", label: `离线 (${offlineList.length})` },
                { value: "markers", label: "阅读书签" },
                { value: "bookmarks", label: "收藏小说" },
              ]}
            />
          </View>
        }
      />

      {tab === "offline" ? (
        <View style={styles.flex}>
          <View style={styles.filterBar}>
            <ThemedTextInput
              value={offlineQuery}
              onChangeText={setOfflineQuery}
              placeholder="搜索离线标题或作者…"
              style={styles.searchInput}
            />
            <ChipBar
              compact={true}
              selected={offlineFilter}
              onSelect={(v) => setOfflineFilter(v as "all" | "reading")}
              items={[
                { value: "all", label: "全部" },
                { value: "reading", label: "在读" },
              ]}
            />
          </View>

          <ScrollView
            style={styles.flex}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={false}
                onRefresh={reloadOffline}
                tintColor={accent}
                colors={[accent]}
              />
            }
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingBottom: effectiveBottomInset(insets) + 28,
              gap: 10,
            }}
          >
            {filteredOffline.length === 0 ? (
              <EmptyView
                title={offlineList.length === 0 ? "暂无离线小说" : "未找到匹配的离线小说"}
                subtitle="在小说详情页或阅读器中点击「离线保存」即可断网畅读"
              />
            ) : (
              filteredOffline.map((ep) => {
                const prog = getNovelProgress(ep.novelId)
                return (
                  <Pressable
                    key={ep.novelId}
                    onPress={() => openOfflineReader(ep)}
                    onLongPress={() => void handleOfflineMenu(ep)}
                    style={({ pressed }) => [
                      styles.offlineCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.glassBorder,
                      },
                      pressed && { opacity: 0.74 },
                    ]}
                  >
                    <View
                      style={[
                        styles.offlineCover,
                        {
                          aspectRatio: 0.74,
                          borderRadius: 8,
                          backgroundColor: accentSoft,
                          alignItems: "center",
                          justifyContent: "center",
                          paddingHorizontal: 4,
                        },
                      ]}
                    >
                      <Text
                        style={{ color: accent, fontSize: 18, fontWeight: "700" }}
                        numberOfLines={1}
                      >
                        {(ep.title || "文").trim().slice(0, 1)}
                      </Text>
                      <Text
                        style={{ color: colors.textTertiary, fontSize: 9, marginTop: 2 }}
                        numberOfLines={1}
                      >
                        离线
                      </Text>
                    </View>
                    <View style={styles.offlineBody}>
                      <Text style={[styles.offlineTitle, { color: colors.text }]} numberOfLines={2}>
                        {ep.title}
                      </Text>
                      {ep.author ? (
                        <Text style={[styles.offlineSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          {ep.author}
                        </Text>
                      ) : null}
                      <View style={styles.offlineMetaRow}>
                        <Text style={[styles.offlineMeta, { color: colors.textTertiary }]}>
                          {formatWordCount(ep.bytes)} · {Math.max(1, ep.pageCount || 1)} 页
                        </Text>
                        {prog ? (
                          <View style={[styles.progPill, { backgroundColor: accentSoft }]}>
                            <Text style={[styles.progText, { color: accent }]}>
                              读至 P.{prog.page}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Pressable
                      onPress={() => void handleOfflineMenu(ep)}
                      hitSlop={10}
                      style={styles.moreBtn}
                    >
                      <Text style={{ color: colors.textSecondary, fontSize: 18 }}>⋯</Text>
                    </Pressable>
                  </Pressable>
                )
              })
            )}
          </ScrollView>
        </View>
      ) : tab === "markers" ? (
        <NovelFeedList
          items={markerNovels}
          loading={markerFeed.loading}
          refreshing={markerFeed.refreshing}
          loadingMore={markerFeed.loadingMore}
          error={markerFeed.error}
          loadMoreError={markerFeed.loadMoreError}
          hasMore={markerFeed.hasMore}
          emptyTitle="暂无云端阅读书签"
          emptySubtitle="在阅读器右上角点击「书签」可同步 Pixiv 阅读进度"
          onRefresh={markerFeed.refresh}
          onLoadMore={markerFeed.loadMore}
        />
      ) : (
        <View style={styles.flex}>
          <ChipBar
            selected={bookmarkVisibility}
            onSelect={(v) => setBookmarkVisibility(v as Visibility)}
            items={[
              { value: "public", label: "公开收藏" },
              { value: "private", label: "私密收藏" },
            ]}
          />
          <NovelFeedList
            items={bookmarkFeed.items}
            loading={bookmarkFeed.loading}
            refreshing={bookmarkFeed.refreshing}
            loadingMore={bookmarkFeed.loadingMore}
            error={bookmarkFeed.error}
            loadMoreError={bookmarkFeed.loadMoreError}
            hasMore={bookmarkFeed.hasMore}
            emptyTitle="暂无收藏小说"
            onRefresh={bookmarkFeed.refresh}
            onLoadMore={bookmarkFeed.loadMore}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  tabWrap: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  filterBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 2,
  },
  searchInput: {
    marginBottom: 2,
  },
  offlineCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  offlineCover: {
    width: 58,
  },
  offlineBody: {
    flex: 1,
    gap: 4,
  },
  offlineTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  offlineSub: {
    fontSize: 12,
  },
  offlineMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  offlineMeta: {
    fontSize: 11,
  },
  progPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  progText: {
    fontSize: 11,
    fontWeight: "700",
  },
  moreBtn: {
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
})
