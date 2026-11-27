import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  loadNovelReaderSettings,
  onNovelReaderSettingsChanged,
  saveNovelReaderSettings,
  type BuiltinFontId,
  type NovelFontWeight,
  type NovelLayoutDirection,
  type NovelLineSpacingLevel,
  type NovelPageDisplayMode,
  type NovelReaderSettings,
} from "../../../../../../Pix-Scripting/src/store/novelReaderSettings"
import { SegmentedControl } from "../../components"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import type { NovelReaderThemeId } from "./novelHtmlBuilder"

const THEME_OPTIONS: ReadonlyArray<{ id: NovelReaderThemeId; label: string; bg: string; fg: string }> = [
  { id: "system", label: "系统", bg: "#8E8E93", fg: "#FFFFFF" },
  { id: "light", label: "纸白", bg: "#FAF9F6", fg: "#1C1C1E" },
  { id: "sepia", label: "护眼", bg: "#F4ECD8", fg: "#3B2F23" },
  { id: "dark", label: "夜间", bg: "#121216", fg: "#E5E5EA" },
]

const FONT_OPTIONS: ReadonlyArray<{ id: BuiltinFontId; label: string }> = [
  { id: "system", label: "系统默认" },
  { id: "songti", label: "宋体 / 明朝" },
  { id: "kaiti", label: "楷体" },
  { id: "yuanti", label: "圆体" },
  { id: "hiragino_mincho", label: "日文明朝" },
  { id: "hiragino_sans", label: "日文黑体" },
]

export interface NovelTypographySheetProps {
  initialTheme: NovelReaderThemeId
  onChangeSettings?: (next: NovelReaderSettings) => void
  onChangeTheme: (next: NovelReaderThemeId) => void
}

export function NovelTypographySheet({
  initialTheme,
  onChangeSettings,
  onChangeTheme,
}: NovelTypographySheetProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const [settings, setSettings] = useState<NovelReaderSettings>(() => loadNovelReaderSettings())
  const [readerTheme, setReaderTheme] = useState<NovelReaderThemeId>(initialTheme)

  useEffect(() => {
    return onNovelReaderSettingsChanged((next) => {
      setSettings(next)
    })
  }, [])

  const patch = (partial: Partial<NovelReaderSettings>) => {
    const updated = saveNovelReaderSettings(partial)
    setSettings(updated)
    onChangeSettings?.(updated)
  }

  const handleSelectTheme = (next: NovelReaderThemeId) => {
    setReaderTheme(next)
    onChangeTheme(next)
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 20 },
      ]}
    >
      {/* Theme */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>阅读主题</Text>
      <View style={styles.themeRow}>
        {THEME_OPTIONS.map((opt) => {
          const active = readerTheme === opt.id
          return (
            <Pressable
              key={opt.id}
              onPress={() => handleSelectTheme(opt.id)}
              style={[
                styles.themeChip,
                {
                  backgroundColor: opt.bg,
                  borderColor: active ? accent : colors.glassBorder,
                  borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.themeChipText, { color: opt.fg }]}>{opt.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {/* Direction */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>排版方向</Text>
      <SegmentedControl<NovelLayoutDirection>
        value={settings.layoutDirection}
        onChange={(layoutDirection) => patch({ layoutDirection })}
        options={[
          { value: "horizontal", label: "横向阅读" },
          { value: "vertical", label: "竖排文库 (Bunko)" },
        ]}
      />

      {/* Page Mode */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>分页样式</Text>
      <SegmentedControl<NovelPageDisplayMode>
        value={settings.pageDisplayMode}
        onChange={(pageDisplayMode) => patch({ pageDisplayMode })}
        options={[
          { value: "continuous", label: "连续滚动" },
          { value: "paged", label: "分页分隔" },
        ]}
      />

      {/* Font Size */}
      <View style={styles.sizeHeader}>
        <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>字号</Text>
        <Text style={[styles.sizeValue, { color: accent }]}>{settings.fontSize} px</Text>
      </View>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => patch({ fontSize: Math.max(14, settings.fontSize - 1) })}
          style={[styles.stepBtn, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>A-</Text>
        </Pressable>
        {[15, 17, 19, 22, 26].map((sz) => {
          const active = settings.fontSize === sz
          return (
            <Pressable
              key={sz}
              onPress={() => patch({ fontSize: sz })}
              style={[
                styles.presetBtn,
                {
                  backgroundColor: active ? accentSoft : colors.surface,
                  borderColor: active ? accent : colors.glassBorder,
                },
              ]}
            >
              <Text style={[styles.presetText, { color: active ? accent : colors.text }]}>{sz}</Text>
            </Pressable>
          )
        })}
        <Pressable
          onPress={() => patch({ fontSize: Math.min(32, settings.fontSize + 1) })}
          style={[styles.stepBtn, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}
        >
          <Text style={[styles.stepBtnText, { color: colors.text }]}>A+</Text>
        </Pressable>
      </View>

      {/* Font Weight */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>字重</Text>
      <SegmentedControl<NovelFontWeight>
        value={settings.fontWeight}
        onChange={(fontWeight) => patch({ fontWeight })}
        options={[
          { value: "regular", label: "常规" },
          { value: "medium", label: "中等" },
          { value: "bold", label: "加粗" },
        ]}
      />

      {/* Line Spacing */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>行距</Text>
      <SegmentedControl<NovelLineSpacingLevel>
        value={settings.lineSpacingLevel}
        onChange={(lineSpacingLevel) => patch({ lineSpacingLevel })}
        options={[
          { value: "compact", label: "紧凑" },
          { value: "normal", label: "标准" },
          { value: "loose", label: "宽松" },
        ]}
      />

      {/* Font Family */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>字体预设</Text>
      <View style={styles.fontGrid}>
        {FONT_OPTIONS.map((opt) => {
          const active = settings.fontId === opt.id
          return (
            <Pressable
              key={opt.id}
              onPress={() => patch({ fontId: opt.id })}
              style={[
                styles.fontChip,
                {
                  backgroundColor: active ? accentSoft : colors.surface,
                  borderColor: active ? accent : colors.glassBorder,
                },
              ]}
            >
              <Text style={[styles.fontChipText, { color: active ? accent : colors.text }]}>
                {opt.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
  },
  themeRow: {
    flexDirection: "row",
    gap: 8,
  },
  themeChip: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  themeChipText: {
    fontSize: 13,
    fontWeight: "700",
  },
  sizeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  sizeValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  presetText: {
    fontSize: 13,
    fontWeight: "600",
  },
  fontGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fontChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fontChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
})
