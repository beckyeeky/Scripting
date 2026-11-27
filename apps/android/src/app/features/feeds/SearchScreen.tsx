import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  nextIllustrations,
  nextNovels,
  nextUsers,
  recommendedUsers,
  searchAutocomplete,
  searchIllustrations,
  searchNovels,
  searchUsers,
  trendingNovelTags,
  trendingTags,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import { isUserBlocked, loadBlocklist } from "../../../../../../Pix-Scripting/src/store/blocklist"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import {
  addSearchHistory,
  clearSearchHistory,
  getSearchHistoryEntries,
  onSearchHistoryChanged,
  recordTagTranslation,
  removeSearchHistory,
  type SearchHistoryEntry,
} from "../../../../../../Pix-Scripting/src/store/searchHistory"
import type {
  AdvancedSearchParams,
  PixivAutocompleteTag,
  PixivIllustration,
  PixivNovel,
  PixivTrendingTag,
  PixivUserPreview,
  SearchScope,
  SearchSort,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  EmptyView,
  ErrorView,
  IllustMasonryFeed,
  InlineFooterLoader,
  LoadingView,
  NovelFeedList,
  PixImage,
  UserPreviewRow,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { parseDeepLinkUrl, parseRouteString } from "../../navigation/routeParser"
import type { Route } from "../../navigation/types"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  getDefaultAdvancedSearchParams,
  SearchAdvancedSheet,
} from "./SearchAdvancedSheet"
import {
  formatMinTextLengthLabel,
  matchesMinTextLength,
} from "./novelLengthFilter"

const AUTOCOMPLETE_DEBOUNCE_MS = 280

interface DirectTarget {
  key: string
  title: string
  subtitle: string
  route: Route
}

function buildDirectTargets(
  input: string,
  scope: SearchScope,
  hideNovels: boolean,
): DirectTarget[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  // 1. Direct Pixiv / Pixivision URL detection
  if (/^https?:\/\//i.test(trimmed) || /^pixiv:\/\//i.test(trimmed) || /pixiv\.net|pixivision\.net/i.test(trimmed)) {
    const rawUrl = trimmed.startsWith("http") || trimmed.startsWith("pixiv:") ? trimmed : `https://${trimmed}`
    const routeStr = parseDeepLinkUrl(rawUrl)
    const parsed = routeStr ? parseRouteString(routeStr) : null
    if (parsed) {
      return [
        {
          key: `url-${trimmed}`,
          title: "打开链接对应页面",
          subtitle: trimmed,
          route: parsed,
        },
      ]
    }
  }

  // 2. Pure numeric ID jump ordered by active scope
  if (/^\d{1,12}$/.test(trimmed)) {
    const id = Number(trimmed)
    if (!Number.isFinite(id) || id <= 0) return []
    const illustItem: DirectTarget = {
      key: `illust-${id}`,
      title: "查看插画 / 漫画",
      subtitle: `PID ${id}`,
      route: { name: "illust", id },
    }
    const userItem: DirectTarget = {
      key: `user-${id}`,
      title: "访问创作者主页",
      subtitle: `UID ${id}`,
      route: { name: "user", id },
    }
    const novelItem: DirectTarget = {
      key: `novel-${id}`,
      title: "查看小说",
      subtitle: `NID ${id}`,
      route: { name: "novel", id },
    }

    if (scope === "novel" && !hideNovels) return [novelItem, illustItem, userItem]
    if (scope === "user") return hideNovels ? [userItem, illustItem] : [userItem, illustItem, novelItem]
    return hideNovels ? [illustItem, userItem] : [illustItem, userItem, novelItem]
  }

  return []
}

function trendingTagThumb(tag: PixivTrendingTag): string | null {
  return (
    tag.illust?.image_urls?.square_medium ??
    tag.illust?.image_urls?.medium ??
    tag.novel?.image_urls?.square_medium ??
    tag.novel?.image_urls?.medium ??
    null
  )
}

function extractActiveToken(text: string): { prefix: string; token: string } {
  if (!text) return { prefix: "", token: "" }
  const match = /^(.*[\s()（）|&+-])?([^\s()（）|&+-]+)$/u.exec(text)
  if (match) {
    return { prefix: match[1] ?? "", token: match[2] ?? "" }
  }
  return { prefix: "", token: text.trim() }
}

