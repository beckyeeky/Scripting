import React, { useMemo, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import {
  computeHistoryAnalytics,
  HEATMAP_WEEKS_MAX,
  HEATMAP_WEEKS_MIN,
  type AnalyticsScopeKind,
  type AnalyticsTimeRange,
} from "../../../../../../Pix-Scripting/src/store/historyAnalytics"
import {
  ChipBar,
  EmptyView,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

const RANGE_CHIPS: ReadonlyArray<ChipItem<AnalyticsTimeRange>> = [
  { value: "all", label: "全部" },
  { value: "year", label: "近一年" },
  { value: "quarter", label: "近一季" },
  { value: "month", label: "近一月" },
  { value: "week", label: "近一周" },
]

function formatCompactNumber(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}万`
  return String(n)
}

function formatReadingMinutes(mins: number): string {
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
}

function BarRow({
  label,
  count,
  total,
  barColor,
}: {
  label: string
  count: number
  total: number
  barColor: string
}) {
  const { colors } = useAppTheme()
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <View style={styles.barRow}>
      <View style={styles.barTop}>
        <Text style={[styles.barLabel, { color: colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.barValue, { color: colors.textSecondary }]}>
          {count} ({pct}%)
        </Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.fill }]}>
        <View
          style={[
            styles.barFill,
            { backgroundColor: barColor, width: `${Math.max(pct > 0 ? 3 : 0, pct)}%` },
          ]}
        />
      </View>
    </View>
  )
}

export function HistoryAnalyticsScreen({
  initialScope = "all",
}: {
  initialScope?: AnalyticsScopeKind
}) {
  const { colors, accent, accentSoft, isDark, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const { width: winWidth } = useWindowDimensions()

  const [scope, setScope] = useState<AnalyticsScopeKind>(initialScope)
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>("all")

  const heatmapWeeks = useMemo(() => {
    const available = Math.max(240, winWidth - 52)
    const computed = Math.floor(available / 13)
    return Math.max(HEATMAP_WEEKS_MIN, Math.min(HEATMAP_WEEKS_MAX, computed))
  }, [winWidth])

  const analytics = useMemo(
    () => computeHistoryAnalytics(scope, timeRange, { heatmapWeeks }),
    [scope, timeRange, heatmapWeeks],
  )

  const scopeChips = useMemo<ChipItem<AnalyticsScopeKind>[]>(() => {
    const list: ChipItem<AnalyticsScopeKind>[] = [
      { value: "all", label: "全部" },
      { value: "illustration", label: "插画" },
      { value: "manga", label: "漫画" },
    ]
    if (!settings.hideNovels) {
      list.push({ value: "novel", label: "小说" })
    }
    return list
  }, [settings.hideNovels])

  const heatColors = useMemo(
    () =>
      isDark
        ? ["#242426", "#0D4429", "#006D32", "#26A641", "#39D353"]
        : ["#EBEDF0", "#9BE9A8", "#40C463", "#30A14E", "#216E39"],
    [isDark],
  )

  const { summary, hourly, heatmap, topTags, topCreators, aspectAndFormat, novelMilestone } =
    analytics

  const totalAspect =
    aspectAndFormat.aspectRatio.ultraTall +
    aspectAndFormat.aspectRatio.tall +
    aspectAndFormat.aspectRatio.square +
    aspectAndFormat.aspectRatio.wide

  const totalMedia =
    aspectAndFormat.mediaType.singleIllust +
    aspectAndFormat.mediaType.multiIllust +
    aspectAndFormat.mediaType.ugoira +
    aspectAndFormat.mediaType.manga +
    aspectAndFormat.mediaType.novel

  const totalAi = aspectAndFormat.aiDistribution.ai + aspectAndFormat.aiDistribution.nonAi

  const totalMangaBuckets =
    aspectAndFormat.mangaPageBuckets.single +
    aspectAndFormat.mangaPageBuckets.short +
    aspectAndFormat.mangaPageBuckets.medium +
    aspectAndFormat.mangaPageBuckets.long

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="我的足迹统计"
        subtitle={summary.timeSpanDesc}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        bottom={
          <View>
            <ChipBar<AnalyticsScopeKind>
              items={scopeChips}
              selected={scope}
              onSelect={setScope}
              compact={true}
            />
            <ChipBar<AnalyticsTimeRange>
              items={RANGE_CHIPS}
              selected={timeRange}
              onSelect={setTimeRange}
              compact={true}
            />
          </View>
        }
      />

      {summary.totalViews === 0 ? (
        <EmptyView
          title="暂无统计数据"
          subtitle="当前筛选范围内还没有本地浏览记录，浏览作品后会自动生成多维度画像。"
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: effectiveBottomInset(insets) + 28 },
          ]}
        >
          {/* KPI Summary Grid */}
          <SectionHeader title="核心概览" />
          <View style={styles.kpiGrid}>
            {[
              { label: "累计浏览", value: formatCompactNumber(summary.totalViews), tint: accent },
              { label: "触达画师", value: formatCompactNumber(summary.uniqueCreators), tint: colors.purple },
              { label: "活跃天数", value: `${summary.activeDays} 天`, tint: colors.green },
              { label: "收藏转化率", value: `${summary.bookmarkRate}%`, tint: colors.pink },
              { label: "当前连续打卡", value: `${summary.currentStreak} 天`, tint: colors.orange },
              { label: "最长连续纪录", value: `${summary.maxStreak} 天`, tint: colors.yellow },
            ].map((item) => (
              <View
                key={item.label}
                style={[
                  styles.kpiCard,
                  { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                ]}
              >
                <Text style={[styles.kpiValue, { color: item.tint }]}>{item.value}</Text>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              </View>
            ))}
          </View>
          {summary.peakDay ? (
            <Text style={[styles.peakNote, { color: colors.textSecondary }]}>
              单日浏览峰值：{summary.peakDay.dateStr}（{summary.peakDay.count} 篇作品）
            </Text>
          ) : null}

          {/* Heatmap */}
          <SectionHeader
            title={`活跃热力图 (${heatmap.startDateStr} ~ ${heatmap.endDateStr})`}
          />
          <SectionCard style={styles.cardPad}>
            <ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
              <View style={styles.heatmapRow}>
                {heatmap.weeks.map((week, wIdx) => (
                  <View key={`w-${wIdx}`} style={styles.heatmapCol}>
                    {week.days.map((day) => (
                      <View
                        key={day.dateStr}
                        style={[
                          styles.heatCell,
                          { backgroundColor: heatColors[day.level] ?? heatColors[0] },
                        ]}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
            <View style={styles.heatLegend}>
              <Text style={[styles.legendText, { color: colors.textTertiary }]}>少</Text>
              {heatColors.map((c, idx) => (
                <View key={`leg-${idx}`} style={[styles.heatCell, { backgroundColor: c }]} />
              ))}
              <Text style={[styles.legendText, { color: colors.textTertiary }]}>多</Text>
            </View>
          </SectionCard>

          {/* 24-Hour Distribution & Persona */}
          <SectionHeader title="24 小时浏览节律" />
          <SectionCard style={styles.cardPad}>
            <View style={[styles.personaPill, { backgroundColor: accentSoft }]}>
              <Text style={[styles.personaText, { color: accent }]}>{hourly.persona}</Text>
            </View>
            <Text style={[styles.subHint, { color: colors.textSecondary }]}>
              高频活跃时段：{hourly.peakTimeRangeDesc}（峰值 {hourly.maxCount} 次）
            </Text>

            <View style={styles.hourlyChart}>
              {hourly.hours.map((cnt, h) => {
                const ratio = hourly.maxCount > 0 ? cnt / hourly.maxCount : 0
                const barHeight = Math.max(2, Math.round(ratio * 72))
                const isPeak = h === hourly.peakHour && cnt > 0
                return (
                  <View key={`h-${h}`} style={styles.hourCol}>
                    <View
                      style={[
                        styles.hourBar,
                        {
                          height: barHeight,
                          backgroundColor: isPeak ? accent : colors.fillStrong,
                        },
                      ]}
                    />
                    {h % 6 === 0 ? (
                      <Text style={[styles.hourTick, { color: colors.textTertiary }]}>{h}</Text>
                    ) : (
                      <Text style={styles.hourTick}> </Text>
                    )}
                  </View>
                )
              })}
            </View>
          </SectionCard>

          {/* Novel Reading Milestone */}
          {novelMilestone ? (
            <>
              <SectionHeader title="小说阅读里程碑" />
              <SectionCard style={styles.cardPad}>
                <Text style={[styles.milestoneWords, { color: accent }]}>
                  {formatCompactNumber(novelMilestone.totalWords)} 字
                </Text>
                {novelMilestone.comparisonText ? (
                  <Text style={[styles.milestoneDesc, { color: colors.text }]}>
                    {novelMilestone.comparisonText}
                  </Text>
                ) : null}
                <Text style={[styles.subHint, { color: colors.textSecondary }]}>
                  篇均 {formatCompactNumber(novelMilestone.averageWords)} 字 · 预计累计阅读{" "}
                  {formatReadingMinutes(novelMilestone.readingTimeMinutes)}
                </Text>
              </SectionCard>
            </>
          ) : null}

          {/* Media & Aspect & AI Distribution */}
          <SectionHeader title="内容分布与构图偏好" />
          <SectionCard style={styles.cardPad}>
            {totalMedia > 0 ? (
              <View style={styles.distBlock}>
                <Text style={[styles.blockTitle, { color: colors.textSecondary }]}>作品形态</Text>
                {aspectAndFormat.mediaType.singleIllust > 0 ? (
                  <BarRow label="单图插画" count={aspectAndFormat.mediaType.singleIllust} total={totalMedia} barColor={accent} />
                ) : null}
                {aspectAndFormat.mediaType.multiIllust > 0 ? (
                  <BarRow label="多图插画集" count={aspectAndFormat.mediaType.multiIllust} total={totalMedia} barColor={colors.purple} />
                ) : null}
                {aspectAndFormat.mediaType.ugoira > 0 ? (
                  <BarRow label="动图 (Ugoira)" count={aspectAndFormat.mediaType.ugoira} total={totalMedia} barColor={colors.orange} />
                ) : null}
                {aspectAndFormat.mediaType.manga > 0 ? (
                  <BarRow label="漫画" count={aspectAndFormat.mediaType.manga} total={totalMedia} barColor={colors.green} />
                ) : null}
                {aspectAndFormat.mediaType.novel > 0 ? (
                  <BarRow label="小说" count={aspectAndFormat.mediaType.novel} total={totalMedia} barColor={colors.pink} />
                ) : null}
              </View>
            ) : null}

            {scope === "manga" && totalMangaBuckets > 0 ? (
              <View style={styles.distBlock}>
                <Text style={[styles.blockTitle, { color: colors.textSecondary }]}>漫画篇幅分布</Text>
                <BarRow label="单页 (1P)" count={aspectAndFormat.mangaPageBuckets.single} total={totalMangaBuckets} barColor={accent} />
                <BarRow label="短篇 (2-10P)" count={aspectAndFormat.mangaPageBuckets.short} total={totalMangaBuckets} barColor={colors.green} />
                <BarRow label="中篇 (11-30P)" count={aspectAndFormat.mangaPageBuckets.medium} total={totalMangaBuckets} barColor={colors.orange} />
                <BarRow label="长篇 (31P+)" count={aspectAndFormat.mangaPageBuckets.long} total={totalMangaBuckets} barColor={colors.pink} />
              </View>
            ) : null}

            {totalAspect > 0 ? (
              <View style={styles.distBlock}>
                <Text style={[styles.blockTitle, { color: colors.textSecondary }]}>画幅比例</Text>
                <BarRow label="竖屏长图 / 手机壁纸" count={aspectAndFormat.aspectRatio.ultraTall} total={totalAspect} barColor={colors.purple} />
                <BarRow label="常规竖幅" count={aspectAndFormat.aspectRatio.tall} total={totalAspect} barColor={accent} />
                <BarRow label="方形构图" count={aspectAndFormat.aspectRatio.square} total={totalAspect} barColor={colors.green} />
                <BarRow label="横屏 / 宽画幅" count={aspectAndFormat.aspectRatio.wide} total={totalAspect} barColor={colors.orange} />
              </View>
            ) : null}

            {totalAi > 0 ? (
              <View style={styles.distBlock}>
                <Text style={[styles.blockTitle, { color: colors.textSecondary }]}>创作属性</Text>
                <BarRow label="人类原创" count={aspectAndFormat.aiDistribution.nonAi} total={totalAi} barColor={colors.green} />
                <BarRow label="AI 生成" count={aspectAndFormat.aiDistribution.ai} total={totalAi} barColor={colors.purple} />
              </View>
            ) : null}
          </SectionCard>

          {/* Top Tags */}
          {topTags.length > 0 ? (
            <>
              <SectionHeader title="高频偏好标签 Top 15" />
              <SectionCard>
                {topTags.map((tag, idx) => (
                  <Pressable
                    key={tag.name}
                    onPress={() =>
                      nav.push({
                        name: "tagFeed",
                        tag: tag.name,
                        kind: scope === "novel" ? "novel" : "illust",
                      })
                    }
                    style={[
                      styles.rankRow,
                      idx < topTags.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.separator,
                      },
                    ]}
                  >
                    <Text style={[styles.rankIdx, { color: idx < 3 ? accent : colors.textTertiary }]}>
                      {idx + 1}
                    </Text>
                    <View style={styles.rankBody}>
                      <Text style={[styles.rankTitle, { color: colors.text }]} numberOfLines={1}>
                        #{tag.translatedName || tag.name}
                      </Text>
                      {tag.translatedName && tag.translatedName !== tag.name ? (
                        <Text style={[styles.rankSub, { color: colors.textTertiary }]} numberOfLines={1}>
                          {tag.name}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.rankMeta, { color: colors.textSecondary }]}>
                      {tag.count} 次 · {tag.percentage}%
                    </Text>
                  </Pressable>
                ))}
              </SectionCard>
            </>
          ) : null}

          {/* Top Creators */}
          {topCreators.length > 0 ? (
            <>
              <SectionHeader title="最常浏览画师 Top 15" />
              <SectionCard>
                {topCreators.map((creator, idx) => (
                  <Pressable
                    key={creator.id}
                    onPress={() => nav.push({ name: "user", id: creator.id })}
                    style={[
                      styles.rankRow,
                      idx < topCreators.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.separator,
                      },
                    ]}
                  >
                    <Text style={[styles.rankIdx, { color: idx < 3 ? accent : colors.textTertiary }]}>
                      {idx + 1}
                    </Text>
                    <View style={styles.rankBody}>
                      <Text style={[styles.rankTitle, { color: colors.text }]} numberOfLines={1}>
                        {creator.name}
                      </Text>
                      <Text style={[styles.rankSub, { color: colors.textTertiary }]}>
                        收藏 {creator.bookmarkCount} 篇 · 收藏率 {creator.bookmarkRate}%
                      </Text>
                    </View>
                    <Text style={[styles.rankMeta, { color: colors.textSecondary }]}>
                      {creator.viewCount} 次 ›
                    </Text>
                  </Pressable>
                ))}
              </SectionCard>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
  },
  kpiCard: {
    width: "31.5%",
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 4,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "800",
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  peakNote: {
    fontSize: 12,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  cardPad: {
    padding: 14,
    gap: 10,
  },
  heatmapRow: {
    flexDirection: "row",
    gap: 3,
  },
  heatmapCol: {
    gap: 3,
  },
  heatCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  heatLegend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  legendText: {
    fontSize: 11,
  },
  personaPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  personaText: {
    fontSize: 13,
    fontWeight: "700",
  },
  subHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  hourlyChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 92,
    gap: 2,
    marginTop: 6,
  },
  hourCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  hourBar: {
    width: "78%",
    borderRadius: 3,
  },
  hourTick: {
    fontSize: 9,
  },
  milestoneWords: {
    fontSize: 26,
    fontWeight: "800",
  },
  milestoneDesc: {
    fontSize: 14,
    fontWeight: "600",
  },
  distBlock: {
    gap: 8,
    marginBottom: 6,
  },
  blockTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  barRow: {
    gap: 4,
  },
  barTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  barLabel: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  barValue: {
    fontSize: 12,
  },
  barTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  rankIdx: {
    width: 24,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  rankBody: {
    flex: 1,
    gap: 2,
  },
  rankTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  rankSub: {
    fontSize: 11,
  },
  rankMeta: {
    fontSize: 12,
    fontWeight: "600",
  },
})
