import React, { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  NOVEL_TRANSLATION_TARGETS,
  type NovelTranslationTargetLanguage,
} from "../../../../../../Pix-Scripting/src/store/novelReaderSettings"
import type { TranslationDisplayMode } from "../../../../../../Pix-Scripting/src/store/novelTranslation"
import { ActionButton, SegmentedControl, ThemedTextInput, ToggleRow } from "../../components"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  useNovelTranslationHook,
  type UseNovelTranslationParams,
} from "./useNovelTranslationHook"

export interface NovelTranslationSheetProps extends UseNovelTranslationParams {
  onOpenCustomAISettings: () => void
  onClose: () => void
}

export function NovelTranslationSheet({
  novelId,
  title,
  caption,
  text,
  chunks,
  seriesId,
  onOpenCustomAISettings,
  onClose,
}: NovelTranslationSheetProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  // Live subscription to the singleton NovelTranslationSession (safe inside OverlayHost sheet closures)
  const translation = useNovelTranslationHook({
    novelId,
    title,
    caption,
    text,
    chunks,
    seriesId,
  })
  const snap = translation.snapshot

  const [glossaryDraft, setGlossaryDraft] = useState(snap?.glossary ?? "")
  const [glossaryLocked, setGlossaryLocked] = useState(Boolean(snap?.glossaryLocked))
  const [showGlossaryEditor, setShowGlossaryEditor] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (!showGlossaryEditor) {
      setGlossaryDraft(snap?.glossary ?? "")
      setGlossaryLocked(Boolean(snap?.glossaryLocked))
    }
  }, [snap?.glossary, snap?.glossaryLocked, showGlossaryEditor])

  const failedBlocks = snap
    ? Object.values(snap.blocks).filter((b) => b.status === "error")
    : []
  const progressRatio = snap && snap.total > 0 ? Math.min(1, snap.done / snap.total) : 0
  // 摘要/术语失败与对齐告警只放在折叠详情里，主状态仍以翻译进度为准
  const contextErrors: string[] = []
  if (snap?.summaryError) contextErrors.push(`标题、简介与摘要：${snap.summaryError}`)
  if (snap?.glossaryError) contextErrors.push(`术语表：${snap.glossaryError}`)
  const alignmentWarnings = translation.alignmentWarnings
  const hasDetails = contextErrors.length > 0 || alignmentWarnings.length > 0

  const phaseText =
    snap?.phase === "summary"
      ? "正在生成译名与剧情摘要…"
      : snap?.phase === "glossary"
        ? "正在提取角色与专有名词术语表…"
        : snap?.phase === "translating"
          ? `正在翻译正文（${snap.done}/${snap.total}）…`
          : snap && snap.total > 0 && snap.done === snap.total && snap.failed === 0
            ? "全文翻译已完成"
            : snap && snap.done > 0
              ? `已完成 ${snap.done}/${snap.total} 段`
              : "尚未开始翻译"

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 20 },
      ]}
    >
      {!translation.aiAvailable ? (
        <View style={[styles.warnBox, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}>
          <Text style={[styles.warnTitle, { color: colors.text }]}>未配置 AI 翻译模型</Text>
          <Text style={[styles.warnBody, { color: colors.textSecondary }]}>
            Android 版请先在「设置 → 智能助手」配置 OpenAI / Gemini / Claude / DeepSeek 或 Grok OAuth 模型。
          </Text>
          <ActionButton
            title="前往配置智能助手"
            onPress={() => {
              onClose()
              onOpenCustomAISettings()
            }}
            style={{ marginTop: 10 }}
          />
        </View>
      ) : null}

      {/* Display Mode */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>显示模式</Text>
      <SegmentedControl<TranslationDisplayMode>
        value={snap?.mode ?? "original"}
        onChange={(mode) => translation.setMode(mode)}
        options={[
          { value: "original", label: "原文" },
          { value: "translated", label: "译文" },
        ]}
      />

      {/* Target Language */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>目标语言</Text>
      <View style={styles.langRow}>
        {NOVEL_TRANSLATION_TARGETS.map((item) => {
          const active = translation.targetLanguage === item.id
          return (
            <Pressable
              key={item.id}
              onPress={() => translation.setTargetLanguage(item.id as NovelTranslationTargetLanguage)}
              style={[
                styles.langChip,
                {
                  backgroundColor: active ? accentSoft : colors.surface,
                  borderColor: active ? accent : colors.glassBorder,
                },
              ]}
            >
              <Text style={[styles.langChipText, { color: active ? accent : colors.text }]}>
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {/* Progress & Controls */}
      <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
        <View style={styles.statusHeader}>
          <Text style={[styles.statusPhase, { color: colors.text }]}>{phaseText}</Text>
          {snap && snap.total > 0 ? (
            <Text style={[styles.statusPct, { color: accent }]}>
              {Math.round(progressRatio * 100)}%
            </Text>
          ) : null}
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.fill }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: accent, width: `${Math.round(progressRatio * 100)}%` },
            ]}
          />
        </View>
        {snap?.message ? (
          <Text style={[styles.metaWarn, { color: colors.orange }]}>{snap.message}</Text>
        ) : null}
        {snap && snap.stale > 0 ? (
          <Text style={[styles.metaWarn, { color: colors.orange }]}>
            检测到 {snap.stale} 个段落原文或模型配置已变化，点击「继续 / 重译」刷新。
          </Text>
        ) : null}
        {translation.providerNotice ? (
          <Text style={[styles.metaText, { color: colors.textTertiary }]}>
            {translation.providerNotice}
          </Text>
        ) : null}
        {hasDetails ? (
          <>
            <Pressable
              onPress={() => setShowDetails((v) => !v)}
              style={[styles.detailToggle, { borderTopColor: colors.separator }]}
            >
              <Text
                style={[
                  styles.detailToggleText,
                  { color: contextErrors.length > 0 ? colors.orange : colors.textSecondary },
                ]}
              >
                {contextErrors.length > 0
                  ? `上下文生成有 ${contextErrors.length} 项错误`
                  : `对齐提示 ${alignmentWarnings.length} 条`}
              </Text>
              <Text style={[styles.detailToggleAction, { color: accent }]}>
                {showDetails ? "收起详情" : "查看详情"}
              </Text>
            </Pressable>
            {showDetails ? (
              <View style={styles.detailBody}>
                {contextErrors.map((text) => (
                  <Text key={text} style={[styles.metaWarn, { color: colors.orange }]}>
                    {text}
                  </Text>
                ))}
                {alignmentWarnings.map((text, index) => (
                  <Text
                    key={`${index}-${text}`}
                    style={[styles.metaText, { color: colors.textSecondary }]}
                  >
                    {text}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        {snap?.running ? (
          <ActionButton
            title="暂停翻译"
            variant="danger"
            onPress={() => translation.pause()}
            style={styles.flexBtn}
          />
        ) : (
          <ActionButton
            title={snap && snap.done > 0 ? "继续翻译 / 补译" : "开始翻译全文"}
            variant="primary"
            disabled={!translation.aiAvailable}
            onPress={() => void translation.start()}
            style={styles.flexBtn}
          />
        )}
        {snap && (snap.failed > 0 || snap.stale > 0) && !snap.running ? (
          <ActionButton
            title={`重试 (${snap.failed + snap.stale})`}
            variant="secondary"
            onPress={() => void translation.retryPending()}
          />
        ) : null}
      </View>

      {snap && (snap.done > 0 || snap.translatedTitle) ? (
        <ActionButton
          title="清空本篇译文缓存"
          variant="ghost"
          onPress={() => translation.clear()}
        />
      ) : null}

      {/* Translated Title & Summary */}
      {snap?.translatedTitle || snap?.summary ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
          {snap.translatedTitle ? (
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              译名：{snap.translatedTitle}
            </Text>
          ) : null}
          {snap.summary ? (
            <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
              {snap.summary}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Glossary */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
        <View style={styles.statusHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            术语表 ({snap?.glossaryCount ?? 0} 词{snap?.glossaryLocked ? " · 已锁定" : ""})
          </Text>
          <Pressable onPress={() => setShowGlossaryEditor((v) => !v)}>
            <Text style={{ color: accent, fontSize: 13, fontWeight: "600" }}>
              {showGlossaryEditor ? "收起" : "编辑"}
            </Text>
          </Pressable>
        </View>
        {showGlossaryEditor ? (
          <View style={{ gap: 8, marginTop: 6 }}>
            <ThemedTextInput
              value={glossaryDraft}
              onChangeText={setGlossaryDraft}
              multiline={true}
              placeholder="每行格式：类别｜原文｜译名｜备注"
              style={styles.glossaryInput}
            />
            <ToggleRow
              title="锁定术语表"
              subtitle="锁定后不再自动重写，始终注入翻译提示词"
              value={glossaryLocked}
              onValueChange={setGlossaryLocked}
              isLast={true}
            />
            <ActionButton
              title="保存术语表"
              variant="secondary"
              onPress={() => {
                translation.setGlossary(glossaryDraft, glossaryLocked)
                setShowGlossaryEditor(false)
              }}
            />
          </View>
        ) : snap?.glossary ? (
          <Text style={[styles.cardBody, { color: colors.textSecondary }]} numberOfLines={6}>
            {snap.glossary}
          </Text>
        ) : (
          <Text style={[styles.metaText, { color: colors.textTertiary }]}>
            开始翻译长篇或系列作品时会自动提取角色名与专有术语，也可手动添加并锁定。
          </Text>
        )}
      </View>

      {/* Failed Blocks */}
      {failedBlocks.length > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.danger }]}>
            翻译失败段落 ({failedBlocks.length})
          </Text>
          {failedBlocks.map((b) => (
            <View key={b.id} style={[styles.failRow, { borderTopColor: colors.separator }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.failId, { color: colors.text }]} numberOfLines={1}>
                  {b.id} · {b.original.slice(0, 28)}
                </Text>
                <Text style={[styles.failErr, { color: colors.textSecondary }]} numberOfLines={2}>
                  {b.error || "翻译失败"}
                </Text>
              </View>
              <ActionButton
                title="重试"
                variant="secondary"
                disabled={snap?.running}
                onPress={() => void translation.retryBlock(b.id)}
                style={styles.miniRetry}
              />
            </View>
          ))}
        </View>
      ) : null}
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
    marginTop: 4,
  },
  warnBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  warnTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  warnBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  langRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  langChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  statusCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  statusPhase: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  statusPct: {
    fontSize: 13,
    fontWeight: "700",
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  metaText: {
    fontSize: 12,
    lineHeight: 17,
  },
  metaWarn: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  detailToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  detailToggleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  detailToggleAction: {
    fontSize: 12,
    fontWeight: "600",
  },
  detailBody: {
    gap: 5,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  flexBtn: {
    flex: 1,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 20,
  },
  glossaryInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  failRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  failId: {
    fontSize: 13,
    fontWeight: "600",
  },
  failErr: {
    fontSize: 12,
  },
  miniRetry: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
})
