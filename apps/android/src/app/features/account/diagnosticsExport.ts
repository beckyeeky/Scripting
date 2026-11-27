import { Platform } from "react-native"
import { SCRIPT_VERSION } from "../../../../../../Pix-Scripting/src/config"
import {
  isCustomAIConfigured,
  loadCustomAIProfile,
} from "../../../../../../Pix-Scripting/src/store/customAI"
import { loadSettings, type AppSettings } from "../../../../../../Pix-Scripting/src/store/settings"
import {
  getAppMetadataSync,
  ScriptingFileManager,
  ScriptingShareSheet,
} from "../../../scripting/hostGlobals"
import {
  buildDiagnosticsSnapshot,
  gatewayHost,
  getRecentDiagnosticErrors,
  type DiagnosticErrorEntry,
} from "../../../scripting/diagnostics"
import { resolveAppMetadata } from "./appMetadata"

export interface DiagnosticsExportResult {
  fileName: string
  filePath: string
  shared: boolean
}

function readAndroidRelease(): string | null {
  const release = (Platform as any)?.constants?.Release
  return typeof release === "string" && release.trim() ? release.trim() : null
}

function readSettingsSafely(): AppSettings | null {
  try {
    return loadSettings()
  } catch {
    return null
  }
}

/**
 * AI 配置只导出「是否配置 / 协议 / 模型 / 能力 / 端点 host」，
 * 绝不读取或写入 apiKey、OAuth refresh token。
 */
function readAIDiagnostics(): Record<string, unknown> | null {
  try {
    const profile = loadCustomAIProfile()
    return {
      configured: isCustomAIConfigured(),
      enabled: Boolean(profile.enabled),
      protocol: profile.general?.protocol ?? null,
      model: profile.general?.model ?? null,
      supportsVision: Boolean(profile.general?.supportsVision),
      noKeyRequired: Boolean(profile.general?.noKeyRequired),
      endpointHost: gatewayHost(profile.general?.endpoint),
      imageGenEnabled: Boolean(profile.imageGen?.enabled),
      imageGenProtocol: profile.imageGen?.protocol ?? null,
      imageGenModel: profile.imageGen?.model ?? null,
    }
  } catch {
    return null
  }
}

export function createDiagnosticsSnapshot(
  errors?: DiagnosticErrorEntry[],
): Record<string, unknown> {
  const metadata = resolveAppMetadata(getAppMetadataSync(), SCRIPT_VERSION)
  const settings = readSettingsSafely()
  return buildDiagnosticsSnapshot({
    app: {
      versionName: metadata.versionName,
      versionCode: metadata.versionCode,
      applicationId: metadata.applicationId,
      metadataSource: metadata.source,
      jsVersion: SCRIPT_VERSION,
    },
    system: {
      platform: Platform.OS,
      apiLevel: Platform.Version,
      release: readAndroidRelease(),
    },
    settings: settings as unknown as Record<string, unknown> | null,
    ai: readAIDiagnostics(),
    recentErrors: errors ?? getRecentDiagnosticErrors(),
  })
}

export function diagnosticsFileName(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `Pix-Diagnostics-${stamp}.json`
}

/**
 * 生成脱敏 JSON 写入 cacheDir/diagnostics，再通过现有 FileProvider 以
 * ACTION_SEND + text/json 分享。任一步失败都会抛出，由设置页给出可见提示。
 */
export async function exportDiagnosticsLog(): Promise<DiagnosticsExportResult> {
  const snapshot = createDiagnosticsSnapshot()
  const json = JSON.stringify(snapshot, null, 2)
  const directory = `${ScriptingFileManager.cacheDirectory}/diagnostics`
  if (!ScriptingFileManager.createDirectorySync(directory)) {
    throw new Error("无法创建诊断日志缓存目录")
  }
  const fileName = diagnosticsFileName()
  const filePath = `${directory}/${fileName}`
  ScriptingFileManager.writeAsStringSync(filePath, json)
  const shared = await ScriptingShareSheet.presentFile(filePath, {
    mimeType: "text/json",
    title: "分享诊断日志",
  })
  return { fileName, filePath, shared }
}
