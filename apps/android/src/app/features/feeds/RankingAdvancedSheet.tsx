import React, { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  ALL_ILLUST_RANKING_OPTIONS,
  ALL_MANGA_RANKING_OPTIONS,
  ALL_NOVEL_RANKING_OPTIONS,
  getVisibleRankingOptions,
  type AppSettings,
  type RankingOptionDef,
} from "../../../../../../Pix-Scripting/src/store/settings"
import {
  ActionButton,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  ThemedTextInput,
} from "../../components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

export type RankingCategory = "illustration" | "manga" | "novel"

export interface AdvancedRankingParams {
  category: RankingCategory
  mode: string
  date: string // "YYYY-MM-DD"
  timestamp: number
}

const MIN_PIXIV_RANKING_TS = new Date("2007-09-09T00:00:00").getTime()

export function formatDateToPixivDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function getYesterdayTimestamp(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime() - 86400000
}

export function clampRankingTimestamp(timestamp: number): number {
  const maxTs = getYesterdayTimestamp()
  if (!Number.isFinite(timestamp)) return maxTs
  return Math.max(MIN_PIXIV_RANKING_TS, Math.min(timestamp, maxTs))
}

export function parsePixivDateString(input: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  const d = new Date(y, mo - 1, day)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
    return null
  }
  return clampRankingTimestamp(d.getTime())
}

export function getInitialAdvancedParams(): AdvancedRankingParams {
  const ts = getYesterdayTimestamp()
  return {
    category: "illustration",
    mode: "day",
    date: formatDateToPixivDate(ts),
    timestamp: ts,
  }
}

export function getRankingModeTitle(category: RankingCategory, mode: string): string {
  const list =
    category === "illustration"
      ? ALL_ILLUST_RANKING_OPTIONS
      : category === "manga"
        ? ALL_MANGA_RANKING_OPTIONS
        : ALL_NOVEL_RANKING_OPTIONS
  return list.find((item) => item.key === mode)?.title ?? mode
}

interface QuickDatePreset {
  label: string
  getTimestamp: () => number
}

const QUICK_DATE_PRESETS: QuickDatePreset[] = [
  { label: "昨天", getTimestamp: () => getYesterdayTimestamp() },
  {
    label: "7天前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - 7)
      return d.getTime()
    },
  },
  {
    label: "30天前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - 30)
      return d.getTime()
    },
  },
  {
    label: "1年前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setFullYear(d.getFullYear() - 1)
      return d.getTime()
    },
  },
  {
    label: "3年前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setFullYear(d.getFullYear() - 3)
      return d.getTime()
    },
  },
  {
    label: "5年前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setFullYear(d.getFullYear() - 5)
      return d.getTime()
    },
  },
  {
    label: "10年前",
    getTimestamp: () => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setFullYear(d.getFullYear() - 10)
      return d.getTime()
    },
  },
]

