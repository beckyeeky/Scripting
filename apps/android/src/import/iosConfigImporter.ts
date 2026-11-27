import { NativeModules } from "react-native"
import { refreshToken as refreshPixivOAuthToken } from "../../../../Pix-Scripting/src/api/auth"
import { session } from "../../../../Pix-Scripting/src/api/session"
import { clearAllAccountStateCaches } from "../../../../Pix-Scripting/src/store/accountState"
import { loadBlocklist, mergeBlocklistData } from "../../../../Pix-Scripting/src/store/blocklist"
import {
  CROSS_DEVICE_SYNC_FORMAT,
  CROSS_DEVICE_SYNC_SCHEMA_VERSION,
  importCrossDeviceSnapshot,
  type CrossDeviceImportSummary,
  type CrossDeviceSyncBundle,
} from "../../../../Pix-Scripting/src/store/crossDeviceSync"
import {
  loadCustomAIProfile,
  saveCustomAIProfile,
  type CustomAIProfile,
} from "../../../../Pix-Scripting/src/store/customAI"
import { pixivDataDirectory, resolveEffectiveUID } from "../../../../Pix-Scripting/src/store/dataDirectory"
import {
  loadNovelReaderSettings,
  replaceNovelReaderSettings,
  type NovelReaderSettings,
} from "../../../../Pix-Scripting/src/store/novelReaderSettings"
import {
  loadPixivisionBookmarks,
  mergePixivisionBookmarks,
} from "../../../../Pix-Scripting/src/store/pixivisionBookmarks"
import { getSauceNaoEntries, saveSauceNaoApiKeys } from "../../../../Pix-Scripting/src/store/sauceNaoStore"
import { loadSettings, updateSettings, type AppSettings } from "../../../../Pix-Scripting/src/store/settings"
import { clearHostFileCaches, ScriptingFileManager } from "../scripting/hostGlobals"

const { PixFileSystem } = NativeModules

