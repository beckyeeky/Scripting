import { NativeModules } from "react-native"
import { refreshToken as refreshPixivOAuthToken } from "../../../../Pix-Scripting/src/api/auth"
import { session } from "../../../../Pix-Scripting/src/api/session"
import { mergeBlocklistData } from "../../../../Pix-Scripting/src/store/blocklist"
import {
  CROSS_DEVICE_SYNC_FORMAT,
  CROSS_DEVICE_SYNC_SCHEMA_VERSION,
  importCrossDeviceSnapshot,
  type CrossDeviceImportSummary,
  type CrossDeviceSyncBundle,
} from "../../../../Pix-Scripting/src/store/crossDeviceSync"
import { saveCustomAIProfile, type CustomAIProfile } from "../../../../Pix-Scripting/src/store/customAI"
import { pixivDataDirectory, resolveEffectiveUID } from "../../../../Pix-Scripting/src/store/dataDirectory"
import {
  replaceNovelReaderSettings,
  type NovelReaderSettings,
} from "../../../../Pix-Scripting/src/store/novelReaderSettings"
import { mergePixivisionBookmarks } from "../../../../Pix-Scripting/src/store/pixivisionBookmarks"
import { saveSauceNaoApiKeys } from "../../../../Pix-Scripting/src/store/sauceNaoStore"
import { loadSettings, updateSettings, type AppSettings } from "../../../../Pix-Scripting/src/store/settings"
import { ScriptingFileManager } from "../scripting/hostGlobals"

const { PixFileSystem } = NativeModules

export interface IosConfigImportResult {
  detectedKind:
    | "sync-bundle"
    | "app-settings"
    | "novel-reader-settings"
    | "blocklist"
    | "custom-ai"
    | "saucenao"
    | "ios-zip-backup"
  appliedAppSettings: boolean
  appliedReaderSettings: boolean
  appliedCustomAI: boolean
  appliedSauceNao: boolean
  appliedAuthSession: boolean
  mergedHistoryCount: number
  mergedNovelProgress: number
  mergedSearchHistory: number
  addedBlockedTags: number
  addedBlockedUsers: number
  mergedPixivisionBookmarks: number
  restoredOfflineDirs: string[]
  message: string
}

function stripIosBookmarks(raw: Partial<AppSettings>): Partial<AppSettings> {
  const {
    downloadCustomDirectoryBookmark: _b,
    downloadCustomDirectoryPath: _p,
    ...rest
  } = raw
  return rest
}

function looksLikeAppSettings(obj: Record<string, any>): boolean {
  const markers = [
    "launchPage",
    "pageLayout",
    "imageSourceMode",
    "apiGatewayMode",
    "customApiBaseUrl",
    "customOauthBaseUrl",
    "customImageBaseUrl",
    "ambientImmersion",
    "feedColumnCapPortrait",
    "showR18",
  ]
  let matches = 0
  for (const key of markers) {
    if (key in obj) matches++
  }
  return matches >= 2
}

function looksLikeNovelReaderSettings(obj: Record<string, any>): boolean {
  return (
    ("fontId" in obj || "fontSize" in obj) &&
    ("layoutDirection" in obj || "pageDisplayMode" in obj || "translationTargetLanguage" in obj)
  )
}

function looksLikeCustomAIProfile(obj: Record<string, any>): boolean {
  return Boolean(
    obj.general &&
      typeof obj.general === "object" &&
      ("protocol" in obj.general || "endpoint" in obj.general) &&
      ("imageGen" in obj || "enabled" in obj),
  )
}

function looksLikeBlocklist(obj: Record<string, any>): boolean {
  return Array.isArray(obj.blockedTags) || Array.isArray(obj.blockedUsers)
}

function looksLikeSauceNaoArray(val: unknown): boolean {
  return (
    Array.isArray(val) &&
    val.length > 0 &&
    val.every((item) => item && typeof item === "object" && typeof (item as any).key === "string")
  )
}

