import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  DeviceEventEmitter,
  NativeModules,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native"
import "./src/scripting/polyfills"
import { installHostGlobals, setCustomPickFilesHandler, ScriptingFileManager } from "./src/scripting/hostGlobals"

installHostGlobals()

import { session } from "../../Pix-Scripting/src/api/session"
import {
  bootstrapStorage,
  cleanupAppResources,
  seedIfRoute,
  startBackgroundServices,
} from "../../Pix-Scripting/src/bootstrap"
import { DownloadTaskManager } from "../../Pix-Scripting/src/downloader/downloadTaskManager"
import { onCustomAIConfigChanged } from "../../Pix-Scripting/src/store/customAI"
import { triggerFullResumeSync } from "../../Pix-Scripting/src/store/crossDeviceSync"
import { resolveEffectiveUID } from "../../Pix-Scripting/src/store/dataDirectory"
import {
  discardNovelTranslationSessions,
  pauseAllNovelTranslations,
  resumeMinimizedNovelTranslations,
} from "../../Pix-Scripting/src/store/novelTranslation"
import { requestPixivRoute } from "../../Pix-Scripting/src/store/routeNavigation"
import { loadSettings, onSettingsChanged } from "../../Pix-Scripting/src/store/settings"
import { RootView } from "../../Pix-Scripting/src/ui/appRoot"
import { IosConfigImportModal } from "./src/import/IosConfigImportModal"
import {
  convertRawIosJsonFileToSyncBundlePath,
  importIosConfigJson,
  importIosZipBackup,
} from "./src/import/iosConfigImporter"
import { ScriptingDialog, ScriptingAppEvents } from "./src/scripting/hostGlobals"
import { ensureGlobalBackHandler } from "./src/scripting/navigation"
import { ScriptingOverlayHost } from "./src/scripting/overlays"
import { ThemeContext } from "./src/scripting/theme"

const { PixSystemBridge } = NativeModules