export interface IosConfigImportResult {
  detectedKind:
    | "sync-bundle"
    | "app-settings"
    | "novel-reader-settings"
    | "blocklist"
    | "custom-ai"
    | "saucenao"
    | "credentials"
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

function extractSauceNaoKeys(val: unknown): string[] | null {
  if (!Array.isArray(val) || val.length === 0) return null
  if (val.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return val.map((item) => item.trim())
  }
  if (val.every((item) => item && typeof item === "object" && typeof (item as any).key === "string")) {
    const keys = val.map((item) => String((item as any).key).trim()).filter(Boolean)
    return keys.length > 0 ? keys : null
  }
  return null
}

function looksLikeSauceNaoArray(val: unknown): boolean {
  return extractSauceNaoKeys(val) !== null
}

function extractRefreshToken(obj: Record<string, any>): string {
  if (typeof obj.refreshToken === "string" && obj.refreshToken.trim()) {
    return obj.refreshToken.trim()
  }
  if (typeof obj.credentials?.refreshToken === "string" && obj.credentials.refreshToken.trim()) {
    return obj.credentials.refreshToken.trim()
  }
  return ""
}

/**
 * Invalidate file/text caches and in-memory account store caches so newly imported
 * disk files & keychain items take effect immediately across all screens without restart.
 */
export function refreshAllImportedStores(): void {
  try {
    clearHostFileCaches?.()
  } catch {}
  try {
    clearAllAccountStateCaches()
  } catch {}
  try {
    loadSettings()
  } catch {}
  try {
    loadNovelReaderSettings()
  } catch {}
  try {
    loadCustomAIProfile()
  } catch {}
  try {
    getSauceNaoEntries()
  } catch {}
  try {
    loadBlocklist()
  } catch {}
  try {
    loadPixivisionBookmarks()
  } catch {}
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
  if (res.restoredOfflineDirs.length > 0) parts.push(`离线书库/译文/历史目录 (${res.restoredOfflineDirs.join(", ")})`)
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

function applySanitizedAppSettings(raw: Partial<AppSettings>): void {
  const current = loadSettings()
  updateSettings({
    ...stripIosBookmarks(raw),
    downloadCustomDirectoryBookmark: current.downloadCustomDirectoryBookmark,
    downloadCustomDirectoryPath: current.downloadCustomDirectoryPath,
  })
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

  const isSyncBundle = parsed.format === CROSS_DEVICE_SYNC_FORMAT
  const topSauceNaoKeys = extractSauceNaoKeys(parsed)
  const isCustomAI = !Array.isArray(parsed) && looksLikeCustomAIProfile(parsed)
  const isReaderSettings = !Array.isArray(parsed) && looksLikeNovelReaderSettings(parsed)
  const isBlocklist = !Array.isArray(parsed) && looksLikeBlocklist(parsed)
  const isAppSettings = !Array.isArray(parsed) && looksLikeAppSettings(parsed)
  const extCustomAI = !Array.isArray(parsed) && parsed.customAI && looksLikeCustomAIProfile(parsed.customAI)
  const extSauceNaoKeys = !Array.isArray(parsed) ? extractSauceNaoKeys(parsed.sauceNao) : null
  const refreshToken = !Array.isArray(parsed) ? extractRefreshToken(parsed) : ""

  if (
    !isSyncBundle &&
    !topSauceNaoKeys &&
    !isCustomAI &&
    !isReaderSettings &&
    !isBlocklist &&
    !isAppSettings &&
    !extCustomAI &&
    !extSauceNaoKeys &&
    !refreshToken
  ) {
    throw new Error("未能识别为 Pix-Scripting 的 iOS 配置或同步数据包格式")
  }

  // Phase 1: Apply device-global settings FIRST (ensuring custom API/OAuth gateways take effect before token refresh)
  if (isSyncBundle) {
    result.detectedKind = "sync-bundle"
    if (parsed.appSettings && typeof parsed.appSettings === "object") {
      applySanitizedAppSettings(parsed.appSettings)
      result.appliedAppSettings = true
    }
    if (parsed.novelReaderSettings && typeof parsed.novelReaderSettings === "object") {
      replaceNovelReaderSettings(parsed.novelReaderSettings as NovelReaderSettings)
      result.appliedReaderSettings = true
    }
  } else if (topSauceNaoKeys) {
    result.detectedKind = "saucenao"
    saveSauceNaoApiKeys(topSauceNaoKeys)
    result.appliedSauceNao = true
  } else if (isCustomAI) {
    result.detectedKind = "custom-ai"
    saveCustomAIProfile(parsed as CustomAIProfile)
    result.appliedCustomAI = true
  } else if (isReaderSettings) {
    result.detectedKind = "novel-reader-settings"
    replaceNovelReaderSettings(parsed as NovelReaderSettings)
    result.appliedReaderSettings = true
  } else if (isBlocklist) {
    result.detectedKind = "blocklist"
  } else if (isAppSettings) {
    result.detectedKind = "app-settings"
    applySanitizedAppSettings(parsed)
    result.appliedAppSettings = true
  } else if (refreshToken) {
    result.detectedKind = "credentials"
  } else if (extCustomAI) {
    result.detectedKind = "custom-ai"
  } else if (extSauceNaoKeys) {
    result.detectedKind = "saucenao"
  }

  if (extCustomAI) {
    saveCustomAIProfile(parsed.customAI as CustomAIProfile)
    result.appliedCustomAI = true
  }
  if (extSauceNaoKeys) {
    saveSauceNaoApiKeys(extSauceNaoKeys)
    result.appliedSauceNao = true
  }

  // Phase 2: Authenticate session BEFORE merging UID-scoped history/blocklist/bookmarks
  if (refreshToken) {
    const authRes = await refreshPixivOAuthToken(refreshToken)
    session.applyResponse(authRes, parsed.credentials?.webCookie ?? null)
    result.appliedAuthSession = true
  }

  // Phase 3: Merge UID-scoped stores into the now-active effective UID
  if (isSyncBundle) {
    const summary = importCrossDeviceSnapshot(rawJson, {
      syncToCloudAfterImport: false,
      userId: resolveEffectiveUID(),
    })
    mergeSummary(result, summary)
  } else if (isBlocklist) {
    const merged = mergeBlocklistData(parsed)
    result.addedBlockedTags += merged.addedTags
    result.addedBlockedUsers += merged.addedUsers
  }

  try {
    clearHostFileCaches?.()
  } catch {}

  result.message = summaryToMessage(result)
  return result
}

function locateBackupRoot(extractDir: string): string {
  const directNested = `${extractDir}/Pix-Scripting`
  if (ScriptingFileManager.existsSync(directNested) && ScriptingFileManager.isDirectorySync(directNested)) {
    return directNested
  }
  // Handle ZIPs with a single top-level wrapper folder (e.g. "iOS-Backup/Pix-Scripting")
  const entries = ScriptingFileManager.readDirectorySync(extractDir, false).filter(
    (name) => name && !name.startsWith(".") && name !== "__MACOSX",
  )
  if (entries.length === 1) {
    const onlyDir = `${extractDir}/${entries[0]}`
    if (ScriptingFileManager.isDirectorySync(onlyDir)) {
      const innerPix = `${onlyDir}/Pix-Scripting`
      if (ScriptingFileManager.existsSync(innerPix) && ScriptingFileManager.isDirectorySync(innerPix)) {
        return innerPix
      }
      if (
        ScriptingFileManager.existsSync(`${onlyDir}/Settings`) ||
        ScriptingFileManager.existsSync(`${onlyDir}/NovelReader`) ||
        ScriptingFileManager.existsSync(`${onlyDir}/History`)
      ) {
        return onlyDir
      }
    }
  }
  return extractDir
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

    const sourceRoot = locateBackupRoot(extractDir)

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

    // Check for any exported Pix-Scripting-Sync-*.json bundle at backup root
    for (const entry of ScriptingFileManager.readDirectorySync(sourceRoot, false)) {
      if (entry.toLowerCase().endsWith(".json") && entry.toLowerCase().includes("sync")) {
        const syncPath = `${sourceRoot}/${entry}`
        if (ScriptingFileManager.isFileSync(syncPath)) {
          try {
            const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(syncPath))
            result.appliedAppSettings = result.appliedAppSettings || sub.appliedAppSettings
            result.appliedReaderSettings = result.appliedReaderSettings || sub.appliedReaderSettings
            result.appliedCustomAI = result.appliedCustomAI || sub.appliedCustomAI
            result.appliedSauceNao = result.appliedSauceNao || sub.appliedSauceNao
            result.appliedAuthSession = result.appliedAuthSession || sub.appliedAuthSession
            result.mergedHistoryCount += sub.mergedHistoryCount
            result.mergedNovelProgress += sub.mergedNovelProgress
            result.mergedSearchHistory += sub.mergedSearchHistory
            result.addedBlockedTags += sub.addedBlockedTags
            result.addedBlockedUsers += sub.addedBlockedUsers
            result.mergedPixivisionBookmarks += sub.mergedPixivisionBookmarks
          } catch {}
        }
      }
    }

    const settingsFile = `${sourceRoot}/Settings/settings.json`
    if (ScriptingFileManager.existsSync(settingsFile)) {
      const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(settingsFile))
      result.appliedAppSettings = result.appliedAppSettings || sub.appliedAppSettings
    }