export function buildSyncBundleFromPartial(opts: {
  appSettings?: Partial<AppSettings>
  novelReaderSettings?: Partial<NovelReaderSettings>
  blocklist?: any
  pixivisionBookmarks?: any[]
}): CrossDeviceSyncBundle {
  const mergedSettings: AppSettings | undefined = opts.appSettings
    ? ({ ...loadSettings(), ...stripIosBookmarks(opts.appSettings) } as AppSettings)
    : undefined

  return {
    format: CROSS_DEVICE_SYNC_FORMAT,
    schemaVersion: CROSS_DEVICE_SYNC_SCHEMA_VERSION,
    exportedAt: Date.now(),
    uid: resolveEffectiveUID(),
    ...(mergedSettings ? { appSettings: mergedSettings } : {}),
    ...(opts.novelReaderSettings ? { novelReaderSettings: opts.novelReaderSettings as NovelReaderSettings } : {}),
    ...(opts.blocklist ? { blocklist: opts.blocklist } : {}),
    ...(opts.pixivisionBookmarks ? { pixivisionBookmarks: opts.pixivisionBookmarks } : {}),
  }
}

function summaryToMessage(res: IosConfigImportResult): string {
  const parts: string[] = []
  if (res.appliedAppSettings) parts.push("应用设置")
  if (res.appliedReaderSettings) parts.push("阅读器排版设置")
  if (res.appliedCustomAI) parts.push("自定义 AI 模型配置")
  if (res.appliedSauceNao) parts.push("SauceNAO 密钥")
  if (res.appliedAuthSession) parts.push("Pixiv 登录会话")
  if (res.mergedHistoryCount > 0) parts.push(`浏览历史 ${res.mergedHistoryCount} 条`)
  if (res.mergedNovelProgress > 0) parts.push(`小说进度 ${res.mergedNovelProgress} 条`)
  if (res.mergedSearchHistory > 0) parts.push(`搜索历史 ${res.mergedSearchHistory} 条`)
  if (res.addedBlockedTags > 0 || res.addedBlockedUsers > 0) {
    parts.push(`屏蔽 ${res.addedBlockedTags} 标签 / ${res.addedBlockedUsers} 画师`)
  }
  if (res.mergedPixivisionBookmarks > 0) parts.push(`特辑收藏 ${res.mergedPixivisionBookmarks} 条`)
  if (res.restoredOfflineDirs.length > 0) parts.push(`离线书库/译文目录 (${res.restoredOfflineDirs.join(", ")})`)
  return parts.length > 0 ? `已导入：${parts.join("、")}` : "配置已与当前设备一致，无需更新"
}

function mergeSummary(target: IosConfigImportResult, s: CrossDeviceImportSummary) {
  target.appliedAppSettings = target.appliedAppSettings || s.appliedAppSettings
  target.appliedReaderSettings = target.appliedReaderSettings || s.appliedReaderSettings
  target.mergedHistoryCount +=
    s.mergedHistoryItems.illustration + s.mergedHistoryItems.manga + s.mergedHistoryItems.novel
  target.mergedNovelProgress += s.mergedNovelProgress
  target.mergedSearchHistory += s.mergedSearchHistory
  target.addedBlockedTags += s.addedBlockedTags
  target.addedBlockedUsers += s.addedBlockedUsers
  target.mergedPixivisionBookmarks += s.mergedPixivisionBookmarks
}

/**
 * Import any iOS configuration JSON (Pix-Scripting-Sync bundle, raw settings.json,
 * novel_reader_settings.json, blocklist.json, CustomAIProfile, SauceNAO list,
 * or extended JSON with credentials/refreshToken).
 */