export function RankingAdvancedSheet({
  currentParams,
  settings,
  onApply,
  onCancel,
}: {
  currentParams: AdvancedRankingParams
  settings: AppSettings
  onApply: (params: AdvancedRankingParams) => void
  onCancel: () => void
}) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()

  const [category, setCategory] = useState<RankingCategory>(
    settings.hideNovels && currentParams.category === "novel"
      ? "illustration"
      : currentParams.category,
  )
  const [selectedMode, setSelectedMode] = useState<string>(currentParams.mode)
  const [selectedTimestamp, setSelectedTimestamp] = useState<number>(
    clampRankingTimestamp(currentParams.timestamp),
  )
  const [dateDraft, setDateDraft] = useState<string>(
    formatDateToPixivDate(clampRankingTimestamp(currentParams.timestamp)),
  )
  const [dateError, setDateError] = useState<string | null>(null)

  const visibleOptions = useMemo<ReadonlyArray<RankingOptionDef>>(() => {
    const all =
      category === "illustration"
        ? ALL_ILLUST_RANKING_OPTIONS
        : category === "manga"
          ? ALL_MANGA_RANKING_OPTIONS
          : ALL_NOVEL_RANKING_OPTIONS
    return getVisibleRankingOptions(all, settings)
  }, [category, settings])

  const activeMode = useMemo(() => {
    if (visibleOptions.some((o) => o.key === selectedMode)) return selectedMode
    return visibleOptions[0]?.key ?? "day"
  }, [visibleOptions, selectedMode])

  const categoryOptions = useMemo(() => {
    const list: Array<{ value: RankingCategory; label: string }> = [
      { value: "illustration", label: "插画" },
      { value: "manga", label: "漫画" },
    ]
    if (!settings.hideNovels) {
      list.push({ value: "novel", label: "小说" })
    }
    return list
  }, [settings.hideNovels])

  function handleCategoryChange(nextCategory: RankingCategory) {
    setCategory(nextCategory)
    const all =
      nextCategory === "illustration"
        ? ALL_ILLUST_RANKING_OPTIONS
        : nextCategory === "manga"
          ? ALL_MANGA_RANKING_OPTIONS
          : ALL_NOVEL_RANKING_OPTIONS
    const nextVisible = getVisibleRankingOptions(all, settings)
    if (!nextVisible.some((o) => o.key === selectedMode)) {
      setSelectedMode(nextVisible[0]?.key ?? "day")
    }
  }

  function applyTimestamp(ts: number) {
    try {
      triggerHaptic("selection")
    } catch {}
    const clamped = clampRankingTimestamp(ts)
    setSelectedTimestamp(clamped)
    setDateDraft(formatDateToPixivDate(clamped))
    setDateError(null)
  }

  function shiftDate(deltaDays: number, deltaMonths = 0, deltaYears = 0) {
    const d = new Date(selectedTimestamp)
    if (deltaYears) d.setFullYear(d.getFullYear() + deltaYears)
    if (deltaMonths) d.setMonth(d.getMonth() + deltaMonths)
    if (deltaDays) d.setDate(d.getDate() + deltaDays)
    applyTimestamp(d.getTime())
  }

  function handleApply() {
    let finalTs = selectedTimestamp
    if (dateDraft.trim() !== formatDateToPixivDate(selectedTimestamp)) {
      const parsed = parsePixivDateString(dateDraft)
      if (parsed == null) {
        setDateError("请输入有效日期（YYYY-MM-DD，2007-09-09 至昨天）")
        return
      }
      finalTs = parsed
    }
    const clamped = clampRankingTimestamp(finalTs)
    onApply({
      category,
      mode: activeMode,
      date: formatDateToPixivDate(clamped),
      timestamp: clamped,
    })
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 24 },
      ]}
    >
      <SectionHeader title="作品分类" />
      <View style={styles.padded}>
        <SegmentedControl<RankingCategory>
          value={category}
          onChange={handleCategoryChange}
          options={categoryOptions}
        />
      </View>

      <SectionHeader title="榜单类型" />
      <SectionCard style={styles.cardPad}>
        <View style={styles.pillGrid}>
          {visibleOptions.map((opt) => {
            const active = activeMode === opt.key
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  try {
                    triggerHaptic("selection")
                  } catch {}
                  setSelectedMode(opt.key)
                }}
                style={[
                  styles.pill,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: active ? "#FFFFFF" : colors.text },
                  ]}
                >
                  {opt.title}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </SectionCard>

      <SectionHeader title={`查询日期 · ${formatDateToPixivDate(selectedTimestamp)}`} />
      <SectionCard style={styles.cardPad}>
        <ScrollView
          horizontal={true}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.presetRow}
        >
          {QUICK_DATE_PRESETS.map((preset) => {
            const targetDate = formatDateToPixivDate(clampRankingTimestamp(preset.getTimestamp()))
            const active = targetDate === formatDateToPixivDate(selectedTimestamp)
            return (
              <Pressable
                key={preset.label}
                onPress={() => applyTimestamp(preset.getTimestamp())}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    { color: active ? "#FFFFFF" : colors.text },
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={styles.stepperRow}>
          {[
            { label: "-1年", fn: () => shiftDate(0, 0, -1) },
            { label: "-1月", fn: () => shiftDate(0, -1, 0) },
            { label: "-1天", fn: () => shiftDate(-1, 0, 0) },
            { label: "+1天", fn: () => shiftDate(1, 0, 0) },
            { label: "+1月", fn: () => shiftDate(0, 1, 0) },
            { label: "+1年", fn: () => shiftDate(0, 0, 1) },
          ].map((btn) => (
            <Pressable
              key={btn.label}
              onPress={btn.fn}
              style={({ pressed }) => [
                styles.stepBtn,
                {
                  backgroundColor: colors.fill,
                  borderColor: colors.glassBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>

        <ThemedTextInput
          value={dateDraft}
          onChangeText={(text) => {
            setDateDraft(text)
            setDateError(null)
            const parsed = parsePixivDateString(text)
            if (parsed != null) {
              setSelectedTimestamp(parsed)
            }
          }}
          placeholder="YYYY-MM-DD（如 2024-08-01）"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleApply}
        />

        {dateError ? (
          <Text style={[styles.errorText, { color: colors.danger }]}>{dateError}</Text>
        ) : (
          <Text style={[styles.hintText, { color: colors.textTertiary }]}>
            可选范围：2007-09-09 至 {formatDateToPixivDate(getYesterdayTimestamp())}
          </Text>
        )}
      </SectionCard>

      <View style={styles.actions}>
        <ActionButton title="查询历史排行榜" onPress={handleApply} />
        <ActionButton title="取消" variant="secondary" onPress={onCancel} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 6,
    gap: 8,
  },
  padded: {
    paddingHorizontal: 16,
  },
  cardPad: {
    padding: 12,
    gap: 10,
  },
  pillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
  },
  presetRow: {
    gap: 8,
    paddingVertical: 2,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presetText: {
    fontSize: 12,
    fontWeight: "600",
  },
  stepperRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  stepBtn: {
    flex: 1,
    minWidth: 46,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  hintText: {
    fontSize: 12,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
  },
  actions: {
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 10,
  },
})