    // iOS stores novel reader settings at NovelReader/settings.json (also support novel_reader_settings.json)
    for (const readerCandidate of [
      `${sourceRoot}/NovelReader/settings.json`,
      `${sourceRoot}/NovelReader/novel_reader_settings.json`,
    ]) {
      if (ScriptingFileManager.existsSync(readerCandidate)) {
        const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(readerCandidate))
        result.appliedReaderSettings = result.appliedReaderSettings || sub.appliedReaderSettings
        break
      }
    }

    // Optional CustomAI & SauceNAO JSON files if user bundled them in backup
    for (const aiCandidate of [
      `${sourceRoot}/custom_ai.json`,
      `${sourceRoot}/CustomAI/profile.json`,
      `${sourceRoot}/CustomAI/custom_ai.json`,
    ]) {
      if (ScriptingFileManager.existsSync(aiCandidate)) {
        try {
          const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(aiCandidate))
          result.appliedCustomAI = result.appliedCustomAI || sub.appliedCustomAI
        } catch {}
      }
    }
    for (const snCandidate of [
      `${sourceRoot}/saucenao.json`,
      `${sourceRoot}/SauceNAO/keys.json`,
    ]) {
      if (ScriptingFileManager.existsSync(snCandidate)) {
        try {
          const sub = await importIosConfigJson(ScriptingFileManager.readAsStringSync(snCandidate))
          result.appliedSauceNao = result.appliedSauceNao || sub.appliedSauceNao
        } catch {}
      }
    }

    // Merge per-user & legacy blocklist
    const blocklistUsersDir = `${sourceRoot}/Blocklist/users`
    if (ScriptingFileManager.existsSync(blocklistUsersDir)) {
      for (const uidDir of ScriptingFileManager.readDirectorySync(blocklistUsersDir, false)) {
        const bf = `${blocklistUsersDir}/${uidDir}/blocklist.json`
        if (ScriptingFileManager.existsSync(bf)) {
          try {
            const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(bf))
            const merged = mergeBlocklistData(parsed)
            result.addedBlockedTags += merged.addedTags
            result.addedBlockedUsers += merged.addedUsers
          } catch {}
        }
      }
    }
    const legacyBlocklist = `${sourceRoot}/Blocklist/blocklist.json`
    if (ScriptingFileManager.existsSync(legacyBlocklist)) {
      try {
        const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(legacyBlocklist))
        const merged = mergeBlocklistData(parsed)
        result.addedBlockedTags += merged.addedTags
        result.addedBlockedUsers += merged.addedUsers
      } catch {}
    }

    // Merge per-user & legacy pixivision bookmarks into active UID
    const activeUid = resolveEffectiveUID()
    const pvUsersDir = `${sourceRoot}/PixivisionBookmarks/users`
    if (ScriptingFileManager.existsSync(pvUsersDir)) {
      for (const uidDir of ScriptingFileManager.readDirectorySync(pvUsersDir, false)) {
        const pf = `${pvUsersDir}/${uidDir}/bookmarks.json`
        if (ScriptingFileManager.existsSync(pf)) {
          try {
            const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(pf))
            if (Array.isArray(parsed)) {
              const merged = mergePixivisionBookmarks(parsed, activeUid)
              result.mergedPixivisionBookmarks += merged.addedOrUpdated
            }
          } catch {}
        }
      }
    }
    const legacyPv = `${sourceRoot}/PixivisionBookmarks/bookmarks.json`
    if (ScriptingFileManager.existsSync(legacyPv)) {
      try {
        const parsed = JSON.parse(ScriptingFileManager.readAsStringSync(legacyPv))
        if (Array.isArray(parsed)) {
          const merged = mergePixivisionBookmarks(parsed, activeUid)
          result.mergedPixivisionBookmarks += merged.addedOrUpdated
        }
      } catch {}
    }

    // Copy offline library, translations (both NovelTranslations & legacy Translations), series caches, and history folders
    const dataRoot = pixivDataDirectory()
    for (const dirName of ["NovelOffline", "NovelTranslations", "Translations", "Series", "History"]) {
      const srcSub = `${sourceRoot}/${dirName}`
      if (ScriptingFileManager.existsSync(srcSub) && ScriptingFileManager.isDirectorySync(srcSub)) {
        const destSub = `${dataRoot}/${dirName}`
        ScriptingFileManager.copyFileSync(srcSub, destSub)
        result.restoredOfflineDirs.push(dirName)
      }
    }

    // Immediately invalidate hotTextCache and all in-memory store caches so restored files take effect without restart
    refreshAllImportedStores()

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
  refreshAllImportedStores()
}

/**
 * Hook for Settings -> Cross-Device Sync -> "从文件导入同步数据":
 * If the user picks a raw `settings.json`, `novel_reader_settings.json`, or `blocklist.json`,
 * transparently wrap it into a temporary `pix-scripting-sync` bundle path so Pix-Scripting's
 * native confirmation dialog & import pipeline succeed seamlessly.
 */
export function convertRawIosJsonFileToSyncBundlePath(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".zip")) {
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