export async function importIosConfigJson(rawJson: string): Promise<IosConfigImportResult> {
  let parsed: any
  try {
    parsed = JSON.parse(rawJson.trim())
  } catch {
    throw new Error("所选内容不是有效的 JSON 配置格式")
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("配置内容为空或结构无效")
  }

  const result: IosConfigImportResult = {
    detectedKind: "sync-bundle",
    appliedAppSettings: false,
    appliedReaderSettings: false,
    appliedCustomAI: false,
    appliedSauceNao: false,
    appliedAuthSession: false,
    mergedHistoryCount: 0,
    mergedNovelProgress: 0,
    mergedSearchHistory: 0,
    addedBlockedTags: 0,
    addedBlockedUsers: 0,
    mergedPixivisionBookmarks: 0,
    restoredOfflineDirs: [],
    message: "",
  }

  // 1. Standard Pix-Scripting cross-device sync bundle
  if (parsed.format === CROSS_DEVICE_SYNC_FORMAT) {
    result.detectedKind = "sync-bundle"
    const summary = importCrossDeviceSnapshot(rawJson, { syncToCloudAfterImport: false })
    mergeSummary(result, summary)
  } else if (looksLikeSauceNaoArray(parsed)) {
    result.detectedKind = "saucenao"
    saveSauceNaoApiKeys(parsed.map((e: any) => String(e.key).trim()).filter(Boolean))
    result.appliedSauceNao = true
  } else if (looksLikeCustomAIProfile(parsed)) {
    result.detectedKind = "custom-ai"
    saveCustomAIProfile(parsed as CustomAIProfile)
    result.appliedCustomAI = true
  } else if (looksLikeNovelReaderSettings(parsed)) {
    result.detectedKind = "novel-reader-settings"
    replaceNovelReaderSettings(parsed as NovelReaderSettings)
    result.appliedReaderSettings = true
  } else if (looksLikeBlocklist(parsed)) {
    result.detectedKind = "blocklist"
    const merged = mergeBlocklistData(parsed)
    result.addedBlockedTags += merged.addedTags
    result.addedBlockedUsers += merged.addedUsers
  } else if (looksLikeAppSettings(parsed)) {
    result.detectedKind = "app-settings"
    const current = loadSettings()
    updateSettings({
      ...stripIosBookmarks(parsed),
      downloadCustomDirectoryBookmark: current.downloadCustomDirectoryBookmark,
      downloadCustomDirectoryPath: current.downloadCustomDirectoryPath,
    })
    result.appliedAppSettings = true
  } else {
    throw new Error("未能识别为 Pix-Scripting 的 iOS 配置或同步数据包格式")
  }

  // Optional extended fields (if user exported combined JSON with AI/SauceNAO/Token)
  if (parsed.customAI && looksLikeCustomAIProfile(parsed.customAI)) {
    saveCustomAIProfile(parsed.customAI as CustomAIProfile)
    result.appliedCustomAI = true
  }
  if (looksLikeSauceNaoArray(parsed.sauceNao)) {
    saveSauceNaoApiKeys(parsed.sauceNao.map((e: any) => String(e.key).trim()).filter(Boolean))
    result.appliedSauceNao = true
  }
  const token =
    typeof parsed.refreshToken === "string"
      ? parsed.refreshToken.trim()
      : typeof parsed.credentials?.refreshToken === "string"
        ? parsed.credentials.refreshToken.trim()
        : ""
  if (token) {
    const authRes = await refreshPixivOAuthToken(token)
    session.applyResponse(authRes, parsed.credentials?.webCookie ?? null)
    result.appliedAuthSession = true
  }

  result.message = summaryToMessage(result)
  return result
}

/**
 * Import a zipped iOS `Pix-Scripting/` directory backup (from iOS Files / iCloud Drive).
 */
