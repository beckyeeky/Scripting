import { NativeModules } from "react-native"
import { ScriptingStorage } from "../../scripting/hostGlobals"
import {
  readPrivacyScreenGuard,
  resetPrivacyScreenGuard,
  restorePrivacyScreenGuard,
  setPrivacyScreenGuard,
  type PrivacyScreenGuardStorage,
  type SecureScreenBridge,
} from "./privacyScreenGuard"

// ScriptingStorage 落在原生 SharedPreferences（pix_scripting_storage）上，同步读写，
// 启动早期即可用，不依赖 bootstrapStorage 完成。
const storage = ScriptingStorage as unknown as PrivacyScreenGuardStorage

function secureScreenBridge(): SecureScreenBridge | null {
  return (NativeModules as any)?.PixSystemBridge ?? null
}

export function loadPrivacyScreenGuard(): boolean {
  return readPrivacyScreenGuard(storage)
}

/** @returns 原生 bridge 是否接受了下发（false 时设置仍已保存，重启后重放）。 */
export function updatePrivacyScreenGuard(enabled: boolean): boolean {
  return setPrivacyScreenGuard(storage, secureScreenBridge(), enabled)
}

/** 启动时调用：读已存设置并下发给 Activity（Activity 未就绪时由原生排队）。 */
export function syncPrivacyScreenGuardOnLaunch(): boolean {
  return restorePrivacyScreenGuard(storage, secureScreenBridge())
}

/** 「恢复所有默认设置」时调用。 */
export function clearPrivacyScreenGuard(): void {
  resetPrivacyScreenGuard(storage, secureScreenBridge())
}
