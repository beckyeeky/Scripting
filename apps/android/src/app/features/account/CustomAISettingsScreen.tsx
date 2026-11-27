import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  fetchRemoteModelList,
  testCustomAIConnection,
  testCustomImageGenConnection,
  type RemoteModelItem,
} from "../../../../../../Pix-Scripting/src/api/aiAdapters"
import {
  ensureFreshGrokAccessToken,
  GROK_OAUTH_PRESET_ID,
  pollGrokDeviceToken,
  startGrokDeviceAuthorization,
  type GrokDeviceAuthSession,
} from "../../../../../../Pix-Scripting/src/api/grokOAuth"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  AI_PRESETS,
  deleteCustomAIProfile,
  getEffectiveGeneralEndpoint,
  getEffectiveImageGenKey,
  isUnencryptedHttpEndpoint,
  loadCustomAIProfile,
  onCustomAIConfigChanged,
  switchCustomAIPreset,
  updateCustomAIProfile,
  type CustomAIProfile,
  type GeneralAIProtocol,
  type ImageGenAIProtocol,
} from "../../../../../../Pix-Scripting/src/store/customAI"
import { ScriptingPasteboard, ScriptingSafari } from "../../../scripting/hostGlobals"
import {
  ActionButton,
  ChipBar,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  ThemedTextInput,
  ToggleRow,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

const PROTOCOL_CHIPS: ReadonlyArray<ChipItem<GeneralAIProtocol>> = [
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "openai-chat", label: "OpenAI Chat" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
]

const IMAGE_PROTOCOL_OPTIONS: ReadonlyArray<{ value: ImageGenAIProtocol; label: string }> = [
  { value: "openai-images", label: "OpenAI Images" },
  { value: "openai-responses", label: "Responses" },
  { value: "gemini-imagen", label: "Gemini Imagen" },
]

const TEMPERATURE_CHIPS: ReadonlyArray<ChipItem<string>> = [
  { value: "0.2", label: "0.2 严谨" },
  { value: "0.5", label: "0.5 均衡" },
  { value: "0.7", label: "0.7 推荐" },
  { value: "1.0", label: "1.0 创意" },
]

const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"] as const

function formatExpiry(ts?: number): string {
  if (!ts) return "长期有效"
  const diffMin = Math.floor((ts - Date.now()) / 60000)
  if (diffMin <= 0) return "已过期（将自动刷新）"
  if (diffMin < 60) return `剩余 ${diffMin} 分钟`
  const h = Math.floor(diffMin / 60)
  return `剩余 ${h} 小时`
}

function ModelPickerSheet({
  models,
  currentModel,
  onSelect,
  onClose,
}: {
  models: RemoteModelItem[]
  currentModel: string
  onSelect: (item: RemoteModelItem) => void
  onClose: () => void
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q)),
    )
  }, [models, query])

  return (
    <View style={styles.sheetRoot}>
      <View style={styles.sheetSearch}>
        <ThemedTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`搜索 ${models.length} 个模型…`}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: effectiveBottomInset(insets) + 24,
          gap: 6,
        }}
      >
        {filtered.map((item) => {
          const selected = item.id === currentModel
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                onSelect(item)
                onClose()
              }}
              style={[
                styles.modelOption,
                {
                  backgroundColor: selected ? accentSoft : colors.surface,
                  borderColor: selected ? accent : colors.glassBorder,
                },
              ]}
            >
              <View style={styles.modelOptBody}>
                <Text
                  style={[
                    styles.modelOptId,
                    { color: selected ? accent : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {item.id}
                </Text>
                {item.description ? (
                  <Text
                    style={[styles.modelOptDesc, { color: colors.textSecondary }]}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <View style={styles.modelBadges}>
                {item.supportsVision ? (
                  <Text style={[styles.miniBadge, { color: accent, backgroundColor: accentSoft }]}>
                    视觉
                  </Text>
                ) : null}
                {selected ? <Text style={{ color: accent, fontWeight: "800" }}>✓</Text> : null}
              </View>
            </Pressable>
          )
        })}
        {filtered.length === 0 ? (
          <Text style={[styles.emptySearch, { color: colors.textSecondary }]}>
            没有匹配的模型名称
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

export function CustomAISettingsScreen() {
  const { colors, accent, accentSoft, isDark } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [profile, setProfile] = useState<CustomAIProfile>(() => loadCustomAIProfile())
  const [endpointDraft, setEndpointDraft] = useState(profile.general.endpoint)
  const [modelDraft, setModelDraft] = useState(profile.general.model)
  const [apiKeyDraft, setApiKeyDraft] = useState(profile.general.apiKey)
  const [showApiKey, setShowApiKey] = useState(false)

  const [imgEndpointDraft, setImgEndpointDraft] = useState(profile.imageGen.endpoint)
  const [imgModelDraft, setImgModelDraft] = useState(profile.imageGen.model)
  const [imgKeyDraft, setImgKeyDraft] = useState(profile.imageGen.apiKey)

  const [fetchingModels, setFetchingModels] = useState(false)
  const [testingGeneral, setTestingGeneral] = useState(false)
  const [generalTestStatus, setGeneralTestStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [testingImageGen, setTestingImageGen] = useState(false)
  const [imageGenTestStatus, setImageGenTestStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // Grok OAuth RFC 8628 state
  const [grokStarting, setGrokStarting] = useState(false)
  const [grokPolling, setGrokPolling] = useState(false)
  const [grokRefreshing, setGrokRefreshing] = useState(false)
  const [grokSession, setGrokSession] = useState<GrokDeviceAuthSession | null>(null)
  const [grokError, setGrokError] = useState<string | null>(null)
  const grokAbortRef = useRef<{ aborted: boolean }>({ aborted: false })

  useEffect(() => {
    const unsub = onCustomAIConfigChanged((next) => {
      setProfile(next)
      setEndpointDraft(next.general.endpoint)
      setModelDraft(next.general.model)
      setApiKeyDraft(next.general.apiKey)
      setImgEndpointDraft(next.imageGen.endpoint)
      setImgModelDraft(next.imageGen.model)
      setImgKeyDraft(next.imageGen.apiKey)
    })
    return () => {
      grokAbortRef.current.aborted = true
      unsub()
    }
  }, [])

  const activePresetId = profile.general.preset || "custom"
  const activePreset = useMemo(
    () => AI_PRESETS.find((p) => p.id === activePresetId),
    [activePresetId],
  )
  const isGrokOAuth = activePresetId === GROK_OAUTH_PRESET_ID
  const isGrokLoggedIn = Boolean(
    isGrokOAuth && (profile.general.apiKey || profile.general.oauthRefreshToken),
  )

  function commitGeneral(partial: Partial<CustomAIProfile["general"]>) {
    updateCustomAIProfile({
      general: {
        ...profile.general,
        endpoint: endpointDraft.trim(),
        model: modelDraft.trim(),
        apiKey: apiKeyDraft.trim(),
        ...partial,
      },
    })
  }

  function commitImageGen(partial: Partial<CustomAIProfile["imageGen"]>) {
    updateCustomAIProfile({
      imageGen: {
        ...profile.imageGen,
        endpoint: imgEndpointDraft.trim(),
        model: imgModelDraft.trim(),
        apiKey: imgKeyDraft.trim(),
        ...partial,
      },
    })
  }

  function handleSelectPreset(presetId: string) {
    if (presetId === activePresetId) return
    // Persist current edits before switching
    commitGeneral({})
    grokAbortRef.current.aborted = true
    setGrokPolling(false)
    setGrokSession(null)
    setGrokError(null)
    setGeneralTestStatus(null)
    switchCustomAIPreset(presetId)
    try {
      triggerHaptic("selection")
    } catch {}
  }

  async function handleStartGrokOAuth() {
    if (grokStarting || grokPolling) return
    setGrokError(null)
    setGrokStarting(true)
    grokAbortRef.current = { aborted: false }
    const signal = grokAbortRef.current

    try {
      const deviceSession = await startGrokDeviceAuthorization()
      if (signal.aborted) return
      setGrokSession(deviceSession)
      setGrokStarting(false)
      setGrokPolling(true)

      const tokenData = await pollGrokDeviceToken(deviceSession, signal)
      if (signal.aborted) return

      updateCustomAIProfile({
        enabled: true,
        general: {
          ...loadCustomAIProfile().general,
          preset: GROK_OAUTH_PRESET_ID,
          model: modelDraft.trim() || "grok-4",
          apiKey: tokenData.accessToken,
          oauthRefreshToken: tokenData.refreshToken,
          oauthExpiresAt: tokenData.expiresAt,
          oauthAccountEmail: tokenData.email,
          noKeyRequired: false,
        },
      })
      setGrokSession(null)
      overlay.showToast(
        tokenData.email ? `Grok OAuth 授权成功 (${tokenData.email})` : "Grok OAuth 授权成功",
        "success",
      )
    } catch (e: any) {
      if (!signal.aborted) {
        setGrokError(e?.message ?? "Grok OAuth 授权失败")
      }
    } finally {
      setGrokStarting(false)
      setGrokPolling(false)
    }
  }

  function handleCancelGrokPolling() {
    grokAbortRef.current.aborted = true
    setGrokPolling(false)
    setGrokStarting(false)
    setGrokSession(null)
    setGrokError(null)
    overlay.showToast("已取消 Grok OAuth 登录", "info")
  }

  async function handleRefreshGrokToken() {
    if (grokRefreshing) return
    setGrokRefreshing(true)
    setGrokError(null)
    try {
      await ensureFreshGrokAccessToken(profile.general, true)
      overlay.showToast("Grok 访问令牌已刷新", "success")
    } catch (e: any) {
      setGrokError(e?.message ?? "刷新令牌失败")
    } finally {
      setGrokRefreshing(false)
    }
  }

  async function handleSignOutGrok() {
    const ok = await overlay.confirm({
      title: "退出 Grok OAuth 授权",
      message: "将清除本地保存的 Grok 访问令牌与刷新令牌。",
      confirmLabel: "退出授权",
      destructive: true,
    })
    if (!ok) return
    grokAbortRef.current.aborted = true
    setGrokSession(null)
    setGrokPolling(false)
    updateCustomAIProfile({
      general: {
        ...profile.general,
        apiKey: "",
        oauthRefreshToken: undefined,
        oauthExpiresAt: undefined,
        oauthAccountEmail: undefined,
      },
    })
    overlay.showToast("已退出 Grok OAuth", "info")
  }

  async function handleFetchModels() {
    if (fetchingModels) return
    commitGeneral({})
    setFetchingModels(true)
    try {
      const latest = loadCustomAIProfile().general
      let effectiveKey = latest.apiKey
      if (isGrokOAuth) {
        effectiveKey = await ensureFreshGrokAccessToken(latest)
      }
      const res = await fetchRemoteModelList(
        latest.protocol,
        latest.endpoint,
        effectiveKey,
        latest.preset,
        latest.noKeyRequired,
      )
      if (!res.success) {
        overlay.showToast(res.error ?? "拉取模型列表失败", "error")
        return
      }
      if (res.models.length === 0) {
        overlay.showToast(res.error ?? "服务端未返回模型列表", "info")
        return
      }
      overlay.presentSheet({
        id: "ai-model-picker",
        title: `选择模型 (${res.models.length})`,
        fullHeight: true,
        render: (close) => (
          <ModelPickerSheet
            models={res.models}
            currentModel={modelDraft}
            onSelect={(item) => {
              setModelDraft(item.id)
              commitGeneral({
                model: item.id,
                ...(item.protocol ? { protocol: item.protocol } : {}),
                ...(typeof item.supportsVision === "boolean"
                  ? { supportsVision: item.supportsVision }
                  : {}),
              })
              overlay.showToast(`已选择 ${item.id}`, "success")
            }}
            onClose={close}
          />
        ),
      })
    } catch (e: any) {
      overlay.showToast(e?.message ?? "拉取模型失败", "error")
    } finally {
      setFetchingModels(false)
    }
  }

  async function handleTestGeneral() {
    if (testingGeneral) return
    commitGeneral({})
    setTestingGeneral(true)
    setGeneralTestStatus(null)
    try {
      const latest = loadCustomAIProfile().general
      const res = await testCustomAIConnection(latest)
      if (res.success) {
        setGeneralTestStatus({
          ok: true,
          text: `连接成功 (${res.latencyMs}ms)${res.sampleResponse ? ` · 回复: ${res.sampleResponse}` : ""}`,
        })
      } else {
        setGeneralTestStatus({
          ok: false,
          text: res.error ?? "连接测试失败",
        })
      }
    } catch (e: any) {
      setGeneralTestStatus({ ok: false, text: e?.message ?? "测试异常" })
    } finally {
      setTestingGeneral(false)
    }
  }

  async function handleTestImageGen() {
    if (testingImageGen) return
    commitImageGen({})
    setTestingImageGen(true)
    setImageGenTestStatus(null)
    try {
      const latest = loadCustomAIProfile()
      const key = getEffectiveImageGenKey(latest)
      const res = await testCustomImageGenConnection(latest.imageGen, key)
      if (res.success) {
        setImageGenTestStatus({
          ok: true,
          text: `生图测试通过 (${res.latencyMs}ms)`,
        })
      } else {
        setImageGenTestStatus({
          ok: false,
          text: res.error ?? "生图连接测试失败",
        })
      }
    } catch (e: any) {
      setImageGenTestStatus({ ok: false, text: e?.message ?? "生图测试异常" })
    } finally {
      setTestingImageGen(false)
    }
  }

  async function handleDeleteAll() {
    const ok = await overlay.confirm({
      title: "清除所有 AI 配置",
      message: "确定删除所有已保存的 AI 密钥、预设与生图模型配置吗？",
      confirmLabel: "清除",
      destructive: true,
    })
    if (!ok) return
    grokAbortRef.current.aborted = true
    setGrokSession(null)
    setGrokPolling(false)
    deleteCustomAIProfile()
    setGeneralTestStatus(null)
    setImageGenTestStatus(null)
    overlay.showToast("已清除自定义 AI 配置", "info")
  }

  const effectiveEndpoint = getEffectiveGeneralEndpoint({
    ...profile.general,
    endpoint: endpointDraft,
  })
  const showHttpWarning = isUnencryptedHttpEndpoint(effectiveEndpoint)

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="AI 智能助手配置"
        showBack={nav.canGoBack}
        onBack={() => {
          commitGeneral({})
          commitImageGen({})
          nav.pop()
        }}
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: effectiveBottomInset(insets) + 32 },
        ]}
      >
        {/* Master Switch */}
        <SectionCard>
          <ToggleRow
            title="启用自定义 AI 智能助手"
            subtitle="驱动小说 AI 翻译、摘要大纲、角色分析与视觉识图"
            value={profile.enabled}
            onValueChange={(val) => updateCustomAIProfile({ enabled: val })}
            isLast={true}
          />
        </SectionCard>

        {/* Presets */}
        <SectionHeader
          title="模型服务商预设"
          right={
            activePreset?.apiKeyUrl ? (
              <Pressable onPress={() => void ScriptingSafari.openURL(activePreset.apiKeyUrl!)}>
                <Text style={[styles.linkText, { color: accent }]}>获取 API Key ›</Text>
              </Pressable>
            ) : null
          }
        />
        <ChipBar<string>
          items={AI_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          selected={activePresetId}
          onSelect={handleSelectPreset}
        />
        {activePreset ? (
          <Text style={[styles.presetDesc, { color: colors.textSecondary }]}>
            {activePreset.description}
          </Text>
        ) : null}

        {/* Grok OAuth RFC 8628 Flow */}
        {isGrokOAuth ? (
          <>
            <SectionHeader title="Grok (OAuth) 设备码授权" />
            <SectionCard style={styles.cardPad}>
              <View style={styles.oauthHeader}>
                <View style={styles.oauthMeta}>
                  <Text style={[styles.oauthTitle, { color: colors.text }]}>
                    {isGrokLoggedIn ? "已完成 xAI OAuth 授权" : "尚未授权 Grok 账号"}
                  </Text>
                  <Text style={[styles.oauthSub, { color: colors.textSecondary }]}>
                    {isGrokLoggedIn
                      ? `${profile.general.oauthAccountEmail || "已登录账号"} · ${formatExpiry(profile.general.oauthExpiresAt)}`
                      : "遵循 RFC 8628 设备码授权流程，无需手动申请 API Key"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isGrokLoggedIn ? colors.green : colors.textTertiary },
                  ]}
                />
              </View>

              {grokSession ? (
                <View
                  style={[
                    styles.deviceCodeBox,
                    { backgroundColor: accentSoft, borderColor: accent },
                  ]}
                >
                  <Text style={[styles.codeHint, { color: colors.textSecondary }]}>
                    请在浏览器打开验证页并确认下方设备授权码：
                  </Text>
                  <Text selectable={true} style={[styles.userCode, { color: accent }]}>
                    {grokSession.userCode}
                  </Text>
                  <View style={styles.codeBtnRow}>
                    <ActionButton
                      title="复制授权码"
                      variant="secondary"
                      onPress={async () => {
                        await ScriptingPasteboard.setString(grokSession.userCode)
                        overlay.showToast("已复制授权码", "success")
                      }}
                      style={styles.flexBtn}
                    />
                    <ActionButton
                      title="打开验证网页"
                      onPress={() =>
                        void ScriptingSafari.openURL(
                          grokSession.verificationUriComplete || grokSession.verificationUri,
                        )
                      }
                      style={styles.flexBtn}
                    />
                  </View>
                  <View style={styles.pollingRow}>
                    <ActivityIndicator size="small" color={accent} />
                    <Text style={[styles.pollingText, { color: colors.textSecondary }]}>
                      正在等待浏览器确认授权…
                    </Text>
                    <Pressable onPress={handleCancelGrokPolling}>
                      <Text style={[styles.cancelPollText, { color: colors.danger }]}>取消</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.oauthBtns}>
                  <ActionButton
                    title={isGrokLoggedIn ? "重新发起设备码授权" : "发起 Grok OAuth 登录"}
                    onPress={() => void handleStartGrokOAuth()}
                    loading={grokStarting}
                  />
                  {isGrokLoggedIn ? (
                    <View style={styles.codeBtnRow}>
                      <ActionButton
                        title="手动刷新令牌"
                        variant="secondary"
                        loading={grokRefreshing}
                        onPress={() => void handleRefreshGrokToken()}
                        style={styles.flexBtn}
                      />
                      <ActionButton
                        title="退出授权"
                        variant="danger"
                        onPress={() => void handleSignOutGrok()}
                        style={styles.flexBtn}
                      />
                    </View>
                  ) : null}
                </View>
              )}

              {grokError ? (
                <Text style={[styles.inlineErr, { color: colors.danger }]}>{grokError}</Text>
              ) : null}
            </SectionCard>
          </>
        ) : null}

        {/* General Model Config */}
        <SectionHeader title="通用对话与翻译模型" />
        <SectionCard style={styles.cardPad}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>接口协议</Text>
          <View style={styles.chipInset}>
            <ChipBar<GeneralAIProtocol>
              items={PROTOCOL_CHIPS}
              selected={profile.general.protocol}
              onSelect={(next) => commitGeneral({ protocol: next })}
              compact={true}
            />
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            API 端点（留空使用预设默认地址）
          </Text>
          <ThemedTextInput
            value={endpointDraft}
            onChangeText={setEndpointDraft}
            onBlur={() => commitGeneral({ endpoint: endpointDraft.trim() })}
            placeholder={activePreset?.defaultEndpoint || "https://api.openai.com"}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {showHttpWarning ? (
            <Text style={[styles.warnText, { color: colors.orange }]}>
              注意：当前端点使用未加密 HTTP，建议仅在局域网或本地服务使用。
            </Text>
          ) : null}

          {!isGrokOAuth ? (
            <>
              <View style={styles.inlineToggle}>
                <ToggleRow
                  title="无需 API 密钥"
                  subtitle="适用于本地 Ollama / LM Studio 等免鉴权服务"
                  value={Boolean(profile.general.noKeyRequired)}
                  onValueChange={(val) => commitGeneral({ noKeyRequired: val })}
                  isLast={true}
                />
              </View>

              {!profile.general.noKeyRequired ? (
                <>
                  <View style={styles.labelRow}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>API 密钥</Text>
                    <Pressable onPress={() => setShowApiKey((v) => !v)}>
                      <Text style={[styles.linkText, { color: accent }]}>
                        {showApiKey ? "隐藏" : "显示"}
                      </Text>
                    </Pressable>
                  </View>
                  <ThemedTextInput
                    value={apiKeyDraft}
                    onChangeText={setApiKeyDraft}
                    onBlur={() => commitGeneral({ apiKey: apiKeyDraft.trim() })}
                    placeholder="sk-..."
                    secureTextEntry={!showApiKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              ) : null}
            </>
          ) : null}

          <View style={styles.labelRow}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>模型名称 (Model ID)</Text>
            <Pressable
              disabled={fetchingModels}
              onPress={() => void handleFetchModels()}
            >
              <Text style={[styles.linkText, { color: accent }]}>
                {fetchingModels ? "拉取中…" : "拉取模型列表 ▾"}
              </Text>
            </Pressable>
          </View>
          <ThemedTextInput
            value={modelDraft}
            onChangeText={setModelDraft}
            onBlur={() => commitGeneral({ model: modelDraft.trim() })}
            placeholder={activePreset?.defaultModel || "如 gpt-4o / deepseek-chat / gemini-2.5-flash"}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.inlineToggle}>
            <ToggleRow
              title="支持视觉识图 (Vision)"
              subtitle="允许向模型发送插画图片进行标签解析、漫画翻译与点评"
              value={profile.general.supportsVision}
              onValueChange={(val) => commitGeneral({ supportsVision: val })}
              isLast={true}
            />
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            温度参数 (Temperature: {(profile.general.temperature ?? 0.7).toFixed(1)})
          </Text>
          <View style={styles.chipInset}>
            <ChipBar<string>
              items={TEMPERATURE_CHIPS}
              selected={String((profile.general.temperature ?? 0.7).toFixed(1))}
              onSelect={(v) => commitGeneral({ temperature: parseFloat(v) })}
              compact={true}
            />
          </View>

          <View style={styles.codeBtnRow}>
            <ActionButton
              title="保存配置"
              variant="secondary"
              onPress={() => {
                commitGeneral({})
                overlay.showToast("通用模型配置已保存", "success")
              }}
              style={styles.flexBtn}
            />
            <ActionButton
              title="测试连接"
              loading={testingGeneral}
              onPress={() => void handleTestGeneral()}
              style={styles.flexBtn}
            />
          </View>

          {generalTestStatus ? (
            <View
              style={[
                styles.testBanner,
                {
                  backgroundColor: generalTestStatus.ok
                    ? `${colors.green}18`
                    : isDark
                      ? "rgba(255,69,58,0.16)"
                      : "#FEF2F2",
                  borderColor: generalTestStatus.ok ? colors.green : colors.danger,
                },
              ]}
            >
              <Text
                style={[
                  styles.testBannerText,
                  { color: generalTestStatus.ok ? colors.green : colors.danger },
                ]}
              >
                {generalTestStatus.text}
              </Text>
            </View>
          ) : null}
        </SectionCard>

        {/* Image Gen Config */}
        <SectionHeader title="独立生图模型（可选）" />
        <SectionCard>
          <ToggleRow
            title="启用自定义生图模型"
            subtitle="用于 AI 参考图重绘与图像编辑"
            value={profile.imageGen.enabled}
            onValueChange={(val) => commitImageGen({ enabled: val })}
            isLast={!profile.imageGen.enabled}
          />

          {profile.imageGen.enabled ? (
            <View style={styles.cardPad}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>生图协议</Text>
              <SegmentedControl<ImageGenAIProtocol>
                value={profile.imageGen.protocol}
                onChange={(val) => commitImageGen({ protocol: val })}
                options={IMAGE_PROTOCOL_OPTIONS}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>生图端点（选填）</Text>
              <ThemedTextInput
                value={imgEndpointDraft}
                onChangeText={setImgEndpointDraft}
                onBlur={() => commitImageGen({ endpoint: imgEndpointDraft.trim() })}
                placeholder="留空使用协议默认端点"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>生图模型名称</Text>
              <ThemedTextInput
                value={imgModelDraft}
                onChangeText={setImgModelDraft}
                onBlur={() => commitImageGen({ model: imgModelDraft.trim() })}
                placeholder="如 gpt-image-1 / imagen-3.0-generate-002"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.inlineToggle}>
                <ToggleRow
                  title="复用通用模型 API Key"
                  value={profile.imageGen.reuseGeneralKey}
                  onValueChange={(val) => commitImageGen({ reuseGeneralKey: val })}
                  isLast={true}
                />
              </View>

              {!profile.imageGen.reuseGeneralKey ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>独立生图 API Key</Text>
                  <ThemedTextInput
                    value={imgKeyDraft}
                    onChangeText={setImgKeyDraft}
                    onBlur={() => commitImageGen({ apiKey: imgKeyDraft.trim() })}
                    placeholder="sk-..."
                    secureTextEntry={true}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>默认输出尺寸</Text>
              <View style={styles.chipInset}>
                <ChipBar<string>
                  items={IMAGE_SIZES.map((s) => ({ value: s, label: s }))}
                  selected={profile.imageGen.size || "1024x1024"}
                  onSelect={(val) => commitImageGen({ size: val })}
                  compact={true}
                />
              </View>

              <ActionButton
                title="测试生图模型连接"
                variant="secondary"
                loading={testingImageGen}
                onPress={() => void handleTestImageGen()}
              />

              {imageGenTestStatus ? (
                <View
                  style={[
                    styles.testBanner,
                    {
                      backgroundColor: imageGenTestStatus.ok
                        ? `${colors.green}18`
                        : `${colors.danger}18`,
                      borderColor: imageGenTestStatus.ok ? colors.green : colors.danger,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.testBannerText,
                      { color: imageGenTestStatus.ok ? colors.green : colors.danger },
                    ]}
                  >
                    {imageGenTestStatus.text}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </SectionCard>

        <View style={styles.dangerWrap}>
          <ActionButton
            title="清除所有自定义 AI 配置"
            variant="danger"
            onPress={() => void handleDeleteAll()}
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
    paddingTop: 10,
  },
  linkText: {
    fontSize: 12,
    fontWeight: "700",
  },
  presetDesc: {
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
    lineHeight: 18,
  },
  cardPad: {
    padding: 14,
    gap: 10,
  },
  oauthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  oauthMeta: {
    flex: 1,
    gap: 3,
  },
  oauthTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  oauthSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deviceCodeBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
    alignItems: "center",
  },
  codeHint: {
    fontSize: 12,
    textAlign: "center",
  },
  userCode: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 3,
  },
  codeBtnRow: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  flexBtn: {
    flex: 1,
  },
  pollingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  pollingText: {
    fontSize: 12,
  },
  cancelPollText: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 6,
  },
  oauthBtns: {
    gap: 8,
  },
  inlineErr: {
    fontSize: 12,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipInset: {
    marginHorizontal: -12,
  },
  warnText: {
    fontSize: 11,
    lineHeight: 16,
  },
  inlineToggle: {
    marginHorizontal: -14,
  },
  testBanner: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  testBannerText: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  dangerWrap: {
    marginHorizontal: 12,
    marginTop: 22,
  },
  sheetRoot: {
    flex: 1,
  },
  sheetSearch: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modelOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  modelOptBody: {
    flex: 1,
    gap: 2,
  },
  modelOptId: {
    fontSize: 14,
    fontWeight: "700",
  },
  modelOptDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  modelBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  miniBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: "hidden",
  },
  emptySearch: {
    fontSize: 13,
    textAlign: "center",
    padding: 20,
  },
})
