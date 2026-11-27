import { NativeModules } from "react-native"
import { ScriptingShareSheet } from "./hostGlobals"
import {
  displayNameFromTreeUri,
  evaluateExportDirectoryStatus,
  exportDeliveryMessage,
  fileNameFromPath,
  sanitizeExportFileName,
  type ExportDeliveryFallbackReason,
  type ExportDeliveryResult,
  type ExportDirectoryStatus,
} from "./exportDirectoryNaming"

const { PixSystemBridge } = NativeModules

export interface ExportDirectoryState {
  uri: string
  name: string
  status: ExportDirectoryStatus
}

export interface ExportDeliveryOptions {
  /** 目标显示名；缺省取源文件最后一段 */
  fileName?: string
  /** SAF 不可用时是否沿用既有分享面板；默认不分享，由调用方决定回退位置 */
  fallback?: "share" | "none"
}

function normalizeState(raw: any): ExportDirectoryState | null {
  if (!raw || typeof raw !== "object" || typeof raw.uri !== "string" || !raw.uri.trim()) return null
  const uri = raw.uri.trim()
  const name =
    (typeof raw.name === "string" && raw.name.trim()) ||
    displayNameFromTreeUri(uri) ||
    "已选目录"
  return {
    uri,
    name,
    status: evaluateExportDirectoryStatus(
      { uri, name },
      {
        writeGranted: raw.writeGranted === true,
        reachable: raw.reachable !== false,
      },
    ),
  }
}

/** 读取已保存的导出目录与实时授权状态；未配置或宿主不支持时返回 null */
export async function readExportDirectory(): Promise<ExportDirectoryState | null> {
  if (!PixSystemBridge?.getExportDirectory) return null
  const raw = await PixSystemBridge.getExportDirectory()
  return normalizeState(raw)
}

/**
 * 打开系统目录选择器并持久化授权。
 * 返回 null 表示用户取消；宿主缺少桥接方法时抛错，由设置页给出可见提示。
 */
export async function chooseExportDirectory(): Promise<ExportDirectoryState | null> {
  if (!PixSystemBridge?.pickDirectory) {
    throw new Error("当前宿主不支持目录选择")
  }
  const pickedUri = await PixSystemBridge.pickDirectory()
  if (!pickedUri) return null
  const state = await readExportDirectory()
  if (state) return state
  // 原生已 takePersistableUriPermission，但状态查询异常时仍按刚选中的目录展示。
  return {
    uri: String(pickedUri),
    name: displayNameFromTreeUri(pickedUri) || "已选目录",
    status: "ready",
  }
}

/** 清除目录记录并释放持久化授权，恢复应用专属目录 */
export async function clearExportDirectory(): Promise<void> {
  if (!PixSystemBridge?.clearExportDirectory) return
  await PixSystemBridge.clearExportDirectory()
}

/**
 * 将缓存/文档目录中的成品写入用户选择的 SAF 目录。
 * 失败时按 fallback 配置回退（默认不动作），并返回可展示的原因。
 */
export async function deliverExportFile(
  sourcePath: string,
  options: ExportDeliveryOptions = {},
): Promise<ExportDeliveryResult> {
  const fallbackMode = options.fallback ?? "none"

  const fallback = async (reason: ExportDeliveryFallbackReason): Promise<ExportDeliveryResult> => {
    if (fallbackMode === "share" && sourcePath) {
      try {
        await ScriptingShareSheet.present([sourcePath])
      } catch {}
    }
    return { mode: "fallback", reason }
  }

  if (!sourcePath) return { mode: "fallback", reason: "write-failed" }

  let state: ExportDirectoryState | null = null
  let stateFailed = false
  try {
    state = await readExportDirectory()
  } catch {
    stateFailed = true
  }
  if (stateFailed) return fallback("write-failed")
  if (!state) return fallback("not-configured")
  if (state.status === "revoked") return fallback("revoked")
  if (!PixSystemBridge?.writeToExportDirectory) return fallback("not-configured")

  const desiredName = sanitizeExportFileName(
    options.fileName || fileNameFromPath(sourcePath),
    "bin",
  )
  try {
    const result = await PixSystemBridge.writeToExportDirectory(sourcePath, desiredName)
    if (!result || typeof result.name !== "string" || !result.name) {
      return fallback("write-failed")
    }
    return {
      mode: "saf",
      fileName: result.name,
      directoryName:
        (typeof result.directoryName === "string" && result.directoryName.trim()) ||
        state.name,
    }
  } catch {
    return fallback("write-failed")
  }
}

export { exportDeliveryMessage }
export type { ExportDeliveryResult, ExportDirectoryStatus }
