/**
 * xAI (Grok) OAuth 2.0 设备码授权与令牌刷新管理
 * 采用 OIDC Discovery + RFC 8628 Device Authorization Grant + Refresh Token 自动续期
 */
import { fetch } from "scripting"
import {
  loadCustomAIProfile,
  updateCustomAIProfile,
  type GeneralAIConfig,
} from "../store/customAI"

export const GROK_OAUTH_PRESET_ID = "grok-oauth"
export const GROK_OAUTH_DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration"
export const GROK_OAUTH_DEFAULT_DEVICE_ENDPOINT = "https://auth.x.ai/oauth2/device/code"
export const GROK_OAUTH_DEFAULT_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token"
export const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
export const GROK_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access"

export interface GrokOAuthEndpoints {
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
}

export interface GrokDeviceAuthSession {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  interval: number
  tokenEndpoint: string
}

export interface GrokOAuthTokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  email?: string
}

let cachedEndpoints: GrokOAuthEndpoints | null = null
let refreshInFlight: Promise<string> | null = null

function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
}

function decodeJwtEmail(idToken?: string): string | undefined {
  if (!idToken || typeof idToken !== "string") return undefined
  try {
    const parts = idToken.split(".")
    if (parts.length < 2) return undefined
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const mod = b64.length % 4
    if (mod > 0) {
      b64 += "=".repeat(4 - mod)
    }
    const raw = Data.fromBase64String(b64)?.toRawString()
    if (!raw) return undefined
    const payload = JSON.parse(raw)
    if (typeof payload?.email === "string" && payload.email.trim()) {
      return payload.email.trim()
    }
    if (typeof payload?.preferred_username === "string" && payload.preferred_username.trim()) {
      return payload.preferred_username.trim()
    }
    if (typeof payload?.name === "string" && payload.name.trim()) {
      return payload.name.trim()
    }
  } catch {
    // 忽略无法解析的 id_token
  }
  return undefined
}

async function sleepWithAbort(ms: number, signal?: { aborted?: boolean }): Promise<void> {
  const step = 250
  let elapsed = 0
  while (elapsed < ms) {
    if (signal?.aborted) {
      throw new Error("已取消 Grok OAuth 登录")
    }
    const waitMs = Math.min(step, ms - elapsed)
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    elapsed += waitMs
  }
  if (signal?.aborted) {
    throw new Error("已取消 Grok OAuth 登录")
  }
}

function isValidHttpsEndpoint(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/\S+$/i.test(value.trim())
}

