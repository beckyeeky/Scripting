import React, { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  activeOutlineEntry,
  buildEpisodeOutline,
  outlineEntryLabel,
  type NovelOutlineEntry,
} from "../../../../../../Pix-Scripting/src/store/novelOutline"
import {
  anchorFromSearchHit,
  resolveSearchableChunks,
  searchNovelChunks,
  searchSummary,
  stepHitIndex,
  type NovelSearchHit,
} from "../../../../../../Pix-Scripting/src/store/novelSearch"
import type { NovelTranslationSnapshot } from "../../../../../../Pix-Scripting/src/store/novelTranslation"
import { ActionButton, SegmentedControl, ThemedTextInput } from "../../components"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import type { NovelChunkItem } from "./novelHtmlBuilder"

export interface JumpAnchorTarget {
  chunkId?: string | null
  page?: number
  offset?: number
  quote?: string
}

export interface NovelOutlineSearchSheetProps {
  novelId: number
  chunks: NovelChunkItem[]
  contentVersion: string
  translation?: NovelTranslationSnapshot | null
  currentChunkIndex?: number | null
  currentPage?: number | null
  initialTab?: "outline" | "search"
  onJump: (target: JumpAnchorTarget, label?: string) => void
  onClose: () => void
}

export function NovelOutlineSearchSheet({
  novelId,
  chunks,
  contentVersion,
  translation,
  currentChunkIndex,
  currentPage,
  initialTab = "outline",
  onJump,
  onClose,
}: NovelOutlineSearchSheetProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const [tab, setTab] = useState<"outline" | "search">(initialTab)
  const [query, setQuery] = useState("")
  const [activeHitIdx, setActiveHitIdx] = useState(-1)

  const searchableChunks = useMemo(
    () => resolveSearchableChunks(chunks, translation),
    [chunks, translation],
  )

  const outlineEntries = useMemo(
    () => buildEpisodeOutline(searchableChunks),
    [searchableChunks],
  )

  const currentOutline = useMemo(
    () =>
      activeOutlineEntry(outlineEntries, {
        chunkIndex: currentChunkIndex,
        page: currentPage,
      }),
    [outlineEntries, currentChunkIndex, currentPage],
  )

  const hits = useMemo(
    () => searchNovelChunks(searchableChunks, query),
    [searchableChunks, query],
  )

  const jumpToHit = (hit: NovelSearchHit, idx: number, closeAfter: boolean) => {
    setActiveHitIdx(idx)
    const chunk = searchableChunks[hit.chunkIndex]
    const anchor = anchorFromSearchHit(hit, novelId, chunk, contentVersion)
    onJump(
      {
        chunkId: anchor.chunkId,
        page: anchor.page,
        offset: anchor.offset,
        quote: anchor.quote,
      },
      `已定位第 ${idx + 1}/${hits.length} 处`,
    )
    if (closeAfter) onClose()
  }

  const stepHit = (dir: 1 | -1) => {
    if (hits.length === 0) return
    const nextIdx = stepHitIndex(activeHitIdx, hits.length, dir)
    if (nextIdx >= 0 && hits[nextIdx]) {
      jumpToHit(hits[nextIdx], nextIdx, false)
    }
  }

  const handleSelectOutline = (entry: NovelOutlineEntry) => {
    onJump(
      {
        chunkId: entry.id,
        page: entry.page,
        offset: 0,
      },
      `已跳转到「${outlineEntryLabel(entry)}」`,
    )
    onClose()
  }

  return (
    <View style={[styles.container, { paddingBottom: effectiveBottomInset(insets) + 12 }]}>
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "outline", label: `目录 (${outlineEntries.length})` },
          { value: "search", label: "全文检索" },
        ]}
        style={styles.seg}
      />

      {tab === "outline" ? (
        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        >
          {outlineEntries.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>
                本篇未包含章节或分页标记
              </Text>
              <Text style={[styles.emptySub, { color: colors.textTertiary }]}>
                可切换到「全文检索」定位关键词
              </Text>
            </View>
          ) : (
            outlineEntries.map((entry) => {
              const isCurrent = currentOutline?.id === entry.id
              return (
                <Pressable
                  key={`${entry.id}-${entry.chunkIndex}`}
                  onPress={() => handleSelectOutline(entry)}
                  style={({ pressed }) => [
                    styles.outlineRow,
                    {
                      backgroundColor: isCurrent ? accentSoft : colors.surface,
                      borderColor: isCurrent ? accent : colors.glassBorder,
                    },
                    pressed && { opacity: 0.72 },
                  ]}
                >
                  <Text
                    style={[
                      styles.outlineLabel,
                      { color: isCurrent ? accent : colors.text },
                      entry.kind === "newpage" && { fontWeight: "500" },
                    ]}
                    numberOfLines={2}
                  >
                    {entry.kind === "chapter" ? `§ ${outlineEntryLabel(entry)}` : outlineEntryLabel(entry)}
                  </Text>
                  <Text style={[styles.pageTag, { color: colors.textSecondary }]}>
                    P.{entry.page}
                  </Text>
                </Pressable>
              )
            })
          )}
        </ScrollView>
      ) : (
        <View style={styles.searchWrap}>
          <View style={styles.searchInputRow}>
            <ThemedTextInput
              value={query}
              onChangeText={(txt) => {
                setQuery(txt)
                setActiveHitIdx(-1)
              }}
              placeholder="输入关键词检索当前正文…"
              returnKeyType="search"
              onSubmitEditing={() => {
                if (hits.length > 0) jumpToHit(hits[0], 0, false)
              }}
              style={styles.searchInput}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => { setQuery(""); setActiveHitIdx(-1) }} style={styles.clearBtn}>
                <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>清除</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.summaryBar}>
            <Text style={[styles.summaryText, { color: colors.textSecondary }]} numberOfLines={1}>
              {searchSummary(hits, activeHitIdx, query)}
            </Text>
            {hits.length > 0 ? (
              <View style={styles.stepBtns}>
                <ActionButton
                  title="上一处"
                  variant="secondary"
                  onPress={() => stepHit(-1)}
                  style={styles.stepBtn}
                />
                <ActionButton
                  title="下一处"
                  variant="primary"
                  onPress={() => stepHit(1)}
                  style={styles.stepBtn}
                />
              </View>
            ) : null}
          </View>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
          >
            {hits.map((hit, idx) => {
              const isSelected = idx === activeHitIdx
              return (
                <Pressable
                  key={`${hit.chunkId}-${hit.matchStart}-${idx}`}
                  onPress={() => jumpToHit(hit, idx, true)}
                  style={({ pressed }) => [
                    styles.hitRow,
                    {
                      backgroundColor: isSelected ? accentSoft : colors.surface,
                      borderColor: isSelected ? accent : colors.glassBorder,
                    },
                    pressed && { opacity: 0.72 },
                  ]}
                >
                  <Text style={[styles.hitSnippet, { color: colors.text }]} numberOfLines={3}>
                    {hit.before ? `…${hit.before}` : ""}
                    <Text style={{ color: accent, fontWeight: "700" }}>{hit.match}</Text>
                    {hit.after ? `${hit.after}…` : ""}
                  </Text>
                  <Text style={[styles.hitMeta, { color: colors.textTertiary }]}>
                    第 {hit.page} 页 · 命中 #{idx + 1}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  seg: {
    marginBottom: 12,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 16,
  },
  emptyWrap: {
    paddingVertical: 36,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  emptySub: {
    fontSize: 13,
  },
  outlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  outlineLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  pageTag: {
    fontSize: 12,
    fontWeight: "600",
  },
  searchWrap: {
    flex: 1,
  },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  summaryText: {
    flex: 1,
    fontSize: 12,
  },
  stepBtns: {
    flexDirection: "row",
    gap: 6,
  },
  stepBtn: {
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  hitRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  hitSnippet: {
    fontSize: 14,
    lineHeight: 20,
  },
  hitMeta: {
    fontSize: 11,
  },
})
