/**
 * 诊断日志：脱敏、关键设置快照与最近错误环形缓冲。
 *
 * 本文件只包含纯逻辑，不引用 React Native 或宿主 API，方便 Node 回归测试直接加载。
 * 所有对外导出的诊断数据都必须先经过 redactDiagnostics，避免 token、Cookie、密码
 * 或外形类似长串凭证的值进入分享文件。
 */

export type DiagnosticErrorKind = "ai" | "http" | "navigation"

export interface DiagnosticErrorEntry {
  kind: DiagnosticErrorKind
  code: string
  message: string
  at: string
}

export const MAX_DIAGNOSTIC_ERRORS = 40

const REDACTED = "[REDACTED]"
const MAX_MESSAGE_CHARS = 400
const MAX_CODE_CHARS = 80

// 键名命中即整字段脱敏。大小写不敏感，覆盖 Authorization / Set-Cookie 等常见写法。
const SENSITIVE_KEY_PATTERN =
  /(token|secret|cookie|password|passwd|authorization|credential|api[-_]?key|private[-_]?key|access[-_]?key|phpsessid|sessionid)/i

// 字符串内部的敏感查询参数，例如 ?access_token=...&page=2。
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|refresh_token|id_token|token|secret|cookie|password|authorization|api[-_]?key|access[-_]?key)=)[^&#\s]*/gi

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
// JWT（三段 base64url）整体掩码，避免短 payload 段落逃过长串规则。
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g
// 32+ 位的 base64 / base64url 连续串（含常见填充与 URL-safe 字符）。
const LONG_BASE64_PATTERN = /[A-Za-z0-9+/=_-]{32,}/g

/**
 * 对单个字符串做脱敏：Bearer 串、敏感查询参数、32+ 位十六进制或 base64 串。
 * 不含敏感形态的字符串原样返回。
 */
export function redactDiagnosticString(value: string): string {
  if (!value) return value
  let out = value.replace(BEARER_PATTERN, "Bearer [REDACTED]")
  out = out.replace(SENSITIVE_QUERY_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`)
  out = out.replace(JWT_PATTERN, REDACTED)
  out = out.replace(LONG_HEX_PATTERN, REDACTED)
  out = out.replace(LONG_BASE64_PATTERN, REDACTED)
  return out
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactDiagnosticString(value)
  if (value == null) return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { name: value.name, message: redactDiagnosticString(value.message) }
  }
  if (typeof value !== "object") return String(value)

  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, seen))
    }
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(child, seen)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

/**
 * 递归脱敏任意 JSON 形态的诊断数据：
 * - 键名含 token/secret/cookie/password/authorization 等字段整字段替换为 [REDACTED]；
 * - 非敏感字段中的长串凭证（Bearer、32+ 位十六进制/base64）做掩码；
 * - 其余字段原样保留。
 */
export function redactDiagnostics(input: unknown): unknown {
  return redactValue(input, new WeakSet<object>())
}

/** 关键设置白名单：只导出诊断需要的非敏感项，绝不包含网关 / 代理原始地址。 */
export const DIAGNOSTIC_SETTING_KEYS = [
  "launchPage",
  "showR18",
  "showR18G",
  "showAI",
  "hideNovels",
  "recordHistory",
  "colorScheme",
  "feedColumnCapPortrait",
  "feedColumnCapLandscape",
  "compactIllustCard",
  "heroFirstFeedCard",
  "feedImageQualityIos",
  "detailImageQualityIos",
  "downloadImageQualityIos",
  "ugoiraExportFormat",
  "prefetchEnabled",
  "cacheLimitMB",
  "downloadStorageMode",
  "imageSourceMode",
  "apiGatewayMode",
  "aiTranslateConcurrency",
  "hapticFeedbackPreference",
  "novelImmersiveReaderEnabled",
  "enableLiveActivity",
  "enableTaskNotification",
  "privacyShieldEnabled",
  "advancedSettingsUnlocked",
] as const

/**
 * 只保留网关地址的 host（含端口），去掉用户名、密码、路径与查询参数。
 * 用于在诊断信息中标识「是否使用自定义网关」，而不泄露代理凭证。
 */
export function gatewayHost(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(withScheme)
    return parsed.host || null
  } catch {
    return null
  }
}

export function buildDiagnosticSettingsSnapshot(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = settings ?? {}
  const snapshot: Record<string, unknown> = {}
  for (const key of DIAGNOSTIC_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      snapshot[key] = source[key]
    }
  }
  snapshot.network = {
    customApiHost: gatewayHost(source.customApiBaseUrl),
    customOauthHost: gatewayHost(source.customOauthBaseUrl),
    customAccountHost: gatewayHost(source.customAccountBaseUrl),
    customWebHost: gatewayHost(source.customWebBaseUrl),
    customImageHost: gatewayHost(source.customImageBaseUrl),
  }
  return snapshot
}

export interface DiagnosticsSnapshotInput {
  generatedAt?: string
  app: {
    versionName?: string | null
    versionCode?: number | null
    applicationId?: string | null
    metadataSource?: string | null
    jsVersion?: string | null
  }
  system?: {
    platform?: string | null
    apiLevel?: number | string | null
    release?: string | null
  }
  settings?: Record<string, unknown> | null
  ai?: Record<string, unknown> | null
  recentErrors?: DiagnosticErrorEntry[]
}

/**
 * 生成可直接 JSON.stringify 的诊断快照。返回前统一走 redactDiagnostics，
 * 因此即使调用方误传了敏感字段也不会落盘。
 */
export function buildDiagnosticsSnapshot(
  input: DiagnosticsSnapshotInput,
): Record<string, unknown> {
  const payload = {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    app: {
      name: "Pix-Scripting",
      platform: "android",
      ...input.app,
    },
    system: {
      platform: input.system?.platform ?? "android",
      apiLevel: input.system?.apiLevel ?? null,
      release: input.system?.release ?? null,
    },
    settings: buildDiagnosticSettingsSnapshot(input.settings),
    ai: input.ai ?? null,
    recentErrors: (input.recentErrors ?? []).slice(-MAX_DIAGNOSTIC_ERRORS),
    redactionNote: "已自动脱敏：敏感字段与长串凭证均被掩码。",
  }
  return redactDiagnostics(payload) as Record<string, unknown>
}

// ---------- 最近错误环形缓冲 ----------

let diagnosticErrors: DiagnosticErrorEntry[] = []

function normalizeText(value: unknown, maxChars: number): string {
  if (value == null) return ""
  const text = typeof value === "string" ? value : String(value)
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/**
 * 记录一条错误摘要。诊断收集不能影响主流程，任何异常都被吞掉。
 */
export function recordDiagnosticError(entry: {
  kind: DiagnosticErrorKind
  code?: unknown
  message?: unknown
  at?: string
}): void {
  try {
    const kind: DiagnosticErrorKind =
      entry?.kind === "ai" || entry?.kind === "http" || entry?.kind === "navigation"
        ? entry.kind
        : "http"
    diagnosticErrors.push({
      kind,
      code: normalizeText(entry?.code, MAX_CODE_CHARS) || "UNKNOWN",
      message: normalizeText(entry?.message, MAX_MESSAGE_CHARS),
      at: typeof entry?.at === "string" && entry.at ? entry.at : new Date().toISOString(),
    })
    if (diagnosticErrors.length > MAX_DIAGNOSTIC_ERRORS) {
      diagnosticErrors = diagnosticErrors.slice(-MAX_DIAGNOSTIC_ERRORS)
    }
  } catch {
    // 诊断收集是尽力而为，绝不向调用方抛出。
  }
}

export function getRecentDiagnosticErrors(): DiagnosticErrorEntry[] {
  return diagnosticErrors.map((entry) => ({ ...entry }))
}

export function clearDiagnosticErrors(): void {
  diagnosticErrors = []
}
