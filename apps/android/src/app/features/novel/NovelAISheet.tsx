import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  getNovelPageText,
  isAIAvailable,
  splitNovelPages,
  streamContinueNovel,
  streamSummarizeNovel,
} from "../../../../../../Pix-Scripting/src/api/aiService"
import { ActionButton, SegmentedControl, ThemedTextInput } from "../../components"
import { useOverlay } from "../../overlay/OverlayHost"
import { recordDiagnosticError } from "../../../scripting/diagnostics"
import { ScriptingPasteboard } from "../../../scripting/hostGlobals"
import { PolyfillAbortController } from "../../../scripting/polyfills"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

export interface NovelAISheetProps {
  title: string
  text: string
  currentPage?: number
  onOpenCustomAISettings: () => void
  onClose: () => void
}

export function NovelAISheet({
  title,
  text,
  currentPage = 1,
  onOpenCustomAISettings,
  onClose,
}: NovelAISheetProps) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const overlay = useOverlay()
  const aiReady = isAIAvailable()

  const [mode, setMode] = useState<"summary" | "continue">("summary")
  const [scope, setScope] = useState<"full" | "page">("full")
  const [instruction, setInstruction] = useState("")
  const [output, setOutput] = useState("")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<PolyfillAbortController | null>(null)

  const totalPages = splitNovelPages(text).length

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }

  const runTask = async () => {
    if (!aiReady) return
    stop()
    const ctrl = new PolyfillAbortController()
    abortRef.current = ctrl
    setRunning(true)
    setError(null)
    setOutput("")

    try {
      if (mode === "summary") {
        const usePage = scope === "page" && totalPages > 1
        const targetText = usePage ? getNovelPageText(text, currentPage) : text
        const res = await streamSummarizeNovel(targetText, {
          signal: ctrl.signal,
          pageInfo: usePage ? { current: currentPage, total: totalPages } : undefined,
          onChunk: (chunk) => {
            // onChunk 传的是本次请求的累计正文快照（与 iOS aiSheet 的 throttler.flush 语义一致），
            // 这里必须整体替换；用 prev + chunk 拼接会把累计文本反复累加，表现为正文从头反复刷。
            if (!ctrl.signal.aborted) setOutput(chunk)
          },
        })
        if (res && !ctrl.signal.aborted) {
          setOutput(res)
        }
      } else {
        const res = await streamContinueNovel(text, instruction, {
          signal: ctrl.signal,
          onChunk: (chunk) => {
            if (!ctrl.signal.aborted) setOutput(chunk)
          },
        })
        if (res && !ctrl.signal.aborted) {
          setOutput(res)
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError" && !ctrl.signal.aborted) {
        recordDiagnosticError({
          kind: "ai",
          code: err?.code || err?.name || "AI_NOVEL_TASK_FAILED",
          message: err?.message ?? String(err),
        })
        setError(err?.message ?? String(err))
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setRunning(false)
      }
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 20 },
      ]}
    >
      <Text style={[styles.novelTitle, { color: colors.textSecondary }]} numberOfLines={1}>
        {title}
      </Text>

      {!aiReady ? (
        <View style={[styles.card, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>未配置自定义 AI 模型</Text>
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
            请先在「设置 → 智能助手」配置可用模型后再使用导读总结与续写功能。
          </Text>
          <ActionButton
            title="前往智能助手设置"
            onPress={() => {
              onClose()
              onOpenCustomAISettings()
            }}
            style={{ marginTop: 8 }}
          />
        </View>
      ) : null}

      <SegmentedControl
        value={mode}
        onChange={(next) => {
          stop()
          setMode(next)
          setError(null)
        }}
        options={[
          { value: "summary", label: "导读总结" },
          { value: "continue", label: "AI 续写" },
        ]}
      />

      {mode === "summary" && totalPages > 1 ? (
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: "full", label: `全文总结 (${totalPages} 页)` },
            { value: "page", label: `当前第 ${currentPage} 页` },
          ]}
        />
      ) : null}

      {mode === "continue" ? (
        <ThemedTextInput
          value={instruction}
          onChangeText={setInstruction}
          multiline={true}
          placeholder="可选：输入续写方向、角色互动或文风要求…"
          style={styles.promptInput}
        />
      ) : null}

      <View style={styles.btnRow}>
        {running ? (
          <ActionButton title="停止生成" variant="danger" onPress={stop} style={{ flex: 1 }} />
        ) : (
          <ActionButton
            title={mode === "summary" ? "生成导读总结" : "开始 AI 续写"}
            disabled={!aiReady}
            onPress={() => void runTask()}
            style={{ flex: 1 }}
          />
        )}
        {output.trim().length > 0 ? (
          <ActionButton
            title="复制"
            variant="secondary"
            onPress={async () => {
              await ScriptingPasteboard.setString(output)
              overlay.showToast("已复制到剪贴板", "success")
            }}
          />
        ) : null}
      </View>

      {error ? (
        <View style={[styles.card, { backgroundColor: colors.fill, borderColor: colors.danger }]}>
          <Text style={[styles.cardBody, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}

      {running && !output ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={accent} />
          <Text style={[styles.cardBody, { color: colors.textSecondary }]}>正在流式生成中…</Text>
        </View>
      ) : null}

      {output ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
          <Text selectable={true} style={[styles.outputText, { color: colors.text }]}>
            {output}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  novelTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  promptInput: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 20,
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
  outputText: {
    fontSize: 14,
    lineHeight: 23,
  },
})
