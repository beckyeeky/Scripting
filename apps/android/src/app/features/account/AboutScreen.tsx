import React, { useMemo } from "react"
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native"
import { SCRIPT_VERSION } from "../../../../../../Pix-Scripting/src/config"
import {
  getAppMetadataSync,
  ScriptingPasteboard,
  ScriptingSafari,
} from "../../../scripting/hostGlobals"
import {
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SettingRow,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import {
  formatApplicationIdLabel,
  formatAppVersionLabel,
  formatVersionCodeLabel,
  formatVersionNameLabel,
  resolveAppMetadata,
} from "./appMetadata"

export function AboutScreen() {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  // 原生 BuildConfig 为唯一真实来源；旧包缺少 bridge 时退回共享 SCRIPT_VERSION，
  // 包名/构建号不猜测，直接显示未知。
  const appMetadata = useMemo(
    () => resolveAppMetadata(getAppMetadataSync(), SCRIPT_VERSION),
    [],
  )

  async function copyDiagnostics() {
    const info = [
      `App: Pix-Scripting Android`,
      `Version: ${formatAppVersionLabel(appMetadata)}`,
      `Package: ${formatApplicationIdLabel(appMetadata)}`,
      `Platform: ${Platform.OS} ${String(Platform.Version)}`,
      `Core: Shared Pix-Scripting TS Engine + React Native 0.76 Native UI`,
    ].join("\n")
    await ScriptingPasteboard.setString(info)
    overlay.showToast("已复制版本与环境信息", "success")
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="关于应用"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: effectiveBottomInset(insets) + 28 },
        ]}
      >
        <View style={styles.hero}>
          <View style={[styles.logoBox, { backgroundColor: accentSoft, borderColor: accent }]}>
            <Text style={[styles.logoGlyph, { color: accent }]}>P</Text>
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>Pix-Scripting</Text>
          <Text style={[styles.appVer, { color: colors.textSecondary }]}>
            Android 原生端 · {formatVersionNameLabel(appMetadata)}
          </Text>
          <Text style={[styles.appDesc, { color: colors.textTertiary }]}>
            插画、漫画、动图、特辑与 AI 翻译小说阅读客户端
          </Text>
        </View>

        <SectionHeader title="版本与包信息" />
        <SectionCard>
          <SettingRow title="应用版本" value={formatVersionNameLabel(appMetadata)} />
          <SettingRow title="构建号 (versionCode)" value={formatVersionCodeLabel(appMetadata)} />
          <SettingRow title="Android 包名" value={formatApplicationIdLabel(appMetadata)} />
          <SettingRow
            title="运行环境"
            value={`Android API ${String(Platform.Version)}`}
          />
          <SettingRow
            title="复制环境诊断信息"
            onPress={() => void copyDiagnostics()}
            showChevron={true}
            isLast={true}
          />
        </SectionCard>

        <SectionHeader title="架构说明" />
        <SectionCard style={styles.noteCard}>
          <Text style={[styles.noteLine, { color: colors.text }]}>
            • 原生 Android 界面：基于 React Native 0.76 与 FlashList 构建瀑布流与阅读交互，无 SwiftUI 模拟层开销。
          </Text>
          <Text style={[styles.noteLine, { color: colors.text }]}>
            • 核心共享逻辑：复用 Pix-Scripting 的 Pixiv API、OAuth PKCE、内容过滤、本地历史统计、下载任务调度及多协议 AI 翻译引擎。
          </Text>
          <Text style={[styles.noteLine, { color: colors.text }]}>
            • 跨设备互通：支持直接导入 iOS 版导出的同步 JSON、离线书库 ZIP 备份、AI 模型配置与 Refresh Token。
          </Text>
          <Text style={[styles.noteLine, { color: colors.text }]}>
            • 原生媒体加速：动图 (Ugoira) 导出使用 Android 原生 MediaCodec MP4 / GIF89a 编码，图片缓存支持 LRU 自动清理。
          </Text>
        </SectionCard>

        <SectionHeader title="相关链接" />
        <SectionCard>
          <SettingRow
            title="GitHub 仓库"
            subtitle="查看源码与更新日志"
            onPress={() => void ScriptingSafari.openURL("https://github.com/beckyeeky/Scripting")}
            showChevron={true}
          />
          <SettingRow
            title="Pixiv 官网"
            subtitle="https://www.pixiv.net"
            onPress={() => void ScriptingSafari.openURL("https://www.pixiv.net")}
            showChevron={true}
          />
          <SettingRow
            title="SauceNAO 识图服务"
            subtitle="管理与申请免费以图搜图 API Key"
            onPress={() => void ScriptingSafari.openURL("https://saucenao.com")}
            showChevron={true}
            isLast={true}
          />
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
    paddingTop: 12,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 6,
  },
  logoBox: {
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  logoGlyph: {
    fontSize: 34,
    fontWeight: "800",
  },
  appName: {
    fontSize: 22,
    fontWeight: "800",
  },
  appVer: {
    fontSize: 13,
    fontWeight: "600",
  },
  appDesc: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  noteCard: {
    padding: 14,
    gap: 10,
  },
  noteLine: {
    fontSize: 13,
    lineHeight: 20,
  },
})
