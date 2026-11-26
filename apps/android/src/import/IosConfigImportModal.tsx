import React, { useState } from "react"
import {
  ActivityIndicator,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import {
  importIosConfigJson,
  importIosZipBackup,
  importWithPixivRefreshToken,
} from "./iosConfigImporter"
import { ScriptingFileManager, ScriptingPasteboard } from "../scripting/hostGlobals"

const { PixSystemBridge } = NativeModules

export function IosConfigImportModal({
  visible,
  initialJsonText,
  initialZipPath,
  onClose,
  onImported,
}: {
  visible: boolean
  initialJsonText?: string | null
  initialZipPath?: string | null
  onClose: () => void
  onImported?: (message: string, authChanged: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshTokenInput, setRefreshTokenInput] = useState("")
  const [jsonInput, setJsonInput] = useState(initialJsonText ?? "")

  React.useEffect(() => {
    if (initialJsonText) setJsonInput(initialJsonText)
  }, [initialJsonText])

  React.useEffect(() => {
    if (visible && initialZipPath) {
      void handleZipFile(initialZipPath)
    }
  }, [visible, initialZipPath])

  async function handlePickFile() {
    if (busy) return
    setBusy(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const files = await PixSystemBridge?.pickFiles?.(["application/json", "application/zip", "text/plain", "*/*"])
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
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent={true} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>导入 iOS 版配置</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeText}>完成</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.desc}>
              支持导入 iOS 版「设置 → 跨设备同步」导出的 `Pix-Scripting-Sync-*.json`、iCloud 目录中的原始 `settings.json` / `novel_reader_settings.json` / `blocklist.json`、AI 模型配置 JSON 或整包 `.zip` 备份。
            </Text>

            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => void handlePickFile()} disabled={busy}>
                <Text style={styles.primaryBtnText}>从文件导入 (.json / .zip)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handleClipboardImport()} disabled={busy}>
                <Text style={styles.secondaryBtnText}>从剪贴板读取导入</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>或直接粘贴配置 JSON</Text>
            <TextInput
              value={jsonInput}
              onChangeText={setJsonInput}
              placeholder='{"format":"pix-scripting-sync",...} 或 settings.json 内容'
              placeholderTextColor="#9CA3AF"
              multiline={true}
              style={styles.textArea}
            />
            <TouchableOpacity
              style={[styles.secondaryBtn, !jsonInput.trim() && styles.disabledBtn]}
              onPress={() => void handleApplyPastedJson()}
              disabled={busy || !jsonInput.trim()}
            >
              <Text style={styles.secondaryBtnText}>解析并应用粘贴的 JSON</Text>
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>可选：使用 Pixiv Refresh Token 直接登录</Text>
            <TextInput
              value={refreshTokenInput}
              onChangeText={setRefreshTokenInput}
              placeholder="粘贴 Pixiv OAuth refresh_token（若已先导入自定义网关将自动生效）"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, !refreshTokenInput.trim() && styles.disabledBtn]}
              onPress={() => void handleTokenLogin()}
              disabled={busy || !refreshTokenInput.trim()}
            >
              <Text style={styles.primaryBtnText}>使用 Token 登录</Text>
            </TouchableOpacity>

            {busy ? <ActivityIndicator style={{ marginTop: 12 }} color="#007AFF" /> : null}
            {statusMsg ? <Text style={styles.successBox}>{statusMsg}</Text> : null}
            {errorMsg ? <Text style={styles.errorBox}>{errorMsg}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  dismissArea: { height: 70 },
  sheet: {
    flex: 1,
    backgroundColor: "#F2F2F7",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  title: { fontSize: 17, fontWeight: "700", color: "#111827" },
  closeText: { fontSize: 16, fontWeight: "600", color: "#007AFF" },
  body: { padding: 16, gap: 12 },
  desc: { fontSize: 13, lineHeight: 19, color: "#4B5563" },
  btnRow: { gap: 10 },
  primaryBtn: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  secondaryBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
  },
  secondaryBtnText: { color: "#007AFF", fontSize: 15, fontWeight: "600" },
  disabledBtn: { opacity: 0.45 },
  sectionLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 6 },
  textArea: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    minHeight: 90,
    fontSize: 13,
    color: "#111827",
    textAlignVertical: "top",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
  },
  successBox: {
    backgroundColor: "#ECFDF5",
    color: "#065F46",
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: "#FEF2F2",
    color: "#991B1B",
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
  },
})
