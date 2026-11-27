import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  bookmarks,
  bookmarkTags,
  nextIllustrations,
  nextNovels,
  novelBookmarkTags,
  userNovelBookmarks,
  type Visibility,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  onIllustBookmarkChanged,
  onNovelBookmarkChanged,
} from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import {
  loadPixivisionBookmarks,
  onPixivisionBookmarksChanged,
  removePixivisionBookmark,
  type PixivisionBookmarkItem,
} from "../../../../../../Pix-Scripting/src/store/pixivisionBookmarks"
import { loadSettings } from "../../../../../../Pix-Scripting/src/store/settings"
import type {
  PixivBookmarkTag,
  PixivIllustration,
  PixivNovel,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  EmptyView,
  HeaderIconButton,
  IllustMasonryFeed,
  NovelFeedList,
  PixImage,
  ScreenHeader,
  SegmentedControl,
  ThemedTextInput,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

type LibraryKind = "illustration" | "novel" | "pixivision"
type SortDirection = "desc" | "asc"

function BookmarkTagPickerSheet({
  kind,
  restrict,
  selectedTag,
  onSelect,
  onClose,
}: {
  kind: "illustration" | "novel"
  restrict: Visibility
  selectedTag: string | null
  onSelect: (tag: string | null) => void
  onClose: () => void
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()

  const [tags, setTags] = useState<PixivBookmarkTag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const uid = session.userID
    if (!uid) {
      setLoading(false)
      setError("未登录")
      return
    }
    void session
      .call((token) =>
        kind === "illustration"
          ? bookmarkTags(uid, restrict, token)
          : novelBookmarkTags(restrict, token),
      )
      .then((page) => {
        if (!active) return
        setTags(page.items ?? [])
      })
      .catch((e: any) => {
        if (!active) return
        setError(e?.message ?? "加载收藏标签失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [kind, restrict])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, query])

  function choose(tag: string | null) {
    onSelect(tag)
    onClose()
  }

  return (
    <View style={styles.sheetWrap}>
      <View style={styles.sheetSearch}>
        <ThemedTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索收藏标签…"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: effectiveBottomInset(insets) + 24,
          gap: 6,
        }}
      >
        <Pressable
          onPress={() => choose(null)}
          style={[
            styles.tagOption,
            {
              backgroundColor: selectedTag === null ? accentSoft : colors.surface,
              borderColor: selectedTag === null ? accent : colors.glassBorder,
            },
          ]}
        >
          <Text
            style={[
              styles.tagOptionLabel,
              { color: selectedTag === null ? accent : colors.text },
            ]}
          >
            全部收藏（不限标签）
          </Text>
          {selectedTag === null ? <Text style={{ color: accent, fontWeight: "700" }}>✓</Text> : null}
        </Pressable>

        <Pressable
          onPress={() => choose("未分類")}
          style={[
            styles.tagOption,
            {
              backgroundColor: selectedTag === "未分類" ? accentSoft : colors.surface,
              borderColor: selectedTag === "未分類" ? accent : colors.glassBorder,
            },
          ]}
        >
          <Text
            style={[
              styles.tagOptionLabel,
              { color: selectedTag === "未分類" ? accent : colors.text },
            ]}
          >
            未分类 (未分類)
          </Text>
          {selectedTag === "未分類" ? <Text style={{ color: accent, fontWeight: "700" }}>✓</Text> : null}
        </Pressable>

        {loading ? (
          <View style={styles.sheetCenter}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={[styles.sheetHint, { color: colors.textSecondary }]}>正在加载标签…</Text>
          </View>
        ) : error ? (
          <Text style={[styles.sheetHint, { color: colors.danger, padding: 12 }]}>{error}</Text>
        ) : filtered.length === 0 ? (
          <Text style={[styles.sheetHint, { color: colors.textSecondary, padding: 12 }]}>
            {tags.length === 0 ? "当前可见性下暂无自定义收藏标签" : "没有匹配的标签"}
          </Text>
        ) : (
          filtered.map((item) => {
            const active = selectedTag === item.name
            return (
              <Pressable
                key={item.name}
                onPress={() => choose(item.name)}
                style={[
                  styles.tagOption,
                  {
                    backgroundColor: active ? accentSoft : colors.surface,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tagOptionLabel,
                    { color: active ? accent : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  #{item.name}
                </Text>
                <Text style={[styles.tagCount, { color: colors.textSecondary }]}>
                  {item.count}
                </Text>
              </Pressable>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

export function LibraryScreen({
  initialKind = "illustration",
}: {
  initialKind?: LibraryKind
}) {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [kind, setKind] = useState<LibraryKind>(initialKind)
  const [restrict, setRestrict] = useState<Visibility>("public")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>("desc")
  const [pvItems, setPvItems] = useState<PixivisionBookmarkItem[]>(() =>
    loadPixivisionBookmarks(),
  )

  const uid = session.userID ?? 0

  useEffect(() => {
    setPvItems(loadPixivisionBookmarks())
    return onPixivisionBookmarksChanged(() => {
      setPvItems(loadPixivisionBookmarks())
    })
  }, [])

  const illustFeed = usePixivFeed<PixivIllustration>({
    enabled: kind === "illustration" && uid > 0,
    fetcher: useCallback(
      (token: string) => bookmarks(uid, restrict, selectedTag, token),
      [uid, restrict, selectedTag],
    ),
    fetchMore: nextIllustrations,
    keyOf: (item) => item.id,
    filter: useCallback((items: PixivIllustration[]) => {
      const s = loadSettings()
      return items.filter((it) =>
        isIllustContentVisible(it, s, undefined, {
          exemptRestrictions: s.exemptFilterForPersonal,
        }),
      )
    }, []),
    deps: [uid, restrict, selectedTag],
  })

  const novelFeed = usePixivFeed<PixivNovel>({
    enabled: kind === "novel" && uid > 0,
    fetcher: useCallback(
      (token: string) => userNovelBookmarks(uid, restrict, selectedTag, token),
      [uid, restrict, selectedTag],
    ),
    fetchMore: nextNovels,
    keyOf: (item) => item.id,
    filter: useCallback((items: PixivNovel[]) => {
      const s = loadSettings()
      return items.filter((it) =>
        isNovelContentVisible(it, s, undefined, {
          exemptRestrictions: s.exemptFilterForPersonal,
        }),
      )
    }, []),
    deps: [uid, restrict, selectedTag],
  })

  // Keep lists synchronized when user unbookmarks inside detail screen
  useEffect(() => {
    return onIllustBookmarkChanged((illustId, bookmarked) => {
      if (!bookmarked) {
        illustFeed.setRawItems((prev) => prev.filter((item) => item.id !== illustId))
      }
    })
  }, [illustFeed.setRawItems])

  useEffect(() => {
    return onNovelBookmarkChanged((novelId, bookmarked) => {
      if (!bookmarked) {
        novelFeed.setRawItems((prev) => prev.filter((item) => item.id !== novelId))
      }
    })
  }, [novelFeed.setRawItems])

  const displayedIllusts = useMemo(
    () => (sortDir === "asc" ? [...illustFeed.items].reverse() : illustFeed.items),
    [illustFeed.items, sortDir],
  )

  const displayedNovels = useMemo(
    () => (sortDir === "asc" ? [...novelFeed.items].reverse() : novelFeed.items),
    [novelFeed.items, sortDir],
  )

  const displayedPixivision = useMemo(
    () => (sortDir === "asc" ? [...pvItems].reverse() : pvItems),
    [pvItems, sortDir],
  )

  const kindChips = useMemo<ChipItem<LibraryKind>[]>(() => {
    const list: ChipItem<LibraryKind>[] = [
      { value: "illustration", label: "插画·漫画" },
    ]
    if (!settings.hideNovels || initialKind === "novel") {
      list.push({ value: "novel", label: "小说" })
    }
    list.push({ value: "pixivision", label: "特辑", badge: pvItems.length || undefined })
    return list
  }, [settings.hideNovels, initialKind, pvItems.length])

  function openTagSheet() {
    if (kind === "pixivision") return
    const targetKind = kind
    overlay.presentSheet({
      id: `library-tags-${targetKind}-${restrict}`,
      title: targetKind === "illustration" ? "插画收藏标签筛选" : "小说收藏标签筛选",
      fullHeight: true,
      render: (close) => (
        <BookmarkTagPickerSheet
          kind={targetKind}
          restrict={restrict}
          selectedTag={selectedTag}
          onSelect={(next) => setSelectedTag(next)}
          onClose={close}
        />
      ),
    })
  }

  function toggleSort() {
    setSortDir((prev) => (prev === "desc" ? "asc" : "desc"))
    try {
      triggerHaptic("selection")
    } catch {}
  }

  async function handleRemovePixivision(item: PixivisionBookmarkItem) {
    const ok = await overlay.confirm({
      title: "取消收藏特辑",
      message: `确定从收藏中移除「${item.title}」吗？`,
      confirmLabel: "移除",
      destructive: true,
    })
    if (!ok) return
    removePixivisionBookmark(item.id)
    overlay.showToast("已取消收藏特辑", "info")
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="我的收藏"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          <HeaderIconButton
            label={sortDir === "desc" ? "最新↓" : "最早↑"}
            onPress={toggleSort}
          />
        }
        bottom={
          <View>
            <ChipBar<LibraryKind>
              items={kindChips}
              selected={kind}
              onSelect={(next) => {
                setKind(next)
                setSelectedTag(null)
              }}
            />
            {kind !== "pixivision" ? (
              <View style={styles.filterRow}>
                <View style={styles.visSeg}>
                  <SegmentedControl<Visibility>
                    value={restrict}
                    onChange={(next) => {
                      setRestrict(next)
                      setSelectedTag(null)
                    }}
                    options={[
                      { value: "public", label: "公开" },
                      { value: "private", label: "私密" },
                    ]}
                  />
                </View>
                <Pressable
                  onPress={openTagSheet}
                  style={[
                    styles.tagBtn,
                    {
                      backgroundColor: selectedTag ? accentSoft : colors.fill,
                      borderColor: selectedTag ? accent : colors.glassBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagBtnText,
                      { color: selectedTag ? accent : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {selectedTag ? `#${selectedTag}` : "标签筛选 ▾"}
                  </Text>
                </Pressable>
                {selectedTag ? (
                  <Pressable
                    onPress={() => setSelectedTag(null)}
                    hitSlop={8}
                    style={[styles.clearTagBtn, { backgroundColor: colors.fill }]}
                  >
                    <Text style={[styles.clearTagText, { color: colors.textSecondary }]}>✕</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        }
      />

      {kind === "illustration" ? (
        <IllustMasonryFeed
          items={displayedIllusts}
          loading={illustFeed.loading}
          refreshing={illustFeed.refreshing}
          loadingMore={illustFeed.loadingMore}
          error={illustFeed.error}
          loadMoreError={illustFeed.loadMoreError}
          hasMore={illustFeed.hasMore}
          emptyTitle={selectedTag ? `标签「${selectedTag}」下暂无收藏` : "暂无插画收藏"}
          emptySubtitle={restrict === "private" ? "当前查看的是私密收藏" : undefined}
          bottomPadding={effectiveBottomInset(insets) + 28}
          onRefresh={() => void illustFeed.refresh()}
          onLoadMore={() => void illustFeed.loadMore()}
        />
      ) : kind === "novel" ? (
        <NovelFeedList
          items={displayedNovels}
          loading={novelFeed.loading}
          refreshing={novelFeed.refreshing}
          loadingMore={novelFeed.loadingMore}
          error={novelFeed.error}
          loadMoreError={novelFeed.loadMoreError}
          hasMore={novelFeed.hasMore}
          emptyTitle={selectedTag ? `标签「${selectedTag}」下暂无小说收藏` : "暂无小说收藏"}
          bottomPadding={effectiveBottomInset(insets) + 28}
          onRefresh={() => void novelFeed.refresh()}
          onLoadMore={() => void novelFeed.loadMore()}
        />
      ) : (
        <FlashList
          data={displayedPixivision}
          estimatedItemSize={106}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: effectiveBottomInset(insets) + 28,
          }}
          ListEmptyComponent={
            <EmptyView title="暂无特辑收藏" subtitle="在 Pixivision 特辑详情页点击收藏即可保存在此处。" />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => nav.push({ name: "pixivision", id: item.id })}
              style={[
                styles.pvCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              {item.thumbnailURL ? (
                <PixImage url={item.thumbnailURL} borderRadius={10} style={styles.pvThumb} />
              ) : (
                <View style={[styles.pvThumb, { backgroundColor: colors.fill, borderRadius: 10 }]} />
              )}
              <View style={styles.pvBody}>
                <Text style={[styles.pvTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[styles.pvMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.categoryLabel || item.category || "Pixivision"}
                  {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => void handleRemovePixivision(item)}
                hitSlop={8}
                style={[styles.pvRemoveBtn, { backgroundColor: `${colors.danger}16` }]}
              >
                <Text style={[styles.pvRemoveText, { color: colors.danger }]}>移除</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  visSeg: {
    width: 136,
  },
  tagBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  tagBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  clearTagBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  clearTagText: {
    fontSize: 13,
    fontWeight: "700",
  },
  sheetWrap: {
    flex: 1,
  },
  sheetSearch: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetCenter: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
  },
  sheetHint: {
    fontSize: 13,
    textAlign: "center",
  },
  tagOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  tagOptionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  tagCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  pvCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  pvThumb: {
    width: 96,
    height: 68,
  },
  pvBody: {
    flex: 1,
    gap: 4,
  },
  pvTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  pvMeta: {
    fontSize: 12,
  },
  pvRemoveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pvRemoveText: {
    fontSize: 12,
    fontWeight: "600",
  },
})
