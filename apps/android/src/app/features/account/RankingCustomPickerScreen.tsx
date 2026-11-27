import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  ALL_ILLUST_RANKING_OPTIONS,
  ALL_MANGA_RANKING_OPTIONS,
  ALL_NOVEL_RANKING_OPTIONS,
  getVisibleRankingOptions,
  loadSettings,
  onSettingsChanged,
  resetCustomRankingKind,
  updateSettings,
  type AppSettings,
  type RankingOptionDef,
} from "../../../../../../Pix-Scripting/src/store/settings"
import { ScriptingDevice } from "../../../scripting/hostGlobals"
import {
  HeaderIconButton,
  ScreenHeader,
  SectionCard,
  SectionHeader,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

type PickerKind = "illust" | "manga" | "novel"

function kindTitle(kind: PickerKind): string {
  if (kind === "illust") return "自定义插画榜单"
  if (kind === "manga") return "自定义漫画榜单"
  return "自定义小说榜单"
}

function getAllOptions(kind: PickerKind): ReadonlyArray<RankingOptionDef> {
  if (kind === "illust") return ALL_ILLUST_RANKING_OPTIONS
  if (kind === "manga") return ALL_MANGA_RANKING_OPTIONS
  return ALL_NOVEL_RANKING_OPTIONS
}

function getSettingsKey(kind: PickerKind, isTablet: boolean): keyof AppSettings {
  if (isTablet) {
    if (kind === "illust") return "customRankingIllustModesIpad"
    if (kind === "manga") return "customRankingMangaModesIpad"
    return "customRankingNovelModesIpad"
  }
  if (kind === "illust") return "customRankingIllustModes"
  if (kind === "manga") return "customRankingMangaModes"
  return "customRankingNovelModes"
}

export function RankingCustomPickerScreen({ kind }: { kind: PickerKind }) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const isTablet = ScriptingDevice.isiPad
  const maxItems = isTablet ? 5 : 3

  useEffect(() => {
    setSettings(loadSettings())
    return onSettingsChanged(() => {
      setSettings(loadSettings())
    })
  }, [])

  const settingsKey = getSettingsKey(kind, isTablet)
  const visibleOptions = getVisibleRankingOptions(getAllOptions(kind), settings)
  const rawSelected = (settings[settingsKey] as string[]) ?? []
  const selectedKeys = rawSelected.filter((k) => visibleOptions.some((o) => o.key === k))

  function saveModes(next: string[]) {
    updateSettings({ [settingsKey]: next } as Partial<AppSettings>)
    try {
      triggerHaptic("selection")
    } catch {}
  }

  function toggleMode(key: string) {
    if (selectedKeys.includes(key)) {
      if (selectedKeys.length <= 1) {
        overlay.showToast("至少需要保留 1 个榜单", "info")
        return
      }
      saveModes(selectedKeys.filter((k) => k !== key))
    } else {
      if (selectedKeys.length >= maxItems) {
        overlay.showToast(`当前屏幕最多可选择 ${maxItems} 个快捷榜单`, "info")
        return
      }
      saveModes([...selectedKeys, key])
    }
  }

  function moveMode(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= selectedKeys.length) return
    const next = [...selectedKeys]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    saveModes(next)
  }

  function handleReset() {
    resetCustomRankingKind(kind)
    overlay.showToast("已恢复默认榜单配置", "success")
  }

  const selectedDefs = selectedKeys
    .map((k) => visibleOptions.find((o) => o.key === k))
    .filter((o): o is RankingOptionDef => Boolean(o))

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={kindTitle(kind)}
        subtitle={`已选 ${selectedDefs.length} / ${maxItems}`}
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={<HeaderIconButton label="重置" onPress={handleReset} />}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: effectiveBottomInset(insets) + 28 },
        ]}
      >
        <View style={styles.hintWrap}>
          <Text style={[styles.hintText, { color: colors.textSecondary }]}>
            最多选择 {maxItems} 个榜单固定在排行榜顶部快捷栏。R18 / R18G / AI 榜单受「内容过滤」开关控制。
          </Text>
        </View>

        {selectedDefs.length > 0 ? (
          <>
            <SectionHeader title="已选顺序（点击箭头调整）" />
            <SectionCard>
              {selectedDefs.map((opt, idx) => (
                <View
                  key={opt.key}
                  style={[
                    styles.row,
                    idx < selectedDefs.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.separator,
                    },
                  ]}
                >
                  <View style={[styles.orderBadge, { backgroundColor: accentSoft }]}>
                    <Text style={[styles.orderText, { color: accent }]}>{idx + 1}</Text>
                  </View>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{opt.title}</Text>
                  <View style={styles.moveBtns}>
                    <Pressable
                      disabled={idx === 0}
                      onPress={() => moveMode(idx, -1)}
                      style={[
                        styles.moveBtn,
                        { backgroundColor: colors.fill },
                        idx === 0 && { opacity: 0.3 },
                      ]}
                    >
                      <Text style={[styles.moveBtnText, { color: colors.text }]}>↑</Text>
                    </Pressable>
                    <Pressable
                      disabled={idx === selectedDefs.length - 1}
                      onPress={() => moveMode(idx, 1)}
                      style={[
                        styles.moveBtn,
                        { backgroundColor: colors.fill },
                        idx === selectedDefs.length - 1 && { opacity: 0.3 },
                      ]}
                    >
                      <Text style={[styles.moveBtnText, { color: colors.text }]}>↓</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </SectionCard>
          </>
        ) : null}

        <SectionHeader title="全部可选榜单" />
        <SectionCard>
          {visibleOptions.map((opt, idx) => {
            const active = selectedKeys.includes(opt.key)
            return (
              <Pressable
                key={opt.key}
                onPress={() => toggleMode(opt.key)}
                style={[
                  styles.row,
                  idx < visibleOptions.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.separator,
                  },
                ]}
              >
                <View style={styles.optBody}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{opt.title}</Text>
                  <View style={styles.badges}>
                    {opt.requiresR18 ? (
                      <Text style={[styles.tagChip, { color: colors.pink, backgroundColor: `${colors.pink}18` }]}>
                        R-18
                      </Text>
                    ) : null}
                    {opt.requiresR18G ? (
                      <Text style={[styles.tagChip, { color: colors.danger, backgroundColor: `${colors.danger}18` }]}>
                        R-18G
                      </Text>
                    ) : null}
                    {opt.requiresAI ? (
                      <Text style={[styles.tagChip, { color: colors.purple, backgroundColor: `${colors.purple}18` }]}>
                        AI
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View
                  style={[
                    styles.checkCircle,
                    {
                      backgroundColor: active ? accent : "transparent",
                      borderColor: active ? accent : colors.textTertiary,
                    },
                  ]}
                >
                  {active ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              </Pressable>
            )
          })}
        </SectionCard>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingTop: 8,
  },
  hintWrap: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  orderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: {
    fontSize: 12,
    fontWeight: "700",
  },
  optBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  badges: {
    flexDirection: "row",
    gap: 4,
  },
  tagChip: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: "hidden",
  },
  moveBtns: {
    flexDirection: "row",
    gap: 6,
  },
  moveBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  moveBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkMark: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
})