function parseDeepLinkRoute(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  if (rawUrl.startsWith("pix-scripting://")) {
    const clean = rawUrl.replace(/^pix-scripting:\/\//, "")
    return clean.replace(/^route\//, "")
  }
  const illustMatch = rawUrl.match(/pixiv\.net\/(?:[a-z]+\/)?artworks\/(\d+)/i)
  if (illustMatch) return `illust:${illustMatch[1]}`
  const novelMatch = rawUrl.match(/pixiv\.net\/novel\/show\.php\?id=(\d+)/i)
  if (novelMatch) return `novel:${novelMatch[1]}`
  const userMatch = rawUrl.match(/pixiv\.net\/(?:[a-z]+\/)?users\/(\d+)/i)
  if (userMatch) return `user:${userMatch[1]}`
  return null
}

export default function App(): React.JSX.Element {
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light"
  const [bootstrapped, setBootstrapped] = useState(false)
  const [loggedIn, setLoggedIn] = useState(session.isAuthenticated)
  const [settings, setSettings] = useState(() => loadSettings())
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [sharedImportJson, setSharedImportJson] = useState<string | null>(null)
  const [sharedImportZip, setSharedImportZip] = useState<string | null>(null)

  useEffect(() => {
    ensureGlobalBackHandler()

    // Hook Settings -> "从文件导入同步数据" so raw settings.json / .zip backups also work seamlessly
    setCustomPickFilesHandler(async () => {
      const files = await PixSystemBridge?.pickFiles?.(["application/json", "application/zip", "text/plain", "*/*"])
      const picked = Array.isArray(files) ? files[0] : null
      if (!picked?.filePath) return []
      const path = String(picked.filePath)
      if (path.toLowerCase().endsWith(".zip") || String(picked.name || "").toLowerCase().endsWith(".zip")) {
        const res = await importIosZipBackup(path)
        await ScriptingDialog.alert({
          title: "已导入 iOS 备份包",
          message: res.message,
        })
        return []
      }
      return [convertRawIosJsonFileToSyncBundlePath(path)]
    })

    let translationUID = resolveEffectiveUID()
    const stopAuth = session.onAuthChanged(() => {
      setLoggedIn(session.isAuthenticated)
      const nextUID = resolveEffectiveUID()
      if (nextUID !== translationUID) {
        translationUID = nextUID
        discardNovelTranslationSessions()
      }
    })
    const stopAI = onCustomAIConfigChanged(() => discardNovelTranslationSessions())
    const stopSettings = onSettingsChanged(() => setSettings(loadSettings()))

    const sceneListener = (phase: "active" | "inactive" | "background") => {
      if (phase === "background") pauseAllNovelTranslations()
      else if (phase === "active") {
        resumeMinimizedNovelTranslations()
        triggerFullResumeSync()
        try {
          DownloadTaskManager.checkPendingSignals()
        } catch {}
      }
    }
    ScriptingAppEvents.scenePhase.addListener(sceneListener)

    const handleIncomingIntent = (intent: any) => {
      if (!intent) return
      if (intent.kind === "url" && intent.url) {
        const route = parseDeepLinkRoute(intent.url)
        if (route) {
          seedIfRoute(route)
          requestPixivRoute(route)
        }
        void PixSystemBridge?.clearIntent?.()
        return
      }
      if (intent.kind === "share") {
        const firstFile = Array.isArray(intent.files) ? intent.files[0] : null
        if (firstFile?.filePath) {
          const lower = String(firstFile.name || firstFile.filePath).toLowerCase()
          if (lower.endsWith(".zip")) {
            setSharedImportZip(firstFile.filePath)
            setImportModalVisible(true)
          } else if (lower.endsWith(".json") || String(firstFile.mimeType || "").includes("json") || String(firstFile.mimeType || "").startsWith("text/")) {
            try {
              const content = ScriptingFileManager.readAsStringSync(firstFile.filePath)
              setSharedImportJson(content)
              setImportModalVisible(true)
            } catch {}
          }
        } else if (typeof intent.text === "string" && intent.text.trim()) {
          const route = parseDeepLinkRoute(intent.text.trim())
          if (route) {
            seedIfRoute(route)
            requestPixivRoute(route)
          } else if (intent.text.trim().startsWith("{")) {
            setSharedImportJson(intent.text.trim())
            setImportModalVisible(true)
          }
        }
        void PixSystemBridge?.clearIntent?.()
      }
    }

    const intentSub = DeviceEventEmitter.addListener("PixIntentEvent", handleIncomingIntent)

    void (async () => {
      await bootstrapStorage()
      startBackgroundServices()
      setSettings(loadSettings())
      setLoggedIn(session.isAuthenticated)
      setBootstrapped(true)
      const initial = await PixSystemBridge?.getInitialIntent?.()
      handleIncomingIntent(initial)
    })()

    return () => {
      setCustomPickFilesHandler(null)
      stopAuth()
      stopAI()
      stopSettings()
      ScriptingAppEvents.scenePhase.removeListener(sceneListener)
      intentSub.remove()
      cleanupAppResources()
    }
  }, [])

  const isDark =
    settings.colorScheme === "dark"
      ? true
      : settings.colorScheme === "light"
        ? false
        : systemScheme === "dark"

  const tint =
    settings.glassCustomTintEnabled && settings.glassTintColor
      ? settings.glassTintColor
      : isDark
        ? "#0A84FF"
        : "#007AFF"

  return (
    <ThemeContext.Provider value={{ isDark, tint, colors: {} }}>
      <SafeAreaView style={[styles.root, { backgroundColor: isDark ? "#000000" : "#F2F2F7" }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        {!bootstrapped ? (
          <View style={styles.splash}>
            <Text style={[styles.brand, { color: isDark ? "#FFFFFF" : "#111827" }]}>Pix-Scripting</Text>
            <ActivityIndicator size="large" color={tint} style={{ marginTop: 18 }} />
          </View>
        ) : (
          <View style={styles.root}>
            <RootView />
            {!loggedIn ? (
              <View style={styles.importPillWrap} pointerEvents="box-none">
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setImportModalVisible(true)}
                  style={[
                    styles.importPill,
                    {
                      backgroundColor: isDark ? "rgba(28,28,30,0.88)" : "rgba(255,255,255,0.92)",
                      borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.10)",
                    },
                  ]}
                >
                  <Text style={[styles.importPillText, { color: tint }]}>导入 iOS 配置 / Token</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

        <ScriptingOverlayHost />

        <IosConfigImportModal
          visible={importModalVisible}
          initialJsonText={sharedImportJson}
          initialZipPath={sharedImportZip}
          onClose={() => {
            setImportModalVisible(false)
            setSharedImportJson(null)
            setSharedImportZip(null)
          }}
          onImported={async (msg, authChanged) => {
            setSettings(loadSettings())
            if (authChanged) {
              setLoggedIn(session.isAuthenticated)
            }
            if (sharedImportJson || sharedImportZip) {
              setImportModalVisible(false)
              setSharedImportJson(null)
              setSharedImportZip(null)
              await ScriptingDialog.alert({ title: "导入成功", message: msg })
            }
          }}
        />
      </SafeAreaView>
    </ThemeContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 32, fontWeight: "800", letterSpacing: 0.4 },
  importPillWrap: {
    position: "absolute",
    bottom: 26,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  importPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
  },
  importPillText: { fontSize: 14, fontWeight: "600" },
})