const SORT_LABELS: Record<SearchSort, string> = {
  date_desc: "最新",
  date_asc: "最旧",
  popular_desc: "热门",
  popular_male_desc: "男性向热门",
  popular_female_desc: "女性向热门",
}

function SearchIllustResults({
  params,
  queryVersion,
}: {
  params: AdvancedSearchParams
  queryVersion: number
}) {
  const { settings } = useAppTheme()

  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      showR18: params.includeR18 ?? settings.showR18,
      showR18G: params.includeR18G ?? settings.showR18G,
      showAI: params.includeAI ?? settings.showAI,
    }),
    [settings, params.includeR18, params.includeR18G, params.includeAI],
  )

  const feed = usePixivFeed<PixivIllustration>({
    fetcher: (token) =>
      searchIllustrations(
        {
          word: params.word,
          target: params.target || "partial_match_for_tags",
          sort: params.sort || "date_desc",
          aiFilter: effectiveSettings.showAI ? undefined : 1,
          startDate: params.useDateRange ? params.startDate : undefined,
          endDate: params.useDateRange ? params.endDate : undefined,
          bookmarkThreshold: params.bookmarkThreshold || undefined,
        },
        token,
      ),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => {
      const bl = loadBlocklist()
      return items.filter((item) => {
        if (params.mediaFilter !== "all" && item.type !== params.mediaFilter) {
          return false
        }
        return isIllustContentVisible(item, effectiveSettings, bl)
      })
    },
    deps: [
      params.word,
      params.target,
      params.sort,
      params.mediaFilter,
      params.bookmarkThreshold,
      params.useDateRange,
      params.startDate,
      params.endDate,
      effectiveSettings.showR18,
      effectiveSettings.showR18G,
      effectiveSettings.showAI,
      queryVersion,
    ],
  })

  return (
    <IllustMasonryFeed
      items={feed.items}
      loading={feed.loading}
      refreshing={feed.refreshing}
      loadingMore={feed.loadingMore}
      error={feed.error}
      loadMoreError={feed.loadMoreError}
      hasMore={feed.hasMore}
      emptyTitle={`未找到「${params.word}」相关作品`}
      emptySubtitle="尝试放宽收藏门槛、切换匹配范围或关闭时间限定"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function SearchNovelResults({
  params,
  queryVersion,
}: {
  params: AdvancedSearchParams
  queryVersion: number
}) {
  const { settings } = useAppTheme()

  const effectiveSettings = useMemo(
    () => ({
      ...settings,
      showR18: params.includeR18 ?? settings.showR18,
      showR18G: params.includeR18G ?? settings.showR18G,
      showAI: params.includeAI ?? settings.showAI,
    }),
    [settings, params.includeR18, params.includeR18G, params.includeAI],
  )

  const feed = usePixivFeed<PixivNovel>({
    fetcher: (token) =>
      searchNovels(
        {
          word: params.word,
          target: params.target || "partial_match_for_tags",
          sort: params.sort || "date_desc",
          aiFilter: effectiveSettings.showAI ? undefined : 1,
          startDate: params.useDateRange ? params.startDate : undefined,
          endDate: params.useDateRange ? params.endDate : undefined,
          bookmarkThreshold: params.bookmarkThreshold || undefined,
        },
        token,
      ),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => {
      const bl = loadBlocklist()
      return items.filter((item) => {
        if (!matchesMinTextLength(item.text_length, params.minTextLength)) return false
        return isNovelContentVisible(item, effectiveSettings, bl)
      })
    },
    deps: [
      params.word,
      params.target,
      params.sort,
      params.bookmarkThreshold,
      params.useDateRange,
      params.startDate,
      params.endDate,
      params.minTextLength,
      effectiveSettings.showR18,
      effectiveSettings.showR18G,
      effectiveSettings.showAI,
      queryVersion,
    ],
  })

  return (
    <NovelFeedList
      items={feed.items}
      loading={feed.loading}
      refreshing={feed.refreshing}
      loadingMore={feed.loadingMore}
      error={feed.error}
      loadMoreError={feed.loadMoreError}
      hasMore={feed.hasMore}
      emptyTitle={`未找到「${params.word}」相关小说`}
      emptySubtitle="尝试切换匹配范围或关闭长篇筛选"
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function SearchUserList({
  word,
  queryVersion,
}: {
  word: string | null
  queryVersion: number
}) {
  const { accent } = useAppTheme()
  const insets = useSafeInsets()

  const feed = usePixivFeed<PixivUserPreview>({
    fetcher: (token) => (word ? searchUsers(word, token) : recommendedUsers(token)),
    fetchMore: (nextURL, token) => nextUsers(nextURL, token),
    keyOf: (item) => item.user.id,
    filter: (items) => {
      const bl = loadBlocklist()
      return items.filter((item) => !isUserBlocked(item.user.id, bl.blockedUsers))
    },
    deps: [word ?? "__recommended_users__", queryVersion],
  })

  const renderItem = useCallback(
    ({ item }: { item: PixivUserPreview }) => <UserPreviewRow preview={item} />,
    [],
  )

  if (feed.loading && feed.items.length === 0) {
    return <LoadingView />
  }
  if (feed.error && feed.items.length === 0) {
    return <ErrorView message={feed.error} onRetry={() => void feed.refresh()} />
  }
  if (!feed.loading && feed.items.length === 0) {
    return (
      <EmptyView
        title={word ? `未找到匹配「${word}」的用户` : "暂无推荐创作者"}
        subtitle={word ? "请尝试其他昵称或直接输入数字 UID 跳转" : "下拉刷新重试"}
        actionLabel="刷新"
        onAction={() => void feed.refresh()}
      />
    )
  }

  return (
    <FlashList
      data={feed.items}
      keyExtractor={(item) => String(item.user.id)}
      renderItem={renderItem}
      estimatedItemSize={170}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: 10,
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
        if (feed.hasMore && !feed.loadingMore) void feed.loadMore()
      }}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        <InlineFooterLoader
          loading={feed.loadingMore}
          hasMore={feed.hasMore}
          error={feed.loadMoreError}
          onLoadMore={() => void feed.loadMore()}
        />
      }
    />
  )
}

