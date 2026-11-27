import React, { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"
import {
  loadSettings,
  resetNetworkSettings,
  updateSettings,
  type ApiGatewayMode,
  type ImageSourceMode,
} from "../../../../../Pix-Scripting/src/store/settings"
import {
  ActionButton,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  ThemedTextInput,
} from "../components/FormControls"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"

export function LoginNetworkSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved?: (msg: string) => void
}) {
  const { colors } = useAppTheme()
  const insets = useSafeInsets()
  const initial = loadSettings()

  const [apiMode, setApiMode] = useState<ApiGatewayMode>(initial.apiGatewayMode)
  const [customApi, setCustomApi] = useState(initial.customApiBaseUrl)
  const [customOauth, setCustomOauth] = useState(initial.customOauthBaseUrl)
  const [customAccount, setCustomAccount] = useState(initial.customAccountBaseUrl)
  const [customWeb, setCustomWeb] = useState(initial.customWebBaseUrl)
  const [imageMode, setImageMode] = useState<ImageSourceMode>(initial.imageSourceMode)
  const [customImage, setCustomImage] = useState(initial.customImageBaseUrl)

  function handleSave() {
    updateSettings({
      apiGatewayMode: apiMode,
      customApiBaseUrl: customApi.trim(),
      customOauthBaseUrl: customOauth.trim(),
      customAccountBaseUrl: customAccount.trim(),
      customWebBaseUrl: customWeb.trim(),
      imageSourceMode: imageMode,
      customImageBaseUrl: customImage.trim(),
    })
    onSaved?.("网络与网关配置已保存")
    onClose()
  }

  function handleReset() {
    const next = resetNetworkSettings()
    setApiMode(next.apiGatewayMode)
    setCustomApi(next.customApiBaseUrl)
    setCustomOauth(next.customOauthBaseUrl)
    setCustomAccount(next.customAccountBaseUrl)
    setCustomWeb(next.customWebBaseUrl)
    setImageMode(next.imageSourceMode)
    setCustomImage(next.customImageBaseUrl)
    onSaved?.("已恢复默认官方直连")
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 24 },
      ]}
    >
      <SectionHeader title="API 与登录网关" />
      <SectionCard style={styles.cardPad}>
        <SegmentedControl<ApiGatewayMode>
          value={apiMode}
          onChange={setApiMode}
          options={[
            { value: "official", label: "官方直连" },
            { value: "custom", label: "自定义反代" },
          ]}
        />
        {apiMode === "custom" ? (
          <View style={styles.fields}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>App API 基地址</Text>
            <ThemedTextInput
              value={customApi}
              onChangeText={setCustomApi}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://your-api-proxy.example.com"
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>OAuth 令牌基地址（留空沿用 API 地址）</Text>
            <ThemedTextInput
              value={customOauth}
              onChangeText={setCustomOauth}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://your-oauth-proxy.example.com"
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Account 登录基地址（选填）</Text>
            <ThemedTextInput
              value={customAccount}
              onChangeText={setCustomAccount}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://your-account-proxy.example.com"
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Web 主站基地址（选填）</Text>
            <ThemedTextInput
              value={customWeb}
              onChangeText={setCustomWeb}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://your-web-proxy.example.com"
            />
          </View>
        ) : (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            默认直连 app-api.pixiv.net 与 oauth.secure.pixiv.net。
          </Text>
        )}
      </SectionCard>

      <SectionHeader title="图片源 (i.pximg.net)" />
      <SectionCard style={styles.cardPad}>
        <SegmentedControl<ImageSourceMode>
          value={imageMode}
          onChange={setImageMode}
          options={[
            { value: "official", label: "官方" },
            { value: "pixiv_re", label: "pixiv.re" },
            { value: "custom", label: "自定义" },
          ]}
        />
        {imageMode === "custom" ? (
          <View style={styles.fields}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>自定义图床代理地址</Text>
            <ThemedTextInput
              value={customImage}
              onChangeText={setCustomImage}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://i.pixiv.cat 或自建反代"
            />
          </View>
        ) : null}
      </SectionCard>

      <View style={styles.actions}>
        <ActionButton title="保存网络设置" onPress={handleSave} />
        <ActionButton title="恢复默认直连" variant="secondary" onPress={handleReset} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
  },
  cardPad: {
    padding: 14,
    gap: 10,
  },
  fields: {
    gap: 8,
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    paddingHorizontal: 14,
    marginTop: 18,
    gap: 10,
  },
})
