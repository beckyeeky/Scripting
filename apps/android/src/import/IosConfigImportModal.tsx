import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { ActionButton, ThemedTextInput } from "../app/components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../app/theme/insets"
import { useAppTheme } from "../app/theme/ThemeProvider"
import { ScriptingFileManager, ScriptingPasteboard } from "../scripting/hostGlobals"
import {
  importIosConfigJson,
  importIosZipBackup,
  importWithPixivRefreshToken,
} from "./iosConfigImporter"

const { PixSystemBridge } = NativeModules

export interface IosConfigImportContentProps {
  initialJsonText?: string | null
  initialZipPath?: string | null
  onClose: () => void
  onImported?: (message: string, authChanged: boolean) => void
}

export function IosConfigImportContent({
  initialJsonText,
  initialZipPath,
  onClose,
  onImported,
}: IosConfigImportContentProps) {
  const { colors, accent, isDark } = useAppTheme()
  const insets = useSafeInsets()

  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshTokenInput, setRefreshTokenInput] = useState("")
  const [jsonInput, setJsonInput] = useState(initialJsonText ?? "")

  useEffect(() => {
    if (initialJsonText) setJsonInput(initialJsonText)
  }, [initialJsonText])

  useEffect(() => {
    if (initialZipPath) {
      void handleZipFile(initialZipPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialZipPath])

  async function handlePickFile() {
    if (busy) return
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const files = await PixSystemBridge?.pickFiles?.([
        "application/json",
        "application/zip",
        "text/plain",
        "*/*",
      ])
      const picked = Array.isArray(files) ? files[0] : null
      if (!picked?.filePath) {
        setBusy(false)
        return
      }
      if (String(picked.name || picked.filePath).toLowerCase().endsWith(".zip")) {
        await handleZipFile(picked.filePath)
      } else {
        const content = ScriptingFileManager.readAsStringSync(picked.filePath)
        const res = await importIosConfigJson(content)
        setStatusMsg(res.message)
        onImported?.(res.message, res.appliedAuthSession)
        if (res.appliedAuthSession) onClose()
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleZipFile(zipPath: string) {
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const res = await importIosZipBackup(zipPath)
      setStatusMsg(res.message)
      onImported?.(res.message, res.appliedAuthSession)
      if (res.appliedAuthSession) onClose()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleClipboardImport() {
    if (busy) return
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const text = await ScriptingPasteboard.getString()
      if (!text || !text.trim()) {
        throw new Error("剪贴板为空，请先从 iOS 端复制同步数据包或 settings.json")
      }
      const res = await importIosConfigJson(text)
      setStatusMsg(res.message)
      onImported?.(res.message, res.appliedAuthSession)
      if (res.appliedAuthSession) onClose()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleApplyPastedJson() {
    if (busy || !jsonInput.trim()) return
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const res = await importIosConfigJson(jsonInput)
      setStatusMsg(res.message)
      onImported?.(res.message, res.appliedAuthSession)
      if (res.appliedAuthSession) onClose()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleTokenLogin() {
    if (busy || !refreshTokenInput.trim()) return
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      await importWithPixivRefreshToken(refreshTokenInput)
      const msg = "已通过 Refresh Token 登录 Pixiv"
      setStatusMsg(msg)
      onImported?.(msg, true)
      onClose()
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.body,
        { paddingBottom: effectiveBottomInset(insets) + 24 },
      ]}
    >
      <Text style={[styles.desc, { color: colors.textSecondary }]}>
        支持导入 iOS 版「设置 → 跨设备同步」导出的 Pix-Scripting-Sync-*.json、iCloud 原始 settings.json / novel_reader_settings.json / blocklist.json、AI 模型配置 JSON 或整包 .zip 备份。
      </Text>

      <View style={styles.btnRow}>
        <ActionButton
          title="从文件导入 (.json / .zip)"
          onPress={() => void handlePickFile()}
          disabled={busy}
        />
        <ActionButton
          title="从剪贴板读取导入"
          variant="secondary"
          onPress={() => void handleClipboardImport()}
          disabled={busy}
        />
      </View>

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>或直接粘贴配置 JSON</Text>
      <ThemedTextInput
        value={jsonInput}
        onChangeText={setJsonInput}
        placeholder='{"format":"pix-scripting-sync",...} 或 settings.json 内容'
        multiline={true}
        style={styles.textArea}
      />
      <ActionButton
        title="解析并应用粘贴的 JSON"
        variant="secondary"
        onPress={() => void handleApplyPastedJson()}
        disabled={busy || !jsonInput.trim()}
      />

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
        使用 Pixiv Refresh Token 直接登录
      </Text>
      <ThemedTextInput
        value={refreshTokenInput}
        onChangeText={setRefreshTokenInput}
        placeholder="粘贴 Pixiv OAuth refresh_token（自定义网关将自动生效）"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void handleTokenLogin()}
      />
      <ActionButton
        title="使用 Token 登录"
        onPress={() => void handleTokenLogin()}
        disabled={busy || !refreshTokenInput.trim()}
      />

      {busy ? <ActivityIndicator style={{ marginTop: 10 }} color={accent} /> : null}
      {statusMsg ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: isDark ? "rgba(48,209,88,0.18)" : "#ECFDF5" },
          ]}
        >
          <Text style={[styles.feedbackText, { color: isDark ? "#6EE7B7" : "#065F46" }]}>
            {statusMsg}
          </Text>
        </View>
      ) : null}
      {errorMsg ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: isDark ? "rgba(255,69,58,0.18)" : "#FEF2F2" },
          ]}
        >
          <Text style={[styles.feedbackText, { color: isDark ? "#FCA5A5" : "#991B1B" }]}>
            {errorMsg}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

/**
 * Backwards-compatible non-Modal overlay wrapper (avoids RN native Modal conflicts).
 * Primary usage in `src/app/` goes through `useOverlay().openIosImport(...)`.
 */
export function IosConfigImportModal({
  visible,
  initialJsonText,
  initialZipPath,
  onClose,
  onImported,
}: IosConfigImportContentProps & { visible: boolean }) {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()

  if (!visible) return null

  return (
    <View style={[styles.compatBackdrop, { backgroundColor: colors.backdrop }]}>
      <Pressable style={{ height: insets.top + 40 }} onPress={onClose} />
      <View style={[styles.compatSheet, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.compatHeader,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.separator,
            },
          ]}
        >
          <Text style={[styles.compatTitle, { color: colors.text }]}>导入 iOS 版配置</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.compatClose, { color: accent }]}>完成</Text>
          </Pressable>
        </View>
        <IosConfigImportContent
          initialJsonText={initialJsonText}
          initialZipPath={initialZipPath}
          onClose={onClose}
          onImported={onImported}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: {
    padding: 16,
    gap: 12,
  },
  desc: {
    fontSize: 13,
    lineHeight: 19,
  },
  btnRow: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  feedbackBox: {
    padding: 12,
    borderRadius: 10,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
  },
  compatBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 900,
    justifyContent: "flex-end",
  },
  compatSheet: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  compatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  compatTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  compatClose: {
    fontSize: 16,
    fontWeight: "600",
  },
})
