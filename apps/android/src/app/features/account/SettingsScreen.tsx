import React, { useEffect, useState } from "react"
import {
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { syncWebCookies } from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { formatBytes } from "../../../../../../Pix-Scripting/src/downloader/downloadFileManager"
import {
  cacheUsageBytes,
  clearCache,
  onImageCacheChanged,
} from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  exportCrossDeviceSnapshotJson,
  getCrossDeviceSyncOverview,
} from "../../../../../../Pix-Scripting/src/store/crossDeviceSync"
import {
  formatCustomRankingSummary,
  getDetailImageQuality,
  getDownloadImageQuality,
  getFeedImageQuality,
  getWebBaseUrl,
  loadSettings,
  onSettingsChanged,
  resetNetworkSettings,
  resetSettings,
  updateSettings,
  type ApiGatewayMode,
  type AppSettings,
  type ColorSchemeMode,
  type DetailImageQuality,
  type DownloadImageQuality,
  type FeedColumnCap,
  type FeedImageQuality,
  type HapticFeedbackPreference,
  type ImageSourceMode,
  type LaunchPage,
  type UgoiraExportFormat,
} from "../../../../../../Pix-Scripting/src/store/settings"
import {
  importIosConfigJson,
  importIosZipBackup,
  refreshAllImportedStores,
} from "../../../import/iosConfigImporter"
import {
  ScriptingDocumentPicker,
  ScriptingFileManager,
  ScriptingPasteboard,
  ScriptingShareSheet,
} from "../../../scripting/hostGlobals"
import {
  ActionButton,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  SettingRow,
  ThemedTextInput,
  ToggleRow,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

const { PixSystemBridge } = NativeModules

const TINT_SWATCHES = [
  "#007AFF",
  "#FF2D55",
  "#AF52DE",
  "#34C759",
  "#FF9500",
  "#5856D6",
  "#00C7BE",
  "#FF3B30",
] as const

const PORTRAIT_CAPS: ReadonlyArray<{ value: FeedColumnCap; label: string }> = [
  { value: 0, label: "自动" },
  { value: 2, label: "2 列" },
  { value: 3, label: "3 列" },
  { value: 4, label: "4 列" },
]

const LANDSCAPE_CAPS: ReadonlyArray<{ value: FeedColumnCap; label: string }> = [
  { value: 0, label: "自动" },
  { value: 3, label: "3 列" },
  { value: 4, label: "4 列" },
  { value: 5, label: "5 列" },
  { value: 6, label: "6 列" },
]

function columnCapLabel(cap: FeedColumnCap): string {
  return cap === 0 ? "自动" : `${cap} 列`
}

export function SettingsScreen() {
  const { colors, accent, isDark } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [cacheBytes, setCacheBytes] = useState<number>(() => cacheUsageBytes())
  const [hasWebCookie, setHasWebCookie] = useState<boolean>(() => Boolean(session.webCookie))

  // Editable network inputs
  const [customApi, setCustomApi] = useState(settings.customApiBaseUrl)
  const [customOauth, setCustomOauth] = useState(settings.customOauthBaseUrl)
  const [customAccount, setCustomAccount] = useState(settings.customAccountBaseUrl)
  const [customWeb, setCustomWeb] = useState(settings.customWebBaseUrl)
  const [customImage, setCustomImage] = useState(settings.customImageBaseUrl)
  const [customTintInput, setCustomTintInput] = useState(settings.glassTintColor)
  const [syncingCookie, setSyncingCookie] = useState(false)
  const [exportingSync, setExportingSync] = useState(false)
  const [importingFile, setImportingFile] = useState(false)

  useEffect(() => {
    const syncS = () => {
      const s = loadSettings()
      setSettings(s)
      setCustomApi(s.customApiBaseUrl)
      setCustomOauth(s.customOauthBaseUrl)
      setCustomAccount(s.customAccountBaseUrl)
      setCustomWeb(s.customWebBaseUrl)
      setCustomImage(s.customImageBaseUrl)
      setCustomTintInput(s.glassTintColor)
    }
    const unsubSettings = onSettingsChanged(syncS)
    const unsubCache = onImageCacheChanged(() => setCacheBytes(cacheUsageBytes()))
    const unsubAuth = session.onAuthChanged(() => setHasWebCookie(Boolean(session.webCookie)))
    return () => {
      unsubSettings()
      unsubCache()
      unsubAuth()
    }
  }, [])

  function patch(partial: Partial<AppSettings>) {
    updateSettings(partial)
    try {
      triggerHaptic("selection")
    } catch {}
  }

  async function pickColumnCap(orientation: "portrait" | "landscape") {
    const list = orientation === "portrait" ? PORTRAIT_CAPS : LANDSCAPE_CAPS
    const current =
      orientation === "portrait"
        ? settings.feedColumnCapPortrait
        : settings.feedColumnCapLandscape
    const idx = await overlay.presentActionSheet({
      title: orientation === "portrait" ? "竖屏最大列数" : "横屏最大列数",
      actions: list.map((it) => ({
        label: it.label,
        checked: it.value === current,
      })),
    })
    if (idx == null || !list[idx]) return
    if (orientation === "portrait") {
      patch({ feedColumnCapPortrait: list[idx].value })
    } else {
      patch({ feedColumnCapLandscape: list[idx].value })
    }
  }

  async function pickCacheLimit() {
    const options: Array<{ label: string; value: number | null }> = [
      { label: "300 MB", value: 300 },
      { label: "500 MB", value: 500 },
      { label: "1 GB", value: 1000 },
      { label: "2 GB", value: 2000 },
      { label: "不限制", value: null },
    ]
    const idx = await overlay.presentActionSheet({
      title: "图片磁盘缓存上限",
      actions: options.map((opt) => ({
        label: opt.label,
        checked: settings.cacheLimitMB === opt.value,
      })),
    })
    if (idx == null || !options[idx]) return
    patch({ cacheLimitMB: options[idx].value })
  }

  async function handleClearImageCache() {
    const ok = await overlay.confirm({
      title: "清理图片缓存",
      message: `确定清理当前 ${formatBytes(cacheBytes)} 的本地图片磁盘缓存吗？已下载的文件不会被删除。`,
      confirmLabel: "清理",
      destructive: true,
    })
    if (!ok) return
    clearCache()
    setCacheBytes(cacheUsageBytes())
    overlay.showToast("图片缓存已清理", "success")
  }

  function handleSaveGateways() {
    updateSettings({
      customApiBaseUrl: customApi.trim(),
      customOauthBaseUrl: customOauth.trim(),
      customAccountBaseUrl: customAccount.trim(),
      customWebBaseUrl: customWeb.trim(),
      customImageBaseUrl: customImage.trim(),
    })
    overlay.showToast("网络与反代网关配置已保存", "success")
  }

  function handleResetGateways() {
    resetNetworkSettings()
    overlay.showToast("已恢复官方直连设置", "info")
  }

  async function handleWebCookieLogin() {
    if (syncingCookie) return
    setSyncingCookie(true)
    try {
      const webBase = getWebBaseUrl()
      if (PixSystemBridge?.presentOAuthWebView) {
        const res = await PixSystemBridge.presentOAuthWebView({
          url: `${webBase}/`,
          title: "登录 Pixiv 网页版以同步 Cookie",
          redirectPrefix: "pix-scripting://never-auto-close",
          redirectPrefixes: [],
          extraCookieHosts: [webBase, "https://www.pixiv.net", "https://accounts.pixiv.net"],
          ephemeral: false,
          isDark,
        })
        if (typeof res?.cookieHeader === "string" && res.cookieHeader.trim()) {
          session.updateWebCookie(res.cookieHeader.trim())
          setHasWebCookie(true)
          overlay.showToast("已同步 Pixiv Web Cookie", "success")
          return
        }
      }
      const synced = await syncWebCookies()
      if (synced) {
        setHasWebCookie(true)
        overlay.showToast("已从 WebView 同步 Cookie", "success")
      } else {
        overlay.showToast("未检测到 Pixiv Web Cookie，可尝试手动粘贴", "info")
      }
    } catch (e: any) {
      overlay.showToast(e?.message ?? "同步 Web Cookie 失败", "error")
    } finally {
      setSyncingCookie(false)
    }
  }

  async function handleEditWebCookieManually() {
    const val = await overlay.prompt({
      title: "手动设置 Web Cookie",
      message: "输入包含 PHPSESSID=... 的 Pixiv 网页 Cookie（留空则清除）",
      defaultValue: session.webCookie ?? "",
      placeholder: "PHPSESSID=...",
      confirmLabel: "保存",
    })
    if (val === null) return
    const trimmed = val.trim()
    session.updateWebCookie(trimmed || null)
    setHasWebCookie(Boolean(trimmed))
    overlay.showToast(trimmed ? "Web Cookie 已更新" : "已清除 Web Cookie", "success")
  }

  async function handleExportSyncFile() {
    if (exportingSync) return
    setExportingSync(true)
    try {
      const json = exportCrossDeviceSnapshotJson()
      const stamp = new Date().toISOString().slice(0, 10)
      const path = `${ScriptingFileManager.temporaryDirectory}/Pix-Scripting-Sync-${stamp}.json`
      ScriptingFileManager.writeAsStringSync(path, json)
      const ok = await ScriptingShareSheet.present([path])
      if (ok) {
        overlay.showToast("同步数据包已导出", "success")
      }
    } catch (e: any) {
      overlay.showToast(e?.message ?? "导出同步数据失败", "error")
    } finally {
      setExportingSync(false)
    }
  }

  async function handleCopySyncJson() {
    try {
      const json = exportCrossDeviceSnapshotJson()
      await ScriptingPasteboard.setString(json)
      overlay.showToast("已复制跨设备同步 JSON 到剪贴板", "success")
    } catch (e: any) {
      overlay.showToast(e?.message ?? "复制失败", "error")
    }
  }

  async function handleImportSyncFromFile() {
    if (importingFile) return
    setImportingFile(true)
    try {
      const paths = await ScriptingDocumentPicker.pickFiles()
      const picked = paths?.[0]
      if (!picked) return
      if (picked.toLowerCase().endsWith(".zip")) {
        const res = await importIosZipBackup(picked)
        overlay.showToast(res.message, "success")
      } else {
        const raw = ScriptingFileManager.readAsStringSync(picked)
        const res = await importIosConfigJson(raw)
        refreshAllImportedStores()
        overlay.showToast(res.message, "success")
      }
    } catch (e: any) {
      overlay.showToast(e?.message ?? "导入配置失败", "error")
    } finally {
      setImportingFile(false)
    }
  }

  async function handleResetAllSettings() {
    const ok = await overlay.confirm({
      title: "恢复默认设置",
      message: "确定将应用所有设置项恢复为出厂默认值吗？不会删除账号、历史记录、屏蔽列表或已下载文件。",
      confirmLabel: "恢复默认",
      destructive: true,
    })
    if (!ok) return
    resetSettings()
    overlay.showToast("已恢复默认设置", "success")
  }

  const syncOverview = getCrossDeviceSyncOverview()
  const feedQuality = getFeedImageQuality(settings)
  const detailQuality = getDetailImageQuality(settings)
  const downloadQuality = getDownloadImageQuality(settings)

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="应用设置"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: effectiveBottomInset(insets) + 32 },
        ]}
      >
        {/* 1. Content Filters */}
        <SectionHeader title="内容过滤与隐私" />
        <SectionCard>
          <ToggleRow
            title="显示 R-18 作品"
            subtitle="开启后在探索、排行与搜索中展示成人向作品"
            value={settings.showR18}
            onValueChange={(val) =>
              patch(val ? { showR18: true } : { showR18: false, showR18G: false })
            }
          />
          <ToggleRow
            title="显示 R-18G 作品"
            subtitle="需先开启 R-18 显示开关"
            value={settings.showR18G}
            disabled={!settings.showR18}
            onValueChange={(val) => patch({ showR18G: val })}
          />
          <ToggleRow
            title="显示 AI 生成作品"
            subtitle="允许展示 Pixiv 标记为 AI 生成的插画与小说"
            value={settings.showAI}
            onValueChange={(val) => patch({ showAI: val })}
          />
          <ToggleRow
            title="隐藏小说内容"
            subtitle="在各页面隐藏小说标签页与小说推荐"
            value={settings.hideNovels}
            onValueChange={(val) => patch({ hideNovels: val })}
          />
          <ToggleRow
            title="个人主页与收藏豁免过滤"
            subtitle="查看画师主页和我的收藏时不受 R18/AI 开关隐藏"
            value={settings.exemptFilterForPersonal}
            onValueChange={(val) => patch({ exemptFilterForPersonal: val })}
          />
          <ToggleRow
            title="记录本地浏览历史"
            subtitle="关闭后浏览作品不再写入本地历史与足迹统计"
            value={settings.recordHistory}
            onValueChange={(val) => patch({ recordHistory: val })}
            isLast={true}
          />
        </SectionCard>

        {/* 2. Appearance & Layout */}
        <SectionHeader title="外观与瀑布流布局" />
        <SectionCard>
          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>主题外观</Text>
            <SegmentedControl<ColorSchemeMode>
              value={settings.colorScheme}
              onChange={(val) => patch({ colorScheme: val })}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
          </View>

          <ToggleRow
            title="自定义强调色"
            subtitle="启用后替换全局默认蓝色主题点缀"
            value={settings.glassCustomTintEnabled}
            onValueChange={(val) => patch({ glassCustomTintEnabled: val })}
          />

          {settings.glassCustomTintEnabled ? (
            <View
              style={[
                styles.swatchBlock,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
              ]}
            >
              <View style={styles.swatchRow}>
                {TINT_SWATCHES.map((hex) => {
                  const selected = settings.glassTintColor.toLowerCase() === hex.toLowerCase()
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => {
                        setCustomTintInput(hex)
                        patch({ glassTintColor: hex })
                      }}
                      style={[
                        styles.swatch,
                        { backgroundColor: hex },
                        selected && { borderWidth: 3, borderColor: colors.text },
                      ]}
                    />
                  )
                })}
              </View>
              <View style={styles.hexRow}>
                <ThemedTextInput
                  value={customTintInput}
                  onChangeText={setCustomTintInput}
                  placeholder="#007AFF"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.flexInput}
                />
                <Pressable
                  onPress={() => {
                    const clean = customTintInput.trim()
                    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean)) {
                      patch({ glassTintColor: clean })
                      overlay.showToast("已应用自定义主题色", "success")
                    } else {
                      overlay.showToast("请输入合法的十六进制色值，如 #007AFF", "error")
                    }
                  }}
                  style={[styles.applyBtn, { backgroundColor: accent }]}
                >
                  <Text style={styles.applyBtnText}>应用</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <SettingRow
            title="竖屏瀑布流列数上限"
            value={columnCapLabel(settings.feedColumnCapPortrait)}
            showChevron={true}
            onPress={() => void pickColumnCap("portrait")}
          />
          <SettingRow
            title="横屏瀑布流列数上限"
            value={columnCapLabel(settings.feedColumnCapLandscape)}
            showChevron={true}
            onPress={() => void pickColumnCap("landscape")}
          />
          <ToggleRow
            title="紧凑作品卡片"
            subtitle="隐藏瀑布流卡片下方的画师与标题文字，展示更多画面"
            value={settings.compactIllustCard}
            onValueChange={(val) => patch({ compactIllustCard: val })}
          />
          <ToggleRow
            title="首图大卡片模式"
            subtitle="在支持的信息流中以大卡高亮首条推荐作品"
            value={settings.heroFirstFeedCard}
            onValueChange={(val) => patch({ heroFirstFeedCard: val })}
            isLast={true}
          />
        </SectionCard>

        {/* 3. Default Launch Tab & Custom Rankings */}
        <SectionHeader title="启动页与自定义榜单" />
        <SectionCard>
          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>默认启动标签页</Text>
            <SegmentedControl<LaunchPage>
              value={settings.launchPage}
              onChange={(val) => patch({ launchPage: val })}
              options={[
                { value: "discovery", label: "探索" },
                { value: "ranking", label: "排行" },
                { value: "following", label: "关注" },
              ]}
            />
          </View>

          <ToggleRow
            title="自定义排行榜快捷栏"
            subtitle="自定义排行顶部展示的榜单类别与顺序"
            value={settings.customRankingEnabled}
            onValueChange={(val) => patch({ customRankingEnabled: val })}
            isLast={!settings.customRankingEnabled}
          />

          {settings.customRankingEnabled ? (
            <>
              <SettingRow
                title="自定义插画榜单"
                value={formatCustomRankingSummary("illust", settings)}
                showChevron={true}
                onPress={() => nav.push({ name: "rankingCustomPicker", kind: "illust" })}
              />
              <SettingRow
                title="自定义漫画榜单"
                value={formatCustomRankingSummary("manga", settings)}
                showChevron={true}
                onPress={() => nav.push({ name: "rankingCustomPicker", kind: "manga" })}
              />
              {!settings.hideNovels ? (
                <SettingRow
                  title="自定义小说榜单"
                  value={formatCustomRankingSummary("novel", settings)}
                  showChevron={true}
                  isLast={true}
                  onPress={() => nav.push({ name: "rankingCustomPicker", kind: "novel" })}
                />
              ) : null}
            </>
          ) : null}
        </SectionCard>

        {/* 4. Image Quality & Cache */}
        <SectionHeader title="图片质量、导出与缓存" />
        <SectionCard>
          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>信息流缩略图画质</Text>
            <SegmentedControl<FeedImageQuality>
              value={feedQuality}
              onChange={(val) =>
                patch({ feedImageQualityIos: val, feedImageQualityIpad: val })
              }
              options={[
                { value: "medium", label: "标准 (省流量)" },
                { value: "large", label: "高清 (Large)" },
              ]}
            />
          </View>

          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>详情页预览画质</Text>
            <SegmentedControl<DetailImageQuality>
              value={detailQuality}
              onChange={(val) =>
                patch({ detailImageQualityIos: val, detailImageQualityIpad: val })
              }
              options={[
                { value: "large", label: "高清 (Large)" },
                { value: "original", label: "原图 (Original)" },
              ]}
            />
          </View>

          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>下载保存画质</Text>
            <SegmentedControl<DownloadImageQuality>
              value={downloadQuality}
              onChange={(val) =>
                patch({ downloadImageQualityIos: val, downloadImageQualityIpad: val })
              }
              options={[
                { value: "large", label: "高清 (Large)" },
                { value: "original", label: "无损原图" },
              ]}
            />
          </View>

          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>动图 (Ugoira) 导出格式</Text>
            <SegmentedControl<UgoiraExportFormat>
              value={settings.ugoiraExportFormat}
              onChange={(val) => patch({ ugoiraExportFormat: val })}
              options={[
                { value: "mp4", label: "MP4 视频" },
                { value: "gif", label: "GIF 动图" },
              ]}
            />
          </View>

          <ToggleRow
            title="智能预加载图片"
            subtitle="滑动信息流时后台预取即将出现的缩略图"
            value={settings.prefetchEnabled}
            onValueChange={(val) => patch({ prefetchEnabled: val })}
          />
          <SettingRow
            title="缓存容量上限"
            value={settings.cacheLimitMB ? `${settings.cacheLimitMB} MB` : "不限"}
            showChevron={true}
            onPress={() => void pickCacheLimit()}
          />
          <SettingRow
            title="清理图片磁盘缓存"
            subtitle="超过上限时按 LRU 自动淘汰，也可随时手动释放"
            value={formatBytes(cacheBytes)}
            destructive={cacheBytes > 0}
            isLast={true}
            onPress={() => void handleClearImageCache()}
          />
        </SectionCard>

        {/* 5. Network & Gateways & Web Cookie */}
        <SectionHeader title="网络网关与 Web Cookie" />
        <SectionCard>
          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>API 与 OAuth 网关</Text>
            <SegmentedControl<ApiGatewayMode>
              value={settings.apiGatewayMode}
              onChange={(val) => patch({ apiGatewayMode: val })}
              options={[
                { value: "official", label: "官方直连" },
                { value: "custom", label: "自定义反代" },
              ]}
            />
          </View>

          {settings.apiGatewayMode === "custom" ? (
            <View style={styles.gatewayFields}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>App API 基地址</Text>
              <ThemedTextInput
                value={customApi}
                onChangeText={setCustomApi}
                placeholder="https://app-api-proxy.example.com"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>OAuth 基地址（留空复用 API 地址）</Text>
              <ThemedTextInput
                value={customOauth}
                onChangeText={setCustomOauth}
                placeholder="https://oauth-proxy.example.com"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Account 登录基地址（选填）</Text>
              <ThemedTextInput
                value={customAccount}
                onChangeText={setCustomAccount}
                placeholder="https://accounts-proxy.example.com"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Web 主站基地址（选填）</Text>
              <ThemedTextInput
                value={customWeb}
                onChangeText={setCustomWeb}
                placeholder="https://web-proxy.example.com"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}

          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>图片源 (i.pximg.net)</Text>
            <SegmentedControl<ImageSourceMode>
              value={settings.imageSourceMode}
              onChange={(val) => patch({ imageSourceMode: val })}
              options={[
                { value: "official", label: "官方" },
                { value: "pixiv_re", label: "pixiv.re" },
                { value: "custom", label: "自定义" },
              ]}
            />
          </View>

          {settings.imageSourceMode === "custom" ? (
            <View style={styles.gatewayFields}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>自定义图床代理地址</Text>
              <ThemedTextInput
                value={customImage}
                onChangeText={setCustomImage}
                placeholder="https://i.pixiv.cat 或自建反代"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}

          {settings.apiGatewayMode === "custom" || settings.imageSourceMode === "custom" ? (
            <View style={styles.gatewayBtnRow}>
              <ActionButton title="保存网关地址" onPress={handleSaveGateways} style={styles.flexBtn} />
              <ActionButton
                title="恢复直连"
                variant="secondary"
                onPress={handleResetGateways}
                style={styles.flexBtn}
              />
            </View>
          ) : null}

          <SettingRow
            title="网页登录同步 Web Cookie"
            subtitle="用于完整个人资料、标签筛选及部分 Web 扩展接口"
            value={syncingCookie ? "同步中…" : hasWebCookie ? "已同步" : "未设置"}
            showChevron={true}
            onPress={() => void handleWebCookieLogin()}
          />
          <SettingRow
            title="手动编辑 / 清除 Web Cookie"
            value={hasWebCookie ? "已配置" : "空"}
            showChevron={true}
            isLast={true}
            onPress={() => void handleEditWebCookieManually()}
          />
        </SectionCard>

        {/* 6. Cross-Device Sync & iOS Import */}
        <SectionHeader title="跨设备同步与 iOS 导入" />
        <SectionCard>
          <View
            style={[
              styles.syncSummary,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
            ]}
          >
            <Text style={[styles.syncSummaryText, { color: colors.textSecondary }]}>
              本地数据：浏览历史 {syncOverview.historyCounts.total} 条 · 小说进度{" "}
              {syncOverview.novelProgressCount} 条 · 屏蔽 {syncOverview.blockedTagsCount} 标签 /{" "}
              {syncOverview.blockedUsersCount} 画师 · 特辑收藏{" "}
              {syncOverview.pixivisionBookmarksCount} 条
            </Text>
          </View>
          <SettingRow
            title="导入 iOS 配置 / 同步包 / Token"
            subtitle="支持粘贴同步 JSON、选择 ZIP 备份或输入 Refresh Token"
            showChevron={true}
            onPress={() =>
              overlay.openIosImport({
                onImported: (msg) => overlay.showToast(msg, "success"),
              })
            }
          />
          <SettingRow
            title="从本地文件导入 (.json / .zip)"
            value={importingFile ? "导入中…" : undefined}
            showChevron={true}
            onPress={() => void handleImportSyncFromFile()}
          />
          <SettingRow
            title="导出同步数据包 (.json 文件)"
            subtitle="包含设置、阅读排版、历史、小说进度、屏蔽与特辑收藏"
            value={exportingSync ? "导出中…" : undefined}
            showChevron={true}
            onPress={() => void handleExportSyncFile()}
          />
          <SettingRow
            title="复制同步数据 JSON 到剪贴板"
            showChevron={true}
            isLast={true}
            onPress={() => void handleCopySyncJson()}
          />
        </SectionCard>

        {/* 7. Haptics, Reader & AI Quick Entries */}
        <SectionHeader title="触觉反馈与快捷入口" />
        <SectionCard>
          <View style={styles.blockRow}>
            <Text style={[styles.blockLabel, { color: colors.text }]}>触觉反馈强度</Text>
            <SegmentedControl<HapticFeedbackPreference>
              value={settings.hapticFeedbackPreference}
              onChange={(val) => patch({ hapticFeedbackPreference: val })}
              options={[
                { value: "full", label: "完整" },
                { value: "compact", label: "精简" },
                { value: "off", label: "关闭" },
              ]}
            />
          </View>
          <ToggleRow
            title="小说沉浸阅读模式"
            subtitle="默认隐藏阅读器上下栏，轻触正文切换工具栏"
            value={settings.novelImmersiveReaderEnabled}
            onValueChange={(val) => patch({ novelImmersiveReaderEnabled: val })}
          />
          {!settings.hideNovels ? (
            <SettingRow
              title="小说书签与离线书库"
              showChevron={true}
              onPress={() => nav.push({ name: "novelLibrary" })}
            />
          ) : null}
          <SettingRow
            title="AI 智能助手配置"
            showChevron={true}
            isLast={true}
            onPress={() => nav.push({ name: "customAI" })}
          />
        </SectionCard>

        {/* 8. Reset */}
        <View style={styles.resetWrap}>
          <ActionButton
            title="恢复所有默认设置"
            variant="danger"
            onPress={() => void handleResetAllSettings()}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingTop: 4,
  },
  blockRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  blockLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  swatchBlock: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 10,
  },
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  hexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  applyBtn: {
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  applyBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  gatewayFields: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  gatewayBtnRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  flexBtn: {
    flex: 1,
  },
  syncSummary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  syncSummaryText: {
    fontSize: 12,
    lineHeight: 18,
  },
  resetWrap: {
    marginHorizontal: 12,
    marginTop: 22,
  },
})
