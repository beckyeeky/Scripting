import React, { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  BOOKMARK_TIERS,
  compileSearchQuery,
  stripBookmarkFilterFromWord,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import { loadSettings, type AppSettings } from "../../../../../../Pix-Scripting/src/store/settings"
import {
  NOVEL_MIN_TEXT_LENGTH_THRESHOLD,
  type AdvancedSearchParams,
  type BookmarkThreshold,
  type SearchCategory,
  type SearchMediaFilter,
  type SearchScope,
  type SearchSort,
} from "../../../../../../Pix-Scripting/src/types"
import {
  ActionButton,
  SectionCard,
  SectionHeader,
  ThemedTextInput,
  ToggleRow,
} from "../../components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { formatCountWithSeparators } from "./novelLengthFilter"

const SEARCH_DATE_MIN_TS = new Date("2007-09-09T00:00:00").getTime()

export function formatSearchDate(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function normalizeSearchDateRange(
  startTimestamp: number,
  endTimestamp: number,
  maxTimestamp = Date.now(),
): { startTimestamp: number; endTimestamp: number } {
  const clamp = (v: number, fallback: number) =>
    Number.isFinite(v) && v >= SEARCH_DATE_MIN_TS ? Math.min(v, maxTimestamp) : fallback
  const end = clamp(endTimestamp, maxTimestamp)
  const start = clamp(startTimestamp, end)
  return start <= end ? { startTimestamp: start, endTimestamp: end } : { startTimestamp: end, endTimestamp: start }
}

function parseDateInput(raw: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  const d = new Date(y, mo - 1, day)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null
  return d.getTime()
}

export function categoryFromParams(
  scope: SearchScope,
  mediaFilter: SearchMediaFilter,
): SearchCategory {
  if (scope === "novel") return "novel"
  if (mediaFilter === "illust") return "illust"
  if (mediaFilter === "manga") return "manga"
  if (mediaFilter === "ugoira") return "ugoira"
  return "all_illust"
}

export function scopeAndMediaFilterFromCategory(category: SearchCategory): {
  scope: SearchScope
  mediaFilter: SearchMediaFilter
} {
  if (category === "novel") return { scope: "novel", mediaFilter: "all" }
  if (category === "illust") return { scope: "illust", mediaFilter: "illust" }
  if (category === "manga") return { scope: "illust", mediaFilter: "manga" }
  if (category === "ugoira") return { scope: "illust", mediaFilter: "ugoira" }
  return { scope: "illust", mediaFilter: "all" }
}

export function getDefaultAdvancedSearchParams(
  scope: SearchScope = "illust",
  initialWord = "",
  mediaFilter: SearchMediaFilter = "all",
  settings?: AppSettings,
): AdvancedSearchParams {
  const resolvedSettings = settings ?? loadSettings()
  const now = Date.now()
  const weekAgo = now - 7 * 86400000
  const category = categoryFromParams(scope, mediaFilter)
  return {
    word: initialWord,
    category,
    scope: scope === "novel" ? "novel" : "illust",
    target: "partial_match_for_tags",
    sort: "date_desc",
    mediaFilter: scope === "novel" ? "all" : mediaFilter,
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: formatSearchDate(weekAgo),
    endDate: formatSearchDate(now),
    startTimestamp: weekAgo,
    endTimestamp: now,
    datePresetLabel: undefined,
    includeR18: resolvedSettings.showR18,
    includeR18G: resolvedSettings.showR18 && resolvedSettings.showR18G,
    includeAI: resolvedSettings.showAI,
    minTextLength: 0,
  }
}

export function inspectSearchQuery(rawQuery: string): {
  compiled: string
  errors: string[]
  hints: string[]
} {
  const cleanRaw = stripBookmarkFilterFromWord(rawQuery || "")
  if (!cleanRaw) return { compiled: "", errors: [], hints: [] }

  const normalized = cleanRaw
    .replace(/\u3000/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[—－]/g, "-")

  const errors: string[] = []
  const hints: string[] = []
  if (/(?:(^|\s)[-—－]|(^|[\s(])\b(?:or|not))\s*$/i.test(normalized)) {
    errors.push("末尾运算符后缺少关键词，请补全或删除")
  }
  const compiled = compileSearchQuery(cleanRaw)
  if (compiled && errors.length === 0) {
    const tokens = compiled.split(/\s+/).filter(Boolean)
    if (tokens.length > 0 && tokens.every((t) => t.startsWith("-"))) {
      errors.push("不能仅包含排除词，请至少输入一个正向关键词")
    }
  }
  if (compiled && compiled !== cleanRaw) {
    hints.push(`服务端检索式：${compiled}`)
  }
  return { compiled, errors, hints }
}

const ILLUST_TARGETS = [
  { value: "partial_match_for_tags", label: "标签部分匹配" },
  { value: "exact_match_for_tags", label: "标签完全匹配" },
  { value: "title_and_caption", label: "标题与简介" },
] as const

const NOVEL_TARGETS = [
  { value: "partial_match_for_tags", label: "标签部分匹配" },
  { value: "exact_match_for_tags", label: "标签完全匹配" },
  { value: "text", label: "正文全文" },
  { value: "keyword", label: "关键词综合" },
] as const

const SORT_OPTIONS: ReadonlyArray<{ value: SearchSort; label: string }> = [
  { value: "date_desc", label: "最新发布" },
  { value: "date_asc", label: "最早发布" },
  { value: "popular_desc", label: "热门降序" },
  { value: "popular_male_desc", label: "男性向热门" },
  { value: "popular_female_desc", label: "女性向热门" },
]

const DATE_PRESETS = [
  { label: "近7天", days: 7 },
  { label: "近30天", days: 30 },
  { label: "近90天", days: 90 },
  { label: "近1年", days: 365 },
] as const

export function SearchAdvancedSheet({
  currentParams,
  settings,
  onApply,
  onCancel,
}: {
  currentParams: AdvancedSearchParams
  settings: AppSettings
  onApply: (params: AdvancedSearchParams) => void
  onCancel: () => void
}) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()

  const [word, setWord] = useState(currentParams.word)
  const [category, setCategory] = useState<SearchCategory>(
    settings.hideNovels && currentParams.category === "novel"
      ? "all_illust"
      : currentParams.category,
  )
  const [target, setTarget] = useState(currentParams.target || "partial_match_for_tags")
  const [sort, setSort] = useState<SearchSort>(currentParams.sort || "date_desc")
  const [bookmarkThreshold, setBookmarkThreshold] = useState<BookmarkThreshold>(
    currentParams.bookmarkThreshold || 0,
  )
  const [useDateRange, setUseDateRange] = useState(Boolean(currentParams.useDateRange))
  const [startDateText, setStartDateText] = useState(
    currentParams.startDate || formatSearchDate(Date.now() - 30 * 86400000),
  )
  const [endDateText, setEndDateText] = useState(
    currentParams.endDate || formatSearchDate(Date.now()),
  )
  const [datePresetLabel, setDatePresetLabel] = useState<string | undefined>(
    currentParams.datePresetLabel,
  )
  const [dateError, setDateError] = useState<string | null>(null)
  const [includeR18, setIncludeR18] = useState(
    currentParams.includeR18 ?? settings.showR18,
  )
  const [includeR18G, setIncludeR18G] = useState(
    currentParams.includeR18G ?? (settings.showR18 && settings.showR18G),
  )
  const [includeAI, setIncludeAI] = useState(
    currentParams.includeAI ?? settings.showAI,
  )
  const [onlyLongNovel, setOnlyLongNovel] = useState(
    Boolean(currentParams.minTextLength && currentParams.minTextLength > 0),
  )

  const inspection = useMemo(() => inspectSearchQuery(word), [word])

  const categoryItems = useMemo(() => {
    const items: Array<{ value: SearchCategory; label: string }> = [
      { value: "all_illust", label: "全部插画·漫画" },
      { value: "illust", label: "仅插画" },
      { value: "manga", label: "仅漫画" },
      { value: "ugoira", label: "仅动图" },
    ]
    if (!settings.hideNovels) {
      items.push({ value: "novel", label: "小说" })
    }
    return items
  }, [settings.hideNovels])

  const targetOptions = category === "novel" ? NOVEL_TARGETS : ILLUST_TARGETS

  function handleSelectCategory(next: SearchCategory) {
    try {
      triggerHaptic("selection")
    } catch {}
    setCategory(next)
    const nextTargets = next === "novel" ? NOVEL_TARGETS : ILLUST_TARGETS
    if (!nextTargets.some((t) => t.value === target)) {
      setTarget("partial_match_for_tags")
    }
  }

  function insertOperator(snippet: string) {
    try {
      triggerHaptic("selection")
    } catch {}
    setWord((prev) => {
      const trimmed = prev.trimEnd()
      return trimmed ? `${trimmed} ${snippet}` : snippet
    })
  }

  function applyDatePreset(days: number, label: string) {
    const now = Date.now()
    const start = now - days * 86400000
    setUseDateRange(true)
    setStartDateText(formatSearchDate(start))
    setEndDateText(formatSearchDate(now))
    setDatePresetLabel(label)
    setDateError(null)
  }

  function handleReset() {
    const fresh = getDefaultAdvancedSearchParams("illust", word, "all", settings)
    setCategory(fresh.category)
    setTarget(fresh.target)
    setSort(fresh.sort)
    setBookmarkThreshold(0)
    setUseDateRange(false)
    setStartDateText(fresh.startDate)
    setEndDateText(fresh.endDate)
    setDatePresetLabel(undefined)
    setDateError(null)
    setIncludeR18(settings.showR18)
    setIncludeR18G(settings.showR18 && settings.showR18G)
    setIncludeAI(settings.showAI)
    setOnlyLongNovel(false)
  }

  function handleApply() {
    if (inspection.errors.length > 0) return

    let startTs = currentParams.startTimestamp || Date.now() - 30 * 86400000
    let endTs = currentParams.endTimestamp || Date.now()
    if (useDateRange) {
      const parsedStart = parseDateInput(startDateText)
      const parsedEnd = parseDateInput(endDateText)
      if (parsedStart == null || parsedEnd == null) {
        setDateError("请输入有效起止日期（YYYY-MM-DD）")
        return
      }
      const norm = normalizeSearchDateRange(parsedStart, parsedEnd)
      startTs = norm.startTimestamp
      endTs = norm.endTimestamp
    }

    const { scope, mediaFilter } = scopeAndMediaFilterFromCategory(category)
    onApply({
      word: word.trim(),
      category,
      scope,
      target,
      sort,
      mediaFilter,
      bookmarkThreshold,
      useDateRange,
      startDate: formatSearchDate(startTs),
      endDate: formatSearchDate(endTs),
      startTimestamp: startTs,
      endTimestamp: endTs,
      datePresetLabel: useDateRange ? datePresetLabel : undefined,
      includeR18,
      includeR18G: includeR18 && includeR18G,
      includeAI,
      minTextLength: category === "novel" && onlyLongNovel ? NOVEL_MIN_TEXT_LENGTH_THRESHOLD : 0,
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
      <SectionHeader title="关键词与布尔语法" />
      <SectionCard style={styles.cardPad}>
        <ThemedTextInput
          value={word}
          onChangeText={setWord}
          placeholder="输入关键词，支持空格(AND)、OR、-排除"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={handleApply}
        />
        <View style={styles.pillRow}>
          {[
            { label: "+ OR", value: "OR " },
            { label: "+ -排除", value: "-" },
            { label: "+ (分组)", value: "() " },
          ].map((op) => (
            <Pressable
              key={op.label}
              onPress={() => insertOperator(op.value)}
              style={[styles.miniChip, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
            >
              <Text style={[styles.miniChipText, { color: accent }]}>{op.label}</Text>
            </Pressable>
          ))}
        </View>
        {inspection.errors.map((err, i) => (
          <Text key={`e-${i}`} style={[styles.errorText, { color: colors.danger }]}>
            {err}
          </Text>
        ))}
        {inspection.hints.map((hint, i) => (
          <Text key={`h-${i}`} style={[styles.hintText, { color: colors.textSecondary }]}>
            {hint}
          </Text>
        ))}
      </SectionCard>

      <SectionHeader title="作品分类" />
      <SectionCard style={styles.cardPad}>
        <View style={styles.pillRow}>
          {categoryItems.map((item) => {
            const active = category === item.value
            return (
              <Pressable
                key={item.value}
                onPress={() => handleSelectCategory(item.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </SectionCard>

      <SectionHeader title="匹配范围与排序" />
      <SectionCard style={styles.cardPad}>
        <Text style={[styles.subLabel, { color: colors.textSecondary }]}>匹配方式</Text>
        <View style={styles.pillRow}>
          {targetOptions.map((item) => {
            const active = target === item.value
            return (
              <Pressable
                key={item.value}
                onPress={() => setTarget(item.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[styles.subLabel, { color: colors.textSecondary, marginTop: 6 }]}>
          排序方式（热门排序需 Pixiv 会员）
        </Text>
        <View style={styles.pillRow}>
          {SORT_OPTIONS.map((item) => {
            const active = sort === item.value
            return (
              <Pressable
                key={item.value}
                onPress={() => setSort(item.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.text }]}>
                  {item.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </SectionCard>

      <SectionHeader title="最低收藏数（users入り）" />
      <SectionCard style={styles.cardPad}>
        <View style={styles.pillRow}>
          {([0, ...BOOKMARK_TIERS] as BookmarkThreshold[]).map((tier) => {
            const active = bookmarkThreshold === tier
            return (
              <Pressable
                key={tier}
                onPress={() => setBookmarkThreshold(tier)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? accent : colors.fill,
                    borderColor: active ? accent : colors.glassBorder,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.text }]}>
                  {tier === 0 ? "不限" : `${tier}+`}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </SectionCard>

      <SectionHeader title="发布时间范围" />
      <SectionCard>
        <ToggleRow
          title="限定发布日期"
          subtitle={useDateRange ? `${startDateText} ~ ${endDateText}` : "不限时间"}
          value={useDateRange}
          onValueChange={setUseDateRange}
          isLast={!useDateRange}
        />
        {useDateRange ? (
          <View style={styles.dateBody}>
            <View style={styles.pillRow}>
              {DATE_PRESETS.map((p) => {
                const active = datePresetLabel === p.label
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => applyDatePreset(p.days, p.label)}
                    style={[
                      styles.miniChip,
                      {
                        backgroundColor: active ? accent : colors.fill,
                        borderColor: active ? accent : colors.glassBorder,
                      },
                    ]}
                  >
                    <Text style={[styles.miniChipText, { color: active ? "#FFFFFF" : colors.text }]}>
                      {p.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            <View style={styles.dateInputsRow}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.subLabel, { color: colors.textSecondary }]}>开始日期</Text>
                <ThemedTextInput
                  value={startDateText}
                  onChangeText={(t) => {
                    setStartDateText(t)
                    setDatePresetLabel(undefined)
                    setDateError(null)
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.subLabel, { color: colors.textSecondary }]}>结束日期</Text>
                <ThemedTextInput
                  value={endDateText}
                  onChangeText={(t) => {
                    setEndDateText(t)
                    setDatePresetLabel(undefined)
                    setDateError(null)
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
            {dateError ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>{dateError}</Text>
            ) : null}
          </View>
        ) : null}
      </SectionCard>

      <SectionHeader title="内容过滤" />
      <SectionCard>
        {category === "novel" ? (
          <ToggleRow
            title={`仅看 ${formatCountWithSeparators(NOVEL_MIN_TEXT_LENGTH_THRESHOLD)} 字以上`}
            value={onlyLongNovel}
            onValueChange={setOnlyLongNovel}
          />
        ) : null}
        {settings.showR18 ? (
          <ToggleRow
            title="包含 R-18 作品"
            value={includeR18}
            onValueChange={(v) => {
              setIncludeR18(v)
              if (!v) setIncludeR18G(false)
            }}
          />
        ) : null}
        {settings.showR18 && settings.showR18G ? (
          <ToggleRow
            title="包含 R-18G 作品"
            value={includeR18G}
            onValueChange={(v) => {
              setIncludeR18G(v)
              if (v) setIncludeR18(true)
            }}
          />
        ) : null}
        <ToggleRow
          title="包含 AI 生成作品"
          value={includeAI}
          onValueChange={setIncludeAI}
          isLast={true}
        />
      </SectionCard>

      <View style={styles.actions}>
        <ActionButton
          title="应用筛选并搜索"
          onPress={handleApply}
          disabled={inspection.errors.length > 0}
        />
        <View style={styles.secondaryRow}>
          <View style={{ flex: 1 }}>
            <ActionButton title="重置条件" variant="secondary" onPress={handleReset} />
          </View>
          <View style={{ flex: 1 }}>
            <ActionButton title="取消" variant="secondary" onPress={onCancel} />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 6,
    gap: 8,
  },
  cardPad: {
    padding: 12,
    gap: 10,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  miniChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  dateBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  dateInputsRow: {
    flexDirection: "row",
    gap: 10,
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
  secondaryRow: {
    flexDirection: "row",
    gap: 10,
  },
})
