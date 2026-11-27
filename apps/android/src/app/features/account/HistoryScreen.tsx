import React, { useEffect, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { FlashList } from "@shopify/flash-list"
import {
  novelThumbUrlOf,
  thumbUrlOf,
} from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  clearHistory,
  clearHistoryKind,
  getHistory,
  historyCount,
  onHistoryChanged,
  removeHistoryEntry,
  type HistoryContentKind,
  type HistoryEntry,
} from "../../../../../../Pix-Scripting/src/store/history"
import { cacheIllust } from "../../../../../../Pix-Scripting/src/store/illustCache"
import { cacheNovel } from "../../../../../../Pix-Scripting/src/store/novelCache"
import { updateSettings } from "../../../../../../Pix-Scripting/src/store/settings"
import {
  ChipBar,
  EmptyView,
  formatWordCount,
  HeaderIconButton,
  PixImage,
  ScreenHeader,
  ThemedTextInput,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

function formatViewedTime(ts: number): string {
  if (!ts) return ""
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return "刚刚"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function HistoryScreen() {
  const { colors, accent, accentSoft, settings } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [kind, setKind] = useState<HistoryContentKind>("illustration")
  const [query, setQuery] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    return onHistoryChanged(() => setRevision((v) => v + 1))
  }, [])

  const counts = useMemo(() => {
    void revision
    return {
      illustration: historyCount("illustration"),
      manga: historyCount("manga"),
      novel: historyCount("novel"),
    }
  }, [revision])

  const rawEntries = useMemo(() => {
    void revision
    return getHistory(kind)
  }, [kind, revision])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rawEntries
    return rawEntries.filter((entry) => {
      if (entry.kind === "illust") {
        const ill = entry.illustration
        if (ill.title?.toLowerCase().includes(q)) return true
        if (ill.user?.name?.toLowerCase().includes(q)) return true
        if (String(ill.id).includes(q)) return true
        return (ill.tags ?? []).some(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.translated_name && t.translated_name.toLowerCase().includes(q)),
        )
      }
      const nov = entry.novel
      if (nov.title?.toLowerCase().includes(q)) return true
      if (nov.user?.name?.toLowerCase().includes(q)) return true
      if (String(nov.id).includes(q)) return true
      return (nov.tags ?? []).some(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.translated_name && t.translated_name.toLowerCase().includes(q)),
      )
    })
  }, [rawEntries, query])

  const kindChips = useMemo<ChipItem<HistoryContentKind>[]>(() => {
    const list: ChipItem<HistoryContentKind>[] = [
      { value: "illustration", label: "插画", badge: counts.illustration },
      { value: "manga", label: "漫画", badge: counts.manga },
    ]
    if (!settings.hideNovels) {
      list.push({ value: "novel", label: "小说", badge: counts.novel })
    }
    return list
  }, [counts, settings.hideNovels])

  const kindLabel = kind === "illustration" ? "插画" : kind === "manga" ? "漫画" : "小说"

  async function handleClearMenu() {
    const totalAll = counts.illustration + counts.manga + counts.novel
    if (totalAll === 0) return
    const idx = await overlay.presentActionSheet({
      title: "清理浏览记录",
      message: "删除操作不可撤销，请谨慎选择。",
      actions: [
        {
          label: `清空当前「${kindLabel}」记录 (${counts[kind]} 条)`,
          destructive: true,
          disabled: counts[kind] === 0,
        },
        {
          label: `清空全部浏览记录 (${totalAll} 条)`,
          destructive: true,
        },
      ],
    })
    if (idx === 0) {
      const ok = await overlay.confirm({
        title: `清空${kindLabel}记录`,
        message: `确定清空全部 ${counts[kind]} 条${kindLabel}浏览记录吗？`,
        confirmLabel: "清空",
        destructive: true,
      })
      if (!ok) return
      clearHistoryKind(kind)
      overlay.showToast(`已清空${kindLabel}浏览记录`, "info")
    } else if (idx === 1) {
      const ok = await overlay.confirm({
        title: "清空全部浏览记录",
        message: `确定清空全部 ${totalAll} 条浏览记录吗？`,
        confirmLabel: "全部清空",
        destructive: true,
      })
      if (!ok) return
      clearHistory()
      overlay.showToast("已清空全部浏览记录", "info")
    }
  }

  function handleOpenEntry(entry: HistoryEntry) {
    if (entry.kind === "illust") {
      cacheIllust(entry.illustration)
      nav.push({ name: "illust", id: entry.illustration.id, seed: entry.illustration })
    } else {
      cacheNovel(entry.novel)
      nav.push({ name: "novel", id: entry.novel.id, seed: entry.novel })
    }
  }

  function handleDeleteOne(entry: HistoryEntry) {
    try {
      triggerHaptic("light")
    } catch {}
    const id = entry.kind === "illust" ? entry.illustration.id : entry.novel.id
    removeHistoryEntry(entry.kind, id)
    overlay.showToast("已删除该条记录", "info")
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="浏览记录"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          <View style={styles.headerActions}>
            <HeaderIconButton
              label="统计"
              onPress={() => nav.push({ name: "historyAnalytics", initialScope: kind })}
            />
            <HeaderIconButton
              label="清空"
              color={colors.danger}
              disabled={counts.illustration + counts.manga + counts.novel === 0}
              onPress={() => void handleClearMenu()}
            />
          </View>
        }
        bottom={
          <View>
            <ChipBar<HistoryContentKind>
              items={kindChips}
              selected={kind}
              onSelect={setKind}
            />
            <View style={styles.searchRow}>
              <ThemedTextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`搜索${kindLabel}标题、画师、标签或 ID…`}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery("")}
                  hitSlop={8}
                  style={[styles.clearBtn, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
      />

      {!settings.recordHistory ? (
        <View
          style={[
            styles.noticeBar,
            { backgroundColor: accentSoft, borderColor: accent },
          ]}
        >
          <Text style={[styles.noticeText, { color: colors.text }]}>
            已暂停记录浏览历史
          </Text>
          <Pressable
            onPress={() => {
              updateSettings({ recordHistory: true })
              overlay.showToast("已开启浏览记录", "success")
            }}
            style={[styles.noticeBtn, { backgroundColor: accent }]}
          >
            <Text style={styles.noticeBtnText}>立即开启</Text>
          </Pressable>
        </View>
      ) : null}

      <FlashList
        data={filtered}
        estimatedItemSize={98}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) =>
          item.kind === "illust"
            ? `i-${item.illustration.id}`
            : `n-${item.novel.id}`
        }
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: effectiveBottomInset(insets) + 28,
        }}
        ListEmptyComponent={
          <EmptyView
            title={query.trim() ? "没有匹配的历史记录" : `暂无${kindLabel}浏览记录`}
            subtitle={
              query.trim()
                ? "请尝试更换关键词"
                : "浏览作品后会自动保存在本地设备中"
            }
          />
        }
        renderItem={({ item }) => {
          const isIllust = item.kind === "illust"
          const title = isIllust ? item.illustration.title : item.novel.title
          const authorName = isIllust
            ? item.illustration.user?.name
            : item.novel.user?.name
          const thumb = isIllust
            ? thumbUrlOf(item.illustration)
            : novelThumbUrlOf(item.novel)
          const bookmarked = isIllust
            ? item.illustration.is_bookmarked
            : item.novel.is_bookmarked
          const tags = (isIllust ? item.illustration.tags : item.novel.tags) ?? []
          const badge = isIllust
            ? item.illustration.type === "ugoira"
              ? "动图"
              : (item.illustration.page_count ?? 1) > 1
                ? `${item.illustration.page_count}P`
                : null
            : item.novel.text_length
              ? formatWordCount(item.novel.text_length)
              : null

          return (
            <Pressable
              onPress={() => handleOpenEntry(item)}
              style={[
                styles.rowCard,
                { backgroundColor: colors.surface, borderColor: colors.glassBorder },
              ]}
            >
              <PixImage url={thumb} borderRadius={10} style={styles.thumb} />
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                    {title || "未命名作品"}
                  </Text>
                  {bookmarked ? (
                    <Text style={[styles.heart, { color: colors.pink }]}>♥</Text>
                  ) : null}
                </View>

                <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {authorName || "未知画师"}
                  {badge ? ` · ${badge}` : ""}
                </Text>

                {tags.length > 0 ? (
                  <Text style={[styles.tags, { color: colors.textTertiary }]} numberOfLines={1}>
                    {tags
                      .slice(0, 4)
                      .map((t) => `#${t.translated_name || t.name}`)
                      .join(" ")}
                  </Text>
                ) : null}

                <Text style={[styles.time, { color: colors.textTertiary }]}>
                  {formatViewedTime(item.viewedAt)}
                </Text>
              </View>

              <Pressable
                onPress={() => handleDeleteOne(item)}
                hitSlop={10}
                style={[styles.delBtn, { backgroundColor: colors.fill }]}
              >
                <Text style={[styles.delBtnText, { color: colors.textSecondary }]}>✕</Text>
              </Pressable>
            </Pressable>
          )
        }}
      />
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
    gap: 2,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  noticeBar: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noticeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  noticeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  noticeBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 11,
  },
  thumb: {
    width: 68,
    height: 68,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  heart: {
    fontSize: 13,
  },
  meta: {
    fontSize: 12,
  },
  tags: {
    fontSize: 11,
  },
  time: {
    fontSize: 11,
  },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  delBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
})