export function SearchScreen() {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [scope, setScope] = useState<SearchScope>("illust")
  const [inputText, setInputText] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [submittedWord, setSubmittedWord] = useState<string | null>(null)
  const [queryVersion, setQueryVersion] = useState(0)
  const [advParams, setAdvParams] = useState<AdvancedSearchParams>(() =>
    getDefaultAdvancedSearchParams("illust", "", "all", settings),
  )

  const [history, setHistory] = useState<SearchHistoryEntry[]>(() =>
    getSearchHistoryEntries("illust"),
  )
  const [suggestions, setSuggestions] = useState<PixivAutocompleteTag[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  const [trendingIllust, setTrendingIllust] = useState<PixivTrendingTag[]>([])
  const [trendingNovel, setTrendingNovel] = useState<PixivTrendingTag[]>([])
  const [loadingTrending, setLoadingTrending] = useState(false)
  const [trendingError, setTrendingError] = useState<string | null>(null)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    if (settings.hideNovels && scope === "novel") {
      setScope("illust")
    }
  }, [settings.hideNovels, scope])

  useEffect(() => {
    setHistory(getSearchHistoryEntries(scope))
    return onSearchHistoryChanged(() => {
      setHistory(getSearchHistoryEntries(scope))
    })
  }, [scope])

  // Load trending tags for active scope when browsing discovery
  const loadTrending = useCallback(
    async (targetScope: "illust" | "novel") => {
      setLoadingTrending(true)
      setTrendingError(null)
      try {
        const list = await session.call((token) =>
          targetScope === "illust" ? trendingTags(token) : trendingNovelTags(token),
        )
        for (const t of list) {
          if (t.tag && t.translated_name) recordTagTranslation(t.tag, t.translated_name)
        }
        if (targetScope === "illust") setTrendingIllust(list)
        else setTrendingNovel(list)
      } catch (e: any) {
        setTrendingError(e?.message ?? "热门标签加载失败")
      } finally {
        setLoadingTrending(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (scope === "illust" && trendingIllust.length === 0) {
      void loadTrending("illust")
    } else if (scope === "novel" && trendingNovel.length === 0) {
      void loadTrending("novel")
    }
  }, [scope, trendingIllust.length, trendingNovel.length, loadTrending])

  // Debounced autocomplete while typing in illust/novel scope
  useEffect(() => {
    if (!isEditing || scope === "user") {
      setSuggestions([])
      return
    }
    const { token } = extractActiveToken(inputText)
    if (!token || /^\d+$/.test(token) || /^https?:\/\//i.test(token)) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoadingSuggestions(true)
      void session
        .call((accessToken) => searchAutocomplete(token, accessToken))
        .then((tags) => {
          if (cancelled) return
          for (const item of tags) {
            if (item.name && item.translated_name) {
              recordTagTranslation(item.name, item.translated_name)
            }
          }
          setSuggestions(tags.slice(0, 12))
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
        .finally(() => {
          if (!cancelled) setLoadingSuggestions(false)
        })
    }, AUTOCOMPLETE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [inputText, isEditing, scope])

  const scopeChips = useMemo<ChipItem<SearchScope>[]>(() => {
    const list: ChipItem<SearchScope>[] = [{ value: "illust", label: "插画·漫画" }]
    if (!settings.hideNovels) list.push({ value: "novel", label: "小说" })
    list.push({ value: "user", label: "用户" })
    return list
  }, [settings.hideNovels])

  const directTargets = useMemo(
    () => buildDirectTargets(inputText, scope, settings.hideNovels),
    [inputText, scope, settings.hideNovels],
  )

  const hasCustomAdvanced = Boolean(
    advParams.bookmarkThreshold > 0 ||
      advParams.useDateRange ||
      advParams.mediaFilter !== "all" ||
      advParams.sort !== "date_desc" ||
      advParams.target !== "partial_match_for_tags" ||
      (advParams.minTextLength && advParams.minTextLength > 0),
  )

  const novelLengthLabel =
    scope === "novel" ? formatMinTextLengthLabel(advParams.minTextLength) : null

  function executeSearch(
    rawWord: string,
    overrideScope?: SearchScope,
    translatedName?: string | null,
  ) {
    const trimmed = rawWord.trim()
    if (!trimmed) return

    // Direct URL navigation shortcut
    if (/^https?:\/\//i.test(trimmed) || /^pixiv:\/\//i.test(trimmed)) {
      const routeStr = parseDeepLinkUrl(trimmed)
      const route = routeStr ? parseRouteString(routeStr) : null
      if (route) {
        Keyboard.dismiss()
        setIsEditing(false)
        nav.push(route)
        return
      }
    }

    const nextScope = overrideScope ?? scope
    Keyboard.dismiss()
    setIsEditing(false)
    setInputText(trimmed)
    setSubmittedWord(trimmed)
    setAdvParams((prev) => ({
      ...prev,
      word: trimmed,
      scope: nextScope === "novel" ? "novel" : "illust",
      category:
        nextScope === "novel"
          ? "novel"
          : prev.category === "novel"
            ? "all_illust"
            : prev.category,
    }))
    addSearchHistory(trimmed, nextScope, translatedName)
    setQueryVersion((v) => v + 1)
  }

  function openAdvancedSheet() {
    Keyboard.dismiss()
    const current: AdvancedSearchParams = {
      ...advParams,
      word: inputText.trim() || submittedWord || advParams.word,
      scope: scope === "novel" ? "novel" : "illust",
      category: scope === "novel" ? "novel" : advParams.category === "novel" ? "all_illust" : advParams.category,
    }
    overlay.presentSheet({
      title: "高级搜索",
      render: (close) => (
        <SearchAdvancedSheet
          currentParams={current}
          settings={settings}
          onCancel={close}
          onApply={(next) => {
            close()
            setAdvParams(next)
            setScope(next.scope)
            setInputText(next.word)
            if (next.word.trim()) {
              setSubmittedWord(next.word.trim())
              addSearchHistory(next.word.trim(), next.scope)
              setQueryVersion((v) => v + 1)
            }
          }}
        />
      ),
    })
  }

  function handleSelectScope(next: SearchScope) {
    setScope(next)
    if (submittedWord) {
      setAdvParams((prev) => ({
        ...prev,
        word: submittedWord,
        scope: next === "novel" ? "novel" : "illust",
        category: next === "novel" ? "novel" : prev.category === "novel" ? "all_illust" : prev.category,
      }))
    }
  }

  function handleApplySuggestion(tag: PixivAutocompleteTag) {
    try {
      triggerHaptic("selection")
    } catch {}
    const { prefix } = extractActiveToken(inputText)
    const nextWord = `${prefix}${tag.name}`.trim()
    executeSearch(nextWord, scope, tag.translated_name)
  }

  function handleClearResults() {
    setSubmittedWord(null)
    setInputText("")
    setIsEditing(false)
    Keyboard.dismiss()
  }

  const activeTrending = scope === "novel" ? trendingNovel : trendingIllust

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Edge-to-Edge Safe-Area Search Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            paddingLeft: insets.left + 12,
            paddingRight: insets.right + 12,
            backgroundColor: colors.glassBg,
            borderBottomColor: colors.separator,
          },
        ]}
      >
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: colors.fill, borderColor: colors.glassBorder },
            ]}
          >
            <Text style={[styles.searchIcon, { color: colors.textTertiary }]}>⌕</Text>
            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={(t) => {
                setInputText(t)
                setIsEditing(true)
              }}
              onFocus={() => setIsEditing(true)}
              placeholder={
                scope === "user"
                  ? "搜索画师昵称或输入 UID…"
                  : "搜索标签、关键词、ID 或 Pixiv 链接…"
              }
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => executeSearch(inputText)}
              style={[styles.searchInput, { color: colors.text }]}
            />
            {inputText.length > 0 ? (
              <Pressable
                onPress={() => {
                  setInputText("")
                  setSuggestions([])
                  if (!isEditing) setSubmittedWord(null)
                }}
                hitSlop={8}
                style={[styles.clearCircle, { backgroundColor: colors.fillStrong }]}
              >
                <Text style={[styles.clearCircleText, { color: colors.textSecondary }]}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {scope !== "user" ? (
            <Pressable
              onPress={openAdvancedSheet}
              style={[
                styles.advBtn,
                {
                  backgroundColor: hasCustomAdvanced ? accentSoft : colors.fill,
                  borderColor: hasCustomAdvanced ? accent : colors.glassBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.advBtnText,
                  { color: hasCustomAdvanced ? accent : colors.text },
                ]}
              >
                高级
              </Text>
            </Pressable>
          ) : null}

          {submittedWord || isEditing ? (
            <Pressable
              onPress={() => {
                if (isEditing && submittedWord) {
                  setIsEditing(false)
                  setInputText(submittedWord)
                  Keyboard.dismiss()
                } else {
                  handleClearResults()
                }
              }}
              hitSlop={8}
              style={styles.cancelBtn}
            >
              <Text style={[styles.cancelText, { color: accent }]}>
                {isEditing && submittedWord ? "取消" : "重置"}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ChipBar items={scopeChips} selected={scope} onSelect={handleSelectScope} compact={true} />

        {/* Active filter bar when showing illust/novel results */}
        {submittedWord && !isEditing && scope !== "user" ? (
          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.activeFilterBar}
          >
            <Pressable
              onPress={() => {
                const nextSort: SearchSort =
                  advParams.sort === "date_desc"
                    ? "popular_desc"
                    : advParams.sort === "popular_desc"
                      ? "date_asc"
                      : "date_desc"
                setAdvParams((prev) => ({ ...prev, sort: nextSort }))
              }}
              style={[styles.filterPill, { backgroundColor: accentSoft, borderColor: accent }]}
            >
              <Text style={[styles.filterPillText, { color: accent }]}>
                排序: {SORT_LABELS[advParams.sort]}
              </Text>
            </Pressable>

            {advParams.bookmarkThreshold > 0 ? (
              <Pressable
                onPress={openAdvancedSheet}
                style={[styles.filterPill, { backgroundColor: accentSoft, borderColor: accent }]}
              >
                <Text style={[styles.filterPillText, { color: accent }]}>
                  收藏 ≥ {advParams.bookmarkThreshold}
                </Text>
              </Pressable>
            ) : null}

            {novelLengthLabel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`移除长篇字数筛选 ${novelLengthLabel}`}
                onPress={() => setAdvParams((prev) => ({ ...prev, minTextLength: 0 }))}
                style={[styles.filterPill, { backgroundColor: accentSoft, borderColor: accent }]}
              >
                <Text style={[styles.filterPillText, { color: accent }]}>
                  {novelLengthLabel} ✕
                </Text>
              </Pressable>
            ) : null}

            {scope === "illust" && advParams.mediaFilter !== "all" ? (
              <Pressable
                onPress={openAdvancedSheet}
                style={[styles.filterPill, { backgroundColor: accentSoft, borderColor: accent }]}
              >
                <Text style={[styles.filterPillText, { color: accent }]}>
                  类型: {advParams.mediaFilter === "illust" ? "插画" : advParams.mediaFilter === "manga" ? "漫画" : "动图"}
                </Text>
              </Pressable>
            ) : null}

            {advParams.useDateRange ? (
              <Pressable
                onPress={openAdvancedSheet}
                style={[styles.filterPill, { backgroundColor: accentSoft, borderColor: accent }]}
              >
                <Text style={[styles.filterPillText, { color: accent }]}>
                  {advParams.datePresetLabel || `${advParams.startDate}~${advParams.endDate}`}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={openAdvancedSheet}
              style={[styles.filterPill, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.filterPillText, { color: colors.textSecondary }]}>
                更多筛选…
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}
      </View>

      {/* Main Content Area */}
      <View style={styles.body}>
        {/* Case A: Live Editing Suggestions / Direct ID & URL Jump */}
        {isEditing && inputText.trim().length > 0 ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 12,
              paddingBottom: effectiveBottomInset(insets) + 28,
              gap: 10,
            }}
          >
            {directTargets.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
                <Text style={[styles.cardHeader, { color: colors.textSecondary }]}>直达跳转</Text>
                {directTargets.map((item, idx) => (
                  <Pressable
                    key={item.key}
                    onPress={() => {
                      Keyboard.dismiss()
                      setIsEditing(false)
                      nav.push(item.route)
                    }}
                    style={[
                      styles.directRow,
                      idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.directTitle, { color: colors.text }]}>{item.title}</Text>
                      <Text style={[styles.directSub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    </View>
                    <Text style={[styles.chevron, { color: accent }]}>前往 ›</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => executeSearch(inputText)}
              style={[styles.submitRow, { backgroundColor: accentSoft, borderColor: accent }]}
            >
              <Text style={[styles.submitRowText, { color: accent }]} numberOfLines={1}>
                搜索「{inputText.trim()}」
              </Text>
            </Pressable>

            {scope !== "user" ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
                <View style={styles.suggestHeader}>
                  <Text style={[styles.cardHeader, { color: colors.textSecondary }]}>标签联想</Text>
                  {loadingSuggestions ? <ActivityIndicator size="small" color={accent} /> : null}
                </View>
                {suggestions.length === 0 && !loadingSuggestions ? (
                  <Text style={[styles.emptySuggest, { color: colors.textTertiary }]}>
                    无匹配标签建议，可直接按回车搜索
                  </Text>
                ) : (
                  suggestions.map((tag, idx) => (
                    <Pressable
                      key={`${tag.name}-${idx}`}
                      onPress={() => handleApplySuggestion(tag)}
                      style={[
                        styles.suggestRow,
                        idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
                      ]}
                    >
                      <Text style={[styles.suggestName, { color: colors.text }]} numberOfLines={1}>
                        #{tag.name}
                      </Text>
                      {tag.translated_name ? (
                        <Text style={[styles.suggestTrans, { color: colors.textSecondary }]} numberOfLines={1}>
                          {tag.translated_name}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
          </ScrollView>
        ) : submittedWord ? (
          /* Case B: Submitted Search Results */
          scope === "user" ? (
            <SearchUserList word={submittedWord} queryVersion={queryVersion} />
          ) : scope === "novel" ? (
            <SearchNovelResults params={{ ...advParams, word: submittedWord }} queryVersion={queryVersion} />
          ) : (
            <SearchIllustResults params={{ ...advParams, word: submittedWord }} queryVersion={queryVersion} />
          )
        ) : scope === "user" ? (
          /* Case C1: Pre-search User Scope -> History + Recommended Creators */
          <View style={styles.body}>
            {history.length > 0 ? (
              <View style={styles.historyStrip}>
                <View style={styles.sectionTitleRow}>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>最近搜索</Text>
                  <Pressable onPress={() => clearSearchHistory("user")}>
                    <Text style={[styles.clearAllText, { color: colors.danger }]}>清空</Text>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal={true}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.historyHorizontal}
                >
                  {history.slice(0, 15).map((entry) => (
                    <Pressable
                      key={entry.query}
                      onPress={() => executeSearch(entry.query, "user")}
                      style={[styles.historyPill, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
                    >
                      <Text style={[styles.historyPillText, { color: colors.text }]}>{entry.query}</Text>
                      <Pressable
                        onPress={() => removeSearchHistory(entry.query, "user")}
                        hitSlop={6}
                      >
                        <Text style={[styles.historyRemove, { color: colors.textTertiary }]}>×</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <SearchUserList word={null} queryVersion={queryVersion} />
          </View>
        ) : (
          /* Case C2: Pre-search Illust / Novel Discovery -> History + Trending Tags Grid */
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 12,
              paddingBottom: effectiveBottomInset(insets) + 28,
              gap: 16,
            }}
            refreshControl={
              <RefreshControl
                refreshing={loadingTrending}
                onRefresh={() => void loadTrending(scope === "novel" ? "novel" : "illust")}
                tintColor={accent}
                colors={[accent]}
              />
            }
          >
            {history.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>最近搜索</Text>
                  <Pressable onPress={() => clearSearchHistory(scope)}>
                    <Text style={[styles.clearAllText, { color: colors.danger }]}>清空</Text>
                  </Pressable>
                </View>
                <View style={styles.historyWrap}>
                  {history.slice(0, 20).map((entry) => (
                    <Pressable
                      key={entry.query}
                      onPress={() => executeSearch(entry.query, scope, entry.translatedName)}
                      style={[styles.historyPill, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
                    >
                      <Text style={[styles.historyPillText, { color: colors.text }]} numberOfLines={1}>
                        {entry.translatedName ? `${entry.query} · ${entry.translatedName}` : entry.query}
                      </Text>
                      <Pressable
                        onPress={() => removeSearchHistory(entry.query, scope)}
                        hitSlop={6}
                      >
                        <Text style={[styles.historyRemove, { color: colors.textTertiary }]}>×</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  {scope === "novel" ? "热门小说标签" : "热门插画标签"}
                </Text>
                <Pressable onPress={() => void loadTrending(scope === "novel" ? "novel" : "illust")}>
                  <Text style={[styles.refreshText, { color: accent }]}>换一批</Text>
                </Pressable>
              </View>

              {loadingTrending && activeTrending.length === 0 ? (
                <LoadingView message="正在加载热门标签…" />
              ) : trendingError && activeTrending.length === 0 ? (
                <ErrorView
                  message={trendingError}
                  onRetry={() => void loadTrending(scope === "novel" ? "novel" : "illust")}
                />
              ) : (
                <View style={styles.trendingGrid}>
                  {activeTrending.map((tag, idx) => (
                    <Pressable
                      key={`${tag.tag}-${idx}`}
                      onPress={() => executeSearch(tag.tag, scope, tag.translated_name)}
                      style={({ pressed }) => [
                        styles.trendingCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.glassBorder,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}
                    >
                      <PixImage
                        url={trendingTagThumb(tag)}
                        resizeMode="cover"
                        style={styles.trendingImage}
                      />
                      <View style={styles.trendingScrim}>
                        <Text style={styles.trendingName} numberOfLines={1}>
                          #{tag.tag}
                        </Text>
                        {tag.translated_name ? (
                          <Text style={styles.trendingTrans} numberOfLines={1}>
                            {tag.translated_name}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    minHeight: 40,
    gap: 6,
  },
  searchIcon: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
  },
  clearCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  clearCircleText: {
    fontSize: 11,
    fontWeight: "700",
  },
  advBtn: {
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  advBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  cancelBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
  },
  activeFilterBar: {
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  directRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  directTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  directSub: {
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    fontSize: 13,
    fontWeight: "700",
  },
  submitRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  submitRowText: {
    fontSize: 14,
    fontWeight: "700",
  },
  suggestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 14,
  },
  emptySuggest: {
    fontSize: 13,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  suggestName: {
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  suggestTrans: {
    fontSize: 12,
    flexShrink: 1,
  },
  section: {
    gap: 10,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: "600",
  },
  refreshText: {
    fontSize: 12,
    fontWeight: "600",
  },
  historyStrip: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  historyHorizontal: {
    gap: 8,
    paddingBottom: 4,
  },
  historyWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  historyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  historyPillText: {
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
  },
  historyRemove: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 16,
  },
  trendingGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  trendingCard: {
    width: "48.3%",
    aspectRatio: 1.35,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    position: "relative",
  },
  trendingImage: {
    width: "100%",
    height: "100%",
  },
  trendingScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  trendingName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  trendingTrans: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    marginTop: 1,
  },
})
