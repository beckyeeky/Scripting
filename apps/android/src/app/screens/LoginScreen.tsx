import React, { useState } from "react"
import {
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  buildAuthorizationURL,
  exchangeCode,
  extractAuthCode,
  generateCodeChallenge,
  generateCodeVerifier,
} from "../../../../../Pix-Scripting/src/api/auth"
import { session } from "../../../../../Pix-Scripting/src/api/session"
import { OAUTH_REDIRECT_URI, SCRIPT_VERSION } from "../../../../../Pix-Scripting/src/config"
import {
  getAccountBaseUrl,
  getApiBaseUrl,
  getWebBaseUrl,
} from "../../../../../Pix-Scripting/src/store/settings"
import { ActionButton } from "../components/FormControls"
import { useOverlay } from "../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import { LoginNetworkSheet } from "./LoginNetworkSheet"

const { PixSystemBridge } = NativeModules

export function LoginScreen({
  onSuccess,
  onClose,
  isModal = false,
}: {
  onSuccess?: () => void
  onClose?: () => void
  isModal?: boolean
}) {
  const { colors, accent, accentSoft, isDark } = useAppTheme()
  const insets = useSafeInsets()
  const overlay = useOverlay()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOAuthLogin() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const verifier = generateCodeVerifier()
      const challenge = generateCodeChallenge(verifier)
      const authUrl = buildAuthorizationURL(challenge)
      const apiBase = getApiBaseUrl()
      const redirectPrefixes = Array.from(
        new Set([
          OAUTH_REDIRECT_URI,
          `${apiBase}/web/v1/users/auth/pixiv/callback`,
          "pixiv://account/login",
        ]),
      )
      const extraCookieHosts = Array.from(
        new Set([apiBase, getAccountBaseUrl(), getWebBaseUrl()]),
      )

      if (!PixSystemBridge?.presentOAuthWebView) {
        throw new Error("当前运行环境不支持 OAuth WebView 登录，请使用 Refresh Token 导入登录")
      }

      const result = await PixSystemBridge.presentOAuthWebView({
        url: authUrl,
        title: "Pixiv 登录",
        redirectPrefix: OAUTH_REDIRECT_URI,
        redirectPrefixes,
        extraCookieHosts,
        ephemeral: true,
        isDark,
      })

      if (result?.cancelled) {
        setError("已取消登录")
        return
      }

      const redirectUrl = typeof result?.redirectUrl === "string" ? result.redirectUrl : ""
      const code = extractAuthCode(redirectUrl)
      if (!code) {
        throw new Error("未能从登录回调提取授权码，请重试或改用 Refresh Token 登录")
      }

      const tokenResponse = await exchangeCode(code, verifier)
      const cookieHeader =
        typeof result?.cookieHeader === "string" && result.cookieHeader.trim()
          ? result.cookieHeader.trim()
          : null
      session.applyResponse(tokenResponse, cookieHeader)
      overlay.showToast("登录成功", "success")
      onSuccess?.()
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      setError(`${msg}\n若处于受限网络环境，可先点击右上角「网络设置」配置反代网关，或导入 iOS 配置与 Token。`)
    } finally {
      setLoading(false)
    }
  }

  function openNetworkSettings() {
    overlay.presentSheet({
      id: "login-network-settings",
      title: "网络与反代网关设置",
      fullHeight: true,
      render: (close) => (
        <LoginNetworkSheet
          onClose={close}
          onSaved={(msg) => overlay.showToast(msg, "success")}
        />
      ),
    })
  }

  function openIosImport() {
    overlay.openIosImport({
      onImported: (msg, authChanged) => {
        overlay.showToast(msg, "success")
        if (authChanged) {
          onSuccess?.()
        }
      },
    })
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
          },
        ]}
      >
        {isModal && onClose ? (
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.topAction, { color: accent }]}>取消</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          onPress={openNetworkSettings}
          hitSlop={10}
          style={[styles.netPill, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}
        >
          <Text style={[styles.topAction, { color: accent }]}>网络设置</Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: effectiveBottomInset(insets) + 32 },
        ]}
      >
        <View style={styles.hero}>
          <View style={[styles.logoBadge, { backgroundColor: accentSoft, borderColor: accent }]}>
            <Text style={[styles.logoText, { color: accent }]}>P</Text>
          </View>
          <Text style={[styles.brand, { color: colors.text }]}>Pix-Scripting</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Android 原生端 · 插画、漫画、动图与小说翻译阅读
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.glassBorder },
          ]}
        >
          <ActionButton
            title={isModal ? "通过网页登录添加账号" : "登录 Pixiv 账号"}
            onPress={() => void handleOAuthLogin()}
            loading={loading}
          />
          <ActionButton
            title="导入 iOS 配置 / Refresh Token 登录"
            variant="secondary"
            onPress={openIosImport}
            disabled={loading}
          />
          <ActionButton
            title="配置自定义 API / 图片网关"
            variant="ghost"
            onPress={openNetworkSettings}
            disabled={loading}
          />
        </View>

        {error ? (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: isDark ? "rgba(255,69,58,0.16)" : "#FEF2F2",
                borderColor: colors.danger,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: isDark ? "#FCA5A5" : "#991B1B" }]}>
              {error}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.footerNote, { color: colors.textTertiary }]}>
          兼容 Pix-Scripting iOS v{SCRIPT_VERSION} 同步包、离线书库与 AI 模型配置
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  netPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topAction: {
    fontSize: 14,
    fontWeight: "600",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    gap: 20,
  },
  hero: {
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  logoText: {
    fontSize: 36,
    fontWeight: "800",
  },
  brand: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  tagline: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    borderRadius: 18,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
  },
  footerNote: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
})
