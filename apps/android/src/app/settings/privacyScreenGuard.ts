/**
 * P2-1 隐私遮罩：`privacyScreenGuard` 的持久化与原生下发。
 *
 * 这里只放不依赖 react-native / Scripting 宿主的纯逻辑（storage 与 bridge 由
 * 调用方注入），便于在 Node + vm 下直接测试键名、默认值与恢复路径。
 * 运行时绑定见 privacyScreenGuardRuntime.ts。
 *
 * 语义：开启后 Android 侧对当前 Window 设置 FLAG_SECURE，系统截图、录屏与
 * 最近任务预览显示为空白；保存到相册、写文件与分享走 FileProvider，不经过
 * 屏幕捕获，因此不受影响。
 */

/** SharedPreferences 键名；一经发布不可改名，否则老用户设置会静默丢失。 */
export const PRIVACY_SCREEN_GUARD_KEY = "pix_privacy_screen_guard_v1"

/** 默认关闭：隐私遮罩会挡住用户自己的截图，必须由用户显式开启。 */
export const DEFAULT_PRIVACY_SCREEN_GUARD = false

export interface PrivacyScreenGuardStorage {
  get<T = unknown>(key: string): T | null
  set(key: string, value: unknown): void
  remove(key: string): void
}

export interface SecureScreenBridge {
  setSecureScreen?: (enabled: boolean) => void
}

/**
 * 历史值可能是布尔、包装过的 JSON 字符串或数字；只有明确表示「开」的才视为开，
 * 其余（含 null、坏数据）一律回落到关闭，避免解析失败反而把用户锁在遮罩里。
 */
export function normalizePrivacyScreenGuard(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "1"
  }
  return false
}

export function readPrivacyScreenGuard(
  storage?: PrivacyScreenGuardStorage | null,
): boolean {
  if (!storage) return DEFAULT_PRIVACY_SCREEN_GUARD
  try {
    return normalizePrivacyScreenGuard(storage.get(PRIVACY_SCREEN_GUARD_KEY))
  } catch {
    return DEFAULT_PRIVACY_SCREEN_GUARD
  }
}

export function writePrivacyScreenGuard(
  storage: PrivacyScreenGuardStorage | null | undefined,
  enabled: boolean,
): boolean {
  if (!storage) return false
  try {
    storage.set(PRIVACY_SCREEN_GUARD_KEY, Boolean(enabled))
    return true
  } catch {
    return false
  }
}

/**
 * 下发到 PixSystemBridge.setSecureScreen。bridge 缺失（旧包或测试替身）或调用
 * 抛错时返回 false，但不影响已持久化的设置，下次启动会重放。
 */
export function applyPrivacyScreenGuard(
  bridge: SecureScreenBridge | null | undefined,
  enabled: boolean,
): boolean {
  const setSecureScreen = bridge?.setSecureScreen
  if (typeof setSecureScreen !== "function") return false
  try {
    setSecureScreen.call(bridge, Boolean(enabled))
    return true
  } catch {
    return false
  }
}

/** 启动恢复：按已存设置下发一次；缺省也显式下发 false，清掉可能残留的旧状态。 */
export function restorePrivacyScreenGuard(
  storage: PrivacyScreenGuardStorage | null | undefined,
  bridge: SecureScreenBridge | null | undefined,
): boolean {
  const enabled = readPrivacyScreenGuard(storage)
  applyPrivacyScreenGuard(bridge, enabled)
  return enabled
}

/** 开关变化：先持久化再下发，返回原生下发是否成功。 */
export function setPrivacyScreenGuard(
  storage: PrivacyScreenGuardStorage | null | undefined,
  bridge: SecureScreenBridge | null | undefined,
  enabled: boolean,
): boolean {
  const next = Boolean(enabled)
  writePrivacyScreenGuard(storage, next)
  return applyPrivacyScreenGuard(bridge, next)
}

/** 恢复默认设置时调用：删除键并立即关掉遮罩。 */
export function resetPrivacyScreenGuard(
  storage: PrivacyScreenGuardStorage | null | undefined,
  bridge: SecureScreenBridge | null | undefined,
): void {
  try {
    storage?.remove(PRIVACY_SCREEN_GUARD_KEY)
  } catch {}
  applyPrivacyScreenGuard(bridge, DEFAULT_PRIVACY_SCREEN_GUARD)
}
