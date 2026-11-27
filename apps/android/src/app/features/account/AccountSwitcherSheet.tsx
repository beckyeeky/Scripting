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
import {
  buildAuthorizationURL,
  exchangeCode,
  extractAuthCode,
  generateCodeChallenge,
  generateCodeVerifier,
  type StoredAccountProfile,
} from "../../../../../../Pix-Scripting/src/api/auth"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { OAUTH_REDIRECT_URI } from "../../../../../../Pix-Scripting/src/config"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  getAccountBaseUrl,
  getApiBaseUrl,
  getWebBaseUrl,
} from "../../../../../../Pix-Scripting/src/store/settings"
import { importWithPixivRefreshToken } from "../../../import/iosConfigImporter"
import {
  ActionButton,
  PixAvatar,
  SectionCard,
  SectionHeader,
  ThemedTextInput,
} from "../../components"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

const { PixSystemBridge } = NativeModules

export function AccountSwitcherSheet({
  onClose,
  onAccountChanged,
}: {
  onClose: () => void
  onAccountChanged?: () => void
}) {
  const { colors, accent, accentSoft, isDark } = useAppTheme()
  const insets = useSafeInsets()
  const overlay = useOverlay()

  const [accounts, setAccounts] = useState<StoredAccountProfile[]>(() => session.getAllAccounts())
  const [activeId, setActiveId] = useState<string>(() => (session.userID ? String(session.userID) : ""))
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [addingWeb, setAddingWeb] = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [refreshTokenText, setRefreshTokenText] = useState("")
  const [addingToken, setAddingToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => {
      setAccounts(session.getAllAccounts())
      setActiveId(session.userID ? String(session.userID) : "")
    }
    refresh()
    return session.onAuthChanged(refresh)
  }, [])

  async function handleSwitch(account: StoredAccountProfile) {
    if (switchingId || account.id === activeId) return
    setError(null)
    setSwitchingId(account.id)
    try {
      triggerHaptic("selection")
    } catch {}
    try {
      const ok = await session.switchAccount(account.id)
      if (!ok) {
        setError(`切换到「${account.name}」失败，令牌可能已失效，请重新登录该账号。`)
        return
      }
      overlay.showToast(`已切换至 ${account.name}`, "success")
      onAccountChanged?.()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "切换账号失败")
    } finally {
      setSwitchingId(null)
    }
  }

  async function handleRemove(account: StoredAccountProfile) {
    const isCurrent = account.id === activeId
    const ok = await overlay.confirm({
      title: "移除账号",
      message: isCurrent
        ? `确定移除当前账号「${account.name}」吗？移除后将退出登录。`
        : `确定从已保存列表中移除「${account.name}」吗？`,
      confirmLabel: "移除",
      destructive: true,
    })
    if (!ok) return
    session.removeAccount(account.id)
    overlay.showToast(`已移除 ${account.name}`, "info")
    if (isCurrent) {
      onAccountChanged?.()
      onClose()
    }
  }

  async function handleAddViaWebView() {
    if (addingWeb || addingToken) return
    setError(null)
    setAddingWeb(true)
    try {
      if (!PixSystemBridge?.presentOAuthWebView) {
        throw new Error("当前环境不支持网页 OAuth 登录，请使用 Refresh Token 添加。")
      }
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

      const result = await PixSystemBridge.presentOAuthWebView({
        url: authUrl,
        title: "添加 Pixiv 账号",
        redirectPrefix: OAUTH_REDIRECT_URI,
        redirectPrefixes,
        extraCookieHosts,
        ephemeral: true,
        isDark,
      })

      if (result?.cancelled) {
        return
      }
      const redirectUrl = typeof result?.redirectUrl === "string" ? result.redirectUrl : ""
      const code = extractAuthCode(redirectUrl)
      if (!code) {
        throw new Error("未能获取授权码，请重试")
      }
      const tokenRes = await exchangeCode(code, verifier)
      const cookieHeader =
        typeof result?.cookieHeader === "string" && result.cookieHeader.trim()
          ? result.cookieHeader.trim()
          : null
      session.applyResponse(tokenRes, cookieHeader)
      overlay.showToast(`已登录 ${tokenRes.user.name}`, "success")
      onAccountChanged?.()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "网页登录添加账号失败")
    } finally {
      setAddingWeb(false)
    }
  }

  async function handleAddViaToken() {
    const token = refreshTokenText.trim()
    if (!token || addingToken || addingWeb) return
    setError(null)
    setAddingToken(true)
    try {
      await importWithPixivRefreshToken(token)
      setRefreshTokenText("")
      setShowTokenInput(false)
      overlay.showToast("Refresh Token 登录成功", "success")
      onAccountChanged?.()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? "Refresh Token 验证失败，请检查 Token 或网络设置")
    } finally {
      setAddingToken(false)
    }
  }

  async function handleSignOut() {
    const ok = await overlay.confirm({
      title: "退出当前账号",
      message: "退出后会返回登录页，已保存的账号记录仍可在多账号列表中保留（如需彻底删除请点击移除）。",
      confirmLabel: "退出登录",
      destructive: true,
    })
    if (!ok) return
    session.signOut(false)
    overlay.showToast("已退出登录", "info")
    onAccountChanged?.()
    onClose()
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 28 },
      ]}
    >
      <SectionHeader title={`已保存账号 (${accounts.length})`} />
      <SectionCard>
        {accounts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              暂无已保存的多账号记录
            </Text>
          </View>
        ) : (
          accounts.map((acc, idx) => {
            const isCurrent = acc.id === activeId
            const isBusy = switchingId === acc.id
            const isLast = idx === accounts.length - 1
            return (
              <View
                key={acc.id}
                style={[
                  styles.accountRow,
                  !isLast && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.separator,
                  },
                ]}
              >
                <Pressable
                  style={styles.accountMain}
                  disabled={isCurrent || Boolean(switchingId)}
                  onPress={() => void handleSwitch(acc)}
                >
                  <PixAvatar url={acc.avatarUrl} name={acc.name} size={42} />
                  <View style={styles.accountMeta}>
                    <View style={styles.nameLine}>
                      <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>
                        {acc.name}
                      </Text>
                      {acc.isPremium ? (
                        <View style={[styles.badge, { backgroundColor: `${colors.orange}22` }]}>
                          <Text style={[styles.badgeText, { color: colors.orange }]}>PRO</Text>
                        </View>
                      ) : null}
                      {isCurrent ? (
                        <View style={[styles.badge, { backgroundColor: accentSoft }]}>
                          <Text style={[styles.badgeText, { color: accent }]}>当前</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.accountSub, { color: colors.textSecondary }]} numberOfLines={1}>
                      @{acc.account} · UID {acc.id}
                    </Text>
                  </View>
                </Pressable>

                {isBusy ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Pressable
                    onPress={() => void handleRemove(acc)}
                    hitSlop={8}
                    style={[styles.removeBtn, { backgroundColor: `${colors.danger}16` }]}
                  >
                    <Text style={[styles.removeBtnText, { color: colors.danger }]}>移除</Text>
                  </Pressable>
                )}
              </View>
            )
          })
        )}
      </SectionCard>

      <SectionHeader title="添加账号" />
      <SectionCard style={styles.cardPad}>
        <ActionButton
          title="通过网页 OAuth 登录添加账号"
          onPress={() => void handleAddViaWebView()}
          loading={addingWeb}
          disabled={addingToken || Boolean(switchingId)}
        />
        <ActionButton
          title={showTokenInput ? "收起 Refresh Token 输入" : "使用 Refresh Token 添加账号"}
          variant="secondary"
          onPress={() => {
            setShowTokenInput((v) => !v)
            setError(null)
          }}
          disabled={addingWeb || addingToken}
        />

        {showTokenInput ? (
          <View style={styles.tokenBox}>
            <Text style={[styles.tokenLabel, { color: colors.textSecondary }]}>
              输入 Pixiv Refresh Token
            </Text>
            <ThemedTextInput
              value={refreshTokenText}
              onChangeText={setRefreshTokenText}
              placeholder="粘贴 refresh_token..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
            />
            <ActionButton
              title="验证并切换至该账号"
              onPress={() => void handleAddViaToken()}
              loading={addingToken}
              disabled={!refreshTokenText.trim() || addingWeb}
            />
          </View>
        ) : null}
      </SectionCard>

      {error ? (
        <View
          style={[
            styles.errorBox,
            {
              backgroundColor: isDark ? "rgba(255,69,58,0.16)" : "#FEF2F2",
              borderColor: colors.danger,
            },
          ]}
        >
          <Text style={[styles.errorText, { color: isDark ? "#FCA5A5" : "#991B1B" }]}>{error}</Text>
        </View>
      ) : null}

      {session.isAuthenticated ? (
        <View style={styles.signOutWrap}>
          <ActionButton
            title="退出当前账号"
            variant="danger"
            onPress={() => void handleSignOut()}
            disabled={addingWeb || addingToken || Boolean(switchingId)}
          />
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 4,
  },
  emptyBox: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 13,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  accountMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accountMeta: {
    flex: 1,
    gap: 3,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  accountName: {
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  accountSub: {
    fontSize: 12,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  removeBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  cardPad: {
    padding: 14,
    gap: 10,
  },
  tokenBox: {
    marginTop: 6,
    gap: 8,
  },
  tokenLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  errorBox: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
  },
  signOutWrap: {
    marginHorizontal: 12,
    marginTop: 18,
  },
})
