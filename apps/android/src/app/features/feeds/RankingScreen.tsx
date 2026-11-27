import React, { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import {
  nextIllustrations,
  nextNovels,
  novelRanking,
  ranking,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  isIllustContentVisible,
  isNovelContentVisible,
} from "../../../../../../Pix-Scripting/src/store/contentFilter"
import { getCustomRankingModesForKind } from "../../../../../../Pix-Scripting/src/store/settings"
import type { PixivIllustration, PixivNovel } from "../../../../../../Pix-Scripting/src/types"
import {
  ChipBar,
  HeaderIconButton,
  IllustMasonryFeed,
  NovelFeedList,
  ScreenHeader,
  usePixivFeed,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  clampRankingTimestamp,
  formatDateToPixivDate,
  getInitialAdvancedParams,
  getRankingModeTitle,
  getYesterdayTimestamp,
  RankingAdvancedSheet,
  type AdvancedRankingParams,
} from "./RankingAdvancedSheet"

type RankingTabKind = "illustration" | "manga" | "novel" | "advanced"

function RankingIllustFeed({
  mode,
  date,
  heroFirst,
}: {
  mode: string
  date: string | null
  heroFirst: boolean
}) {
  const feed = usePixivFeed<PixivIllustration>({
    fetcher: (token) => ranking(mode, date, token),
    fetchMore: (nextURL, token) => nextIllustrations(nextURL, token),
    filter: (items) => items.filter((item) => isIllustContentVisible(item)),
    deps: [mode, date],
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
      showRankNumbers={true}
      heroFirst={heroFirst}
      emptyTitle="该榜单暂无可展示作品"
      emptySubtitle={date ? `日期 ${date} 可能尚无该分类榜单，或受内容过滤隐藏` : "下拉刷新或切换其他榜单"}
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

function RankingNovelFeed({
  mode,
  date,
}: {
  mode: string
  date: string | null
}) {
  const feed = usePixivFeed<PixivNovel>({
    fetcher: (token) => novelRanking(mode, date, token),
    fetchMore: (nextURL, token) => nextNovels(nextURL, token),
    filter: (items) => items.filter((item) => isNovelContentVisible(item)),
    deps: [mode, date],
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
      showRankNumbers={true}
      emptyTitle="该小说榜暂无可展示作品"
      emptySubtitle={date ? `日期 ${date} 暂无榜单或被过滤` : "下拉刷新或切换其他榜单"}
      onRefresh={() => void feed.refresh()}
      onLoadMore={() => void feed.loadMore()}
    />
  )
}

export function RankingScreen() {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [kind, setKind] = useState<RankingTabKind>("illustration")
  const [illustMode, setIllustMode] = useState<string>(
    () => getCustomRankingModesForKind("illustration", settings)[0]?.value ?? "day",
  )
  const [mangaMode, setMangaMode] = useState<string>(
    () => getCustomRankingModesForKind("manga", settings)[0]?.value ?? "day_manga",
  )
  const [novelMode, setNovelMode] = useState<string>(
    () => getCustomRankingModesForKind("novel", settings)[0]?.value ?? "day",
  )
  const [advancedParams, setAdvancedParams] = useState<AdvancedRankingParams>(() =>
    getInitialAdvancedParams(),
  )
  const hasQueriedAdvancedRef = useRef(false)

  useEffect(() => {
    if (settings.hideNovels) {
      if (kind === "novel") setKind("illustration")
      if (advancedParams.category === "novel") {
        setAdvancedParams((prev) => ({ ...prev, category: "illustration", mode: "day" }))
      }
    }
  }, [settings.hideNovels, kind, advancedParams.category])

  const activeModes = useMemo(() => {
    if (kind === "advanced") return []
    return getCustomRankingModesForKind(kind, settings)
  }, [kind, settings])

  const selectedMode =
    kind === "illustration"
      ? illustMode
      : kind === "manga"
        ? mangaMode
        : kind === "novel"
          ? novelMode
          : advancedParams.mode

  useEffect(() => {
    if (kind === "advanced" || activeModes.length === 0) return
    if (!activeModes.some((m) => m.value === selectedMode)) {
      const fallback = activeModes[0].value
      if (kind === "illustration") setIllustMode(fallback)
      else if (kind === "manga") setMangaMode(fallback)
      else setNovelMode(fallback)
    }
  }, [kind, activeModes, selectedMode])

  const kindChips = useMemo<ChipItem<RankingTabKind>[]>(() => {
    const list: ChipItem<RankingTabKind>[] = [
      { value: "illustration", label: "插画" },
      { value: "manga", label: "漫画" },
    ]
    if (!settings.hideNovels) {
      list.push({ value: "novel", label: "小说" })
    }
    list.push({ value: "advanced", label: "历史榜" })
    return list
  }, [settings.hideNovels])

  const modeChips = useMemo<ChipItem<string>[]>(
    () => activeModes.map((m) => ({ value: m.value, label: m.title })),
    [activeModes],
  )

  function openAdvancedSheet() {
    overlay.presentSheet({
      title: "历史排行榜筛选",
      render: (close) => (
        <RankingAdvancedSheet
          currentParams={advancedParams}
          settings={settings}
          onCancel={close}
          onApply={(next) => {
            hasQueriedAdvancedRef.current = true
            setAdvancedParams(next)
            setKind("advanced")
            close()
          }}
        />
      ),
    })
  }

  function handleSelectKind(next: RankingTabKind) {
    setKind(next)
    if (next === "advanced" && !hasQueriedAdvancedRef.current) {
      openAdvancedSheet()
    }
  }

  function handleSelectMode(nextMode: string) {
    if (kind === "illustration") setIllustMode(nextMode)
    else if (kind === "manga") setMangaMode(nextMode)
    else if (kind === "novel") setNovelMode(nextMode)
  }

  function shiftHistoryDay(delta: number) {
    try {
      triggerHaptic("selection")
    } catch {}
    const nextTs = clampRankingTimestamp(advancedParams.timestamp + delta * 86400000)
    setAdvancedParams((prev) => ({
      ...prev,
      timestamp: nextTs,
      date: formatDateToPixivDate(nextTs),
    }))
  }

  const canGoNextDay = advancedParams.timestamp < getYesterdayTimestamp()
  const advancedCategoryLabel =
    advancedParams.category === "illustration"
      ? "插画"
      : advancedParams.category === "manga"
        ? "漫画"
        : "小说"
  const advancedModeTitle = getRankingModeTitle(advancedParams.category, advancedParams.mode)

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="排行榜"
        subtitle={
          kind === "advanced"
            ? `${advancedParams.date} · ${advancedCategoryLabel}${advancedModeTitle}`
            : undefined
        }
        right={
          <View style={styles.headerActions}>
            {kind !== "advanced" ? (
              <HeaderIconButton
                label="自定义"
                onPress={() =>
                  nav.push({
                    name: "rankingCustomPicker",
                    kind: kind === "illustration" ? "illust" : kind,
                  })
                }
              />
            ) : null}
            <HeaderIconButton
              label="历史"
              onPress={openAdvancedSheet}
            />
          </View>
        }
        bottom={
          <View style={styles.controls}>
            <ChipBar items={kindChips} selected={kind} onSelect={handleSelectKind} />
            {kind !== "advanced" ? (
              <ChipBar
                items={modeChips}
                selected={selectedMode}
                onSelect={handleSelectMode}
                compact={true}
              />
            ) : (
              <View style={styles.historyBar}>
                <Pressable
                  onPress={() => shiftHistoryDay(-1)}
                  style={[styles.dayBtn, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
                >
                  <Text style={[styles.dayBtnText, { color: colors.text }]}>‹ 前一天</Text>
                </Pressable>
                <Pressable
                  onPress={openAdvancedSheet}
                  style={[styles.historyPill, { backgroundColor: accentSoft, borderColor: accent }]}
                >
                  <Text style={[styles.historyPillText, { color: accent }]} numberOfLines={1}>
                    {advancedParams.date} · {advancedCategoryLabel} · {advancedModeTitle} ▾
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!canGoNextDay}
                  onPress={() => shiftHistoryDay(1)}
                  style={[
                    styles.dayBtn,
                    {
                      backgroundColor: colors.fill,
                      borderColor: colors.glassBorder,
                      opacity: canGoNextDay ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text style={[styles.dayBtnText, { color: colors.text }]}>后一天 ›</Text>
                </Pressable>
              </View>
            )}
          </View>
        }
      />

      <View style={styles.body}>
        {kind === "advanced" ? (
          advancedParams.category === "novel" ? (
            <RankingNovelFeed mode={advancedParams.mode} date={advancedParams.date} />
          ) : (
            <RankingIllustFeed
              mode={advancedParams.mode}
              date={advancedParams.date}
              heroFirst={settings.heroFirstFeedCard}
            />
          )
        ) : kind === "novel" ? (
          <RankingNovelFeed mode={novelMode} date={null} />
        ) : (
          <RankingIllustFeed
            mode={kind === "illustration" ? illustMode : mangaMode}
            date={null}
            heroFirst={settings.heroFirstFeedCard}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  controls: {
    gap: 2,
    paddingBottom: 6,
  },
  historyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  historyPill: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  historyPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    flex: 1,
  },
})