export async function discoverGrokOAuthEndpoints(): Promise<GrokOAuthEndpoints> {
  if (cachedEndpoints) return cachedEndpoints
  try {
    const res = await fetch(GROK_OAUTH_DISCOVERY_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (res.ok) {
      const json: any = await res.json()
      const deviceAuthorizationEndpoint = isValidHttpsEndpoint(json?.device_authorization_endpoint)
        ? json.device_authorization_endpoint.trim()
        : GROK_OAUTH_DEFAULT_DEVICE_ENDPOINT
      const tokenEndpoint = isValidHttpsEndpoint(json?.token_endpoint)
        ? json.token_endpoint.trim()
        : GROK_OAUTH_DEFAULT_TOKEN_ENDPOINT
      cachedEndpoints = { deviceAuthorizationEndpoint, tokenEndpoint }
      return cachedEndpoints
    }
  } catch {
    // Discovery 请求失败时回退默认 xAI OAuth 端点
  }
  cachedEndpoints = {
    deviceAuthorizationEndpoint: GROK_OAUTH_DEFAULT_DEVICE_ENDPOINT,
    tokenEndpoint: GROK_OAUTH_DEFAULT_TOKEN_ENDPOINT,
  }
  return cachedEndpoints
}

export async function startGrokDeviceAuthorization(): Promise<GrokDeviceAuthSession> {
  const { deviceAuthorizationEndpoint, tokenEndpoint } = await discoverGrokOAuthEndpoints()
  const res = await fetch(deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formEncode({
      client_id: GROK_OAUTH_CLIENT_ID,
      scope: GROK_OAUTH_SCOPE,
    }),
  })

  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`
    throw new Error(`发起 Grok OAuth 设备码授权失败：${detail}`)
  }

  const deviceCode = typeof data?.device_code === "string" ? data.device_code.trim() : ""
  const userCode = typeof data?.user_code === "string" ? data.user_code.trim() : ""
  const verificationUri =
    typeof data?.verification_uri === "string" && data.verification_uri.trim()
      ? data.verification_uri.trim()
      : ""
  const verificationUriComplete =
    typeof data?.verification_uri_complete === "string" && data.verification_uri_complete.trim()
      ? data.verification_uri_complete.trim()
      : undefined

  if (!deviceCode || !userCode || (!verificationUri && !verificationUriComplete)) {
    throw new Error("xAI 授权服务返回的设备码数据不完整，请稍后重试")
  }

  const expiresIn =
    typeof data?.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 900
  const interval =
    typeof data?.interval === "number" && Number.isFinite(data.interval) && data.interval > 0
      ? data.interval
      : 5

  return {
    deviceCode,
    userCode,
    verificationUri: verificationUri || verificationUriComplete!,
    verificationUriComplete,
    expiresIn,
    interval,
    tokenEndpoint,
  }
}

function parseTokenResponse(data: any, fallbackRefreshToken?: string): GrokOAuthTokenData {
  const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : ""
  if (!accessToken) {
    throw new Error("Grok OAuth 未返回有效的访问令牌")
  }
  const refreshToken =
    typeof data?.refresh_token === "string" && data.refresh_token.trim()
      ? data.refresh_token.trim()
      : fallbackRefreshToken
  const expiresInNum = Number(data?.expires_in)
  const expiresAt =
    Number.isFinite(expiresInNum) && expiresInNum > 0
      ? Date.now() + expiresInNum * 1000
      : undefined

  return {
    accessToken,
    refreshToken,
    expiresAt,
    tokenType: typeof data?.token_type === "string" ? data.token_type : undefined,
    scope: typeof data?.scope === "string" ? data.scope : undefined,
    email: decodeJwtEmail(data?.id_token),
  }
}

export async function pollGrokDeviceToken(
  authSession: GrokDeviceAuthSession,
  signal?: { aborted?: boolean }
): Promise<GrokOAuthTokenData> {
  const deadline = Date.now() + authSession.expiresIn * 1000
  let intervalSec = Math.max(1, authSession.interval || 5)

  while (Date.now() < deadline) {
    await sleepWithAbort(intervalSec * 1000, signal)

    const res = await fetch(authSession.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formEncode({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: GROK_OAUTH_CLIENT_ID,
        device_code: authSession.deviceCode,
      }),
    })

    let data: any = null
    try {
      data = await res.json()
    } catch {
      data = null
    }

    if (res.ok && data?.access_token) {
      return parseTokenResponse(data)
    }

    const errCode = typeof data?.error === "string" ? data.error : ""
    if (errCode === "authorization_pending") {
      continue
    }
    if (errCode === "slow_down") {
      intervalSec += 5
      continue
    }
    if (errCode === "access_denied") {
      throw new Error("用户已拒绝 Grok 授权")
    }
    if (errCode === "expired_token") {
      throw new Error("授权验证码已过期，请重新发起登录")
    }
    throw new Error(data?.error_description || errCode || `Grok OAuth 授权失败 (HTTP ${res.status})`)
  }

  throw new Error("等待授权超时，请重试")
}

export async function refreshGrokOAuthToken(refreshToken: string): Promise<GrokOAuthTokenData> {
  const cleanRefresh = refreshToken.trim()
  if (!cleanRefresh) {
    throw new Error("缺少 Grok OAuth 刷新令牌")
  }
  const { tokenEndpoint } = await discoverGrokOAuthEndpoints()
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formEncode({
      grant_type: "refresh_token",
      client_id: GROK_OAUTH_CLIENT_ID,
      refresh_token: cleanRefresh,
    }),
  })

  let data: any = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`
    throw new Error(`Grok OAuth 令牌刷新失败：${detail}`)
  }

  return parseTokenResponse(data, cleanRefresh)
}

export async function ensureFreshGrokAccessToken(
  config?: GeneralAIConfig,
  forceRefresh = false
): Promise<string> {
  const target = config ?? loadCustomAIProfile().general
  if (
    !forceRefresh &&
    target.apiKey &&
    (!target.oauthExpiresAt || Date.now() < target.oauthExpiresAt - 120_000)
  ) {
    return target.apiKey
  }

  if (!target.oauthRefreshToken) {
    if (!forceRefresh && target.apiKey) {
      return target.apiKey
    }
    throw new Error("Grok OAuth 尚未登录或令牌已失效，请前往「自定义AI模型」重新授权登录")
  }

  if (refreshInFlight) {
    return refreshInFlight
  }

  const refreshTokenStr = target.oauthRefreshToken
  refreshInFlight = (async () => {
    const tokenData = await refreshGrokOAuthToken(refreshTokenStr)
    const currentProfile = loadCustomAIProfile()
    if (currentProfile.general.preset === GROK_OAUTH_PRESET_ID) {
      updateCustomAIProfile({
        general: {
          ...currentProfile.general,
          apiKey: tokenData.accessToken,
          oauthRefreshToken: tokenData.refreshToken ?? currentProfile.general.oauthRefreshToken,
          oauthExpiresAt: tokenData.expiresAt,
          ...(tokenData.email ? { oauthAccountEmail: tokenData.email } : {}),
          noKeyRequired: false,
        },
      })
    }
    return tokenData.accessToken
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}