export async function importIosZipBackup(zipPath: string): Promise<IosConfigImportResult> {
  if (!PixFileSystem?.unzipArchive) {
    throw new Error("ZIP 解压模块不可用")
  }
  const extractDir = `${ScriptingFileManager.temporaryDirectory}/ios_import_${Date.now()}`
  ScriptingFileManager.createDirectorySync(extractDir, true)

  try {
    await PixFileSystem.unzipArchive(zipPath, extractDir, false)

    // Locate root folder (either extractDir itself or extractDir/Pix-Scripting)
    let sourceRoot = extractDir
    const nestedRoot = `${extractDir}/Pix-Scripting`
    if (ScriptingFileManager.existsSync(nestedRoot) && ScriptingFileManager.isDirectorySync(nestedRoot)) {
      sourceRoot = nestedRoot
    }

    const result: IosConfigImportResult = {
      detectedKind: "ios-zip-backup",
      appliedAppSettings: false,
      appliedReaderSettings: false,
      appliedCustomAI: false,
      appliedSauceNao: false,
      appliedAuthSession: false,
      mergedHistoryCount: 0,
      mergedNovelProgress: 0,
      mergedSearchHistory: 0,
      addedBlockedTags: 0,
      addedBlockedUsers: 0,
      mergedPixivisionBookmarks: 0,
      restoredOfflineDirs: [],
      message: "",
    }

    const settingsFile = `${sourceRoot}/Settings/settings.json`
    if (ScriptingFileManager.existsSync(settingsFile)) {
      const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(settingsFile))
      result.appliedAppSettings = sub.appliedAppSettings
    }

    const readerFile = `${sourceRoot}/NovelReader/novel_reader_settings.json`
    if (ScriptingFileManager.existsSync(readerFile)) {
      const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(readerFile))
      result.appliedReaderSettings = sub.appliedReaderSettings
    }

    // Merge per-user blocklist & pixivision bookmarks
    const blocklistUsersDir = `${sourceRoot}/Blocklist/users`
    if (ScriptingFileManager.existsSync(blocklistUsersDir)) {
      for (const uidDir of ScriptingFileManager.readDirectorySync(blocklistUsersDir, false)) {
        const bf = `${blocklistUsersDir}/${uidDir}/blocklist.json`
        if (ScriptingFileManager.existsSync(bf)) {
          const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(bf))
          const merged = mergeBlocklistData(parsed)
          result.addedBlockedTags += merged.addedTags
          result.addedBlockedUsers += merged.addedUsers
        }
      }
    }

    const pvUsersDir = `${sourceRoot}/PixivisionBookmarks/users`
    if (ScriptingFileManager.existsSync(pvUsersDir)) {
      for (const uidDir of ScriptingFileManager.readDirectorySync(pvUsersDir, false)) {
        const pf = `${pvUsersDir}/${uidDir}/bookmarks.json`
        if (ScriptingFileManager.existsSync(pf)) {
          const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(pf))
          if (Array.isArray(parsed)) {
            const merged = mergePixivisionBookmarks(parsed, uidDir)
            result.mergedPixivisionBookmarks += merged.addedOrUpdated
          }
        }
      }
    }

    // Copy offline library, translations, series caches, and history folders directly into local data root
    const dataRoot = pixivDataDirectory()
    for (const dirName of ["NovelOffline", "Translations", "Series", "History"]) {
      const srcSub = `${sourceRoot}/${dirName}`
      if (ScriptingFileManager.existsSync(srcSub) && ScriptingFileManager.isDirectorySync(srcSub)) {
        const destSub = `${dataRoot}/${dirName}`
        ScriptingFileManager.copyFileSync(srcSub, destSub)
        result.restoredOfflineDirs.push(dirName)
      }
    }

    result.message = summaryToMessage(result)
    return result
  } finally {
    try {
      ScriptingFileManager.removeSync(extractDir)
    } catch {}
  }
}

export async function importWithPixivRefreshToken(rawToken: string): Promise<void> {
  const token = rawToken.trim()
  if (!token) throw new Error("请输入有效的 Refresh Token")
  const authRes = await refreshPixivOAuthToken(token)
  session.applyResponse(authRes, null)
}

/**
 * Hook for Settings -> Cross-Device Sync -> "从文件导入同步数据":
 * If the user picks a raw `settings.json`, `novel_reader_settings.json`, or `blocklist.json`,
 * transparently wrap it into a temporary `pix-scripting-sync` bundle path so Pix-Scripting's
 * native confirmation dialog & import pipeline succeed seamlessly.
 */
export function convertRawIosJsonFileToSyncBundlePath(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".zip")) {
    // ZIP backups are handled directly in the importer; return sentinel handled by caller
    return filePath
  }
  const raw = ScriptingFileManager.readAsStringSync(filePath)
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return filePath
  }
  if (!parsed || typeof parsed !== "object") return filePath
  if (parsed.format === CROSS_DEVICE_SYNC_FORMAT) return filePath

  let bundle: CrossDeviceSyncBundle | null = null
  if (looksLikeAppSettings(parsed)) {
    bundle = buildSyncBundleFromPartial({ appSettings: parsed })
  } else if (looksLikeNovelReaderSettings(parsed)) {
    bundle = buildSyncBundleFromPartial({ novelReaderSettings: parsed })
  } else if (looksLikeBlocklist(parsed)) {
    bundle = buildSyncBundleFromPartial({ blocklist: parsed })
  }
  if (!bundle) return filePath

  const outPath = `${ScriptingFileManager.temporaryDirectory}/converted_ios_sync_${Date.now()}.json`
  ScriptingFileManager.writeAsStringSync(outPath, JSON.stringify(bundle, null, 2))
  return outPath
}
