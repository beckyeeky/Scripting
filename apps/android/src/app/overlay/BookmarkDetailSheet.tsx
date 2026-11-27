import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  addBookmark,
  addNovelBookmark,
  bookmarkDetail,
  bookmarkTags,
  novelBookmarkDetail,
  novelBookmarkTags,
  removeBookmark,
  removeNovelBookmark,
  type Visibility,
} from "../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import {
  ActionButton,
  SegmentedControl,
  ThemedTextInput,
} from "../components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"

export function BookmarkDetailSheet({
  type,
  id,
  onClose,
  onToast,
}: {
  type: "illust" | "novel"
  id: number
  onClose: () => void
  onToast?: (message: string, tone?: "info" | "success" | "error") => void
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [restrict, setRestrict] = useState<Visibility>("public")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const [customTagInput, setCustomTagInput] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const detail = await session.call((token) =>
        type === "illust" ? bookmarkDetail(id, token) : novelBookmarkDetail(id, token),
      )
      setIsBookmarked(detail.is_bookmarked)
      const nextRestrict: Visibility = detail.restrict === "private" ? "private" : "public"
      setRestrict(nextRestrict)

      const registered: string[] = []
      const allTags: string[] = []
      for (const t of detail.tags ?? []) {
        if (!t?.name) continue
        if (!allTags.includes(t.name)) allTags.push(t.name)
        if (t.is_registered && !registered.includes(t.name)) registered.push(t.name)
      }
      setSelectedTags(registered)

      try {
        const uid = session.userID
        const tagPage = await session.call((token) =>
          type === "illust" && uid
            ? bookmarkTags(uid, nextRestrict, token)
            : novelBookmarkTags(nextRestrict, token),
        )
        for (const item of tagPage.items ?? []) {
          if (item.name && !allTags.includes(item.name)) {
            allTags.push(item.name)
          }
        }
      } catch {
        // Optional user bookmark tag suggestions
      }
      setSuggestedTags(allTags.slice(0, 40))
    } catch (e: any) {
      setError(e?.message ?? "无法读取收藏详情")
    } finally {
      setLoading(false)
    }
  }, [type, id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag].slice(0, 10),
    )
  }

  function handleAddCustomTag() {
    const clean = customTagInput.trim()
    if (!clean) return
    if (!selectedTags.includes(clean)) {
      setSelectedTags((prev) => [...prev, clean].slice(0, 10))
    }
    if (!suggestedTags.includes(clean)) {
      setSuggestedTags((prev) => [clean, ...prev])
    }
    setCustomTagInput("")
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await session.call((token) =>
        type === "illust"
          ? addBookmark(id, restrict, selectedTags, token)
          : addNovelBookmark(id, restrict, token, selectedTags),
      )
      try {
        triggerHaptic("success")
      } catch {}
      onToast?.(restrict === "private" ? "已保存到私密收藏" : "已保存收藏", "success")
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "保存收藏失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await session.call((token) =>
        type === "illust" ? removeBookmark(id, token) : removeNovelBookmark(id, token),
      )
      try {
        triggerHaptic("selection")
      } catch {}
      onToast?.("已取消收藏", "info")
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "取消收藏失败")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    )
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 20 },
      ]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>可见范围</Text>
      <SegmentedControl<Visibility>
        value={restrict}
        onChange={setRestrict}
        options={[
          { value: "public", label: "公开收藏" },
          { value: "private", label: "私密收藏" },
        ]}
      />

      <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>
        添加标签（最多 10 个，已选 {selectedTags.length}）
      </Text>
      <View style={styles.addRow}>
        <ThemedTextInput
          value={customTagInput}
          onChangeText={setCustomTagInput}
          placeholder="输入自定义收藏标签"
          returnKeyType="done"
          onSubmitEditing={handleAddCustomTag}
          style={{ flex: 1 }}
        />
        <ActionButton
          title="添加"
          variant="secondary"
          onPress={handleAddCustomTag}
          disabled={!customTagInput.trim()}
          style={{ paddingHorizontal: 14 }}
        />
      </View>

      {selectedTags.length > 0 ? (
        <View style={styles.chipWrap}>
          {selectedTags.map((tag) => (
            <Pressable
              key={`sel-${tag}`}
              onPress={() => toggleTag(tag)}
              style={[styles.tagChip, { backgroundColor: accent, borderColor: accent }]}
            >
              <Text style={styles.tagChipTextActive}>#{tag} ×</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {suggestedTags.length > 0 ? (
        <>
          <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>
            作品与常用标签
          </Text>
          <View style={styles.chipWrap}>
            {suggestedTags.map((tag) => {
              const active = selectedTags.includes(tag)
              return (
                <Pressable
                  key={`sug-${tag}`}
                  onPress={() => toggleTag(tag)}
                  style={[
                    styles.tagChip,
                    {
                      backgroundColor: active ? accentSoft : colors.fill,
                      borderColor: active ? accent : colors.glassBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagChipText,
                      { color: active ? accent : colors.text },
                    ]}
                  >
                    #{tag}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}

      {error ? (
        <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          title={isBookmarked ? "更新收藏设置" : "确认收藏"}
          onPress={() => void handleSave()}
          loading={saving}
        />
        {isBookmarked ? (
          <ActionButton
            title="取消收藏"
            variant="danger"
            onPress={() => void handleRemove()}
            disabled={saving}
          />
        ) : null}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  tagChipTextActive: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  errorText: {
    fontSize: 13,
    marginTop: 6,
  },
  actions: {
    marginTop: 14,
    gap: 10,
  },
})
