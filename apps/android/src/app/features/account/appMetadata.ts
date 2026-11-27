/**
 * 关于页元信息：优先使用原生 BuildConfig（真实 applicationId / versionName /
 * versionCode），原生 bridge 缺失时退回 JS 侧单一版本来源（SCRIPT_VERSION）。
 * 不在此处写死包名或版本号。
 */

export interface AppMetadata {
  applicationId: string | null
  versionName: string
  versionCode: number | null
  source: "native" | "fallback"
}

const APPLICATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

export function normalizeApplicationId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return APPLICATION_ID_PATTERN.test(trimmed) ? trimmed : null
}

export function normalizeVersionName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeVersionCode(value: unknown): number | null {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN
  if (!Number.isFinite(num)) return null
  const int = Math.trunc(num)
  return int > 0 ? int : null
}

export function resolveAppMetadata(raw: unknown, fallbackVersion?: unknown): AppMetadata {
  const bridge =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const nativeVersionName = normalizeVersionName(bridge.versionName)
  return {
    applicationId: normalizeApplicationId(bridge.applicationId),
    versionName: nativeVersionName ?? normalizeVersionName(fallbackVersion) ?? "未知",
    versionCode: normalizeVersionCode(bridge.versionCode),
    source: nativeVersionName ? "native" : "fallback",
  }
}

export function formatVersionNameLabel(metadata: AppMetadata): string {
  return `v${metadata.versionName}`
}

export function formatVersionCodeLabel(metadata: AppMetadata): string {
  return metadata.versionCode == null ? "未知" : String(metadata.versionCode)
}

export function formatApplicationIdLabel(metadata: AppMetadata): string {
  return metadata.applicationId ?? "未知"
}

/** 诊断信息里的单行版本号，含构建号（可用时）。 */
export function formatAppVersionLabel(metadata: AppMetadata): string {
  const base = formatVersionNameLabel(metadata)
  return metadata.versionCode == null ? base : `${base} (${metadata.versionCode})`
}
