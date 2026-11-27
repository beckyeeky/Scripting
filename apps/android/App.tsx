import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  DeviceEventEmitter,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import "./src/scripting/polyfills"
import {
  installHostGlobals,
  ScriptingAppEvents,
  ScriptingFileManager,
} from "./src/scripting/hostGlobals"

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
import { AppShell } from "./src/app/navigation/AppShell"
import { NavProvider } from "./src/app/navigation/NavContext"
import { parseDeepLinkUrl } from "./src/app/navigation/routeParser"
import { OverlayProvider, useOverlay } from "./src/app/overlay/OverlayHost"
import { openReverseImageSearch } from "./src/app/features/account/reverseImageSearchEntry"
import { resolveIncomingIntent } from "./src/app/intents/shareIntent"
import { LoginScreen } from "./src/app/screens/LoginScreen"
import { ThemeProvider, useAppTheme } from "./src/app/theme/ThemeProvider"

const { PixSystemBridge } = NativeModules

interface RootErrorBoundaryProps {
  isDark: boolean
  accent: string
  onOpenImport: () => void
  children: React.ReactNode
}

interface RootErrorBoundaryState {
  error: Error | null
  resetKey: number
}

class RootErrorBoundary extends React.Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<RootErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error("Android Root render error:", error)
  }

  render() {
    if (this.state.error) {
      const { isDark, accent, onOpenImport } = this.props
      return (
        <View
          style={[
            styles.splash,
            { padding: 24, backgroundColor: isDark ? "#000000" : "#F2F2F7" },
          ]}
        >
          <Text
            style={[
              styles.brand,
              { fontSize: 22, color: isDark ? "#FFFFFF" : "#111827" },
            ]}
          >
            界面渲染异常
          </Text>
          <Text
            style={{
              marginTop: 10,
              fontSize: 13,
              color: isDark ? "#9CA3AF" : "#4B5563",
              textAlign: "center",
            }}
          >
            {this.state.error?.message || String(this.state.error)}
          </Text>
          <Pressable
            onPress={() =>
              this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }))
            }
            style={[styles.recoveryBtn, { marginTop: 20, backgroundColor: accent }]}
          >
            <Text style={styles.recoveryBtnText}>重新加载界面</Text>
          </Pressable>
          <Pressable
            onPress={onOpenImport}
            style={[
              styles.recoveryBtn,
              {
                marginTop: 12,
                backgroundColor: isDark ? "#1C1C1E" : "#FFFFFF",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.10)",
              },
            ]}
          >
            <Text style={[styles.recoveryBtnText, { color: accent }]}>
              导入 iOS 配置 / Token
            </Text>
          </Pressable>
        </View>
      )
    }
    return (
      <React.Fragment key={`root-${this.state.resetKey}`}>
        {this.props.children}
      </React.Fragment>
    )
  }
}

function AppBootstrapStage({
  bootstrapped,
  loggedIn,
  onLoggedInChanged,
}: {
  bootstrapped: boolean
  loggedIn: boolean
  onLoggedInChanged: (next: boolean) => void
}) {
  const { isDark, accent, colors } = useAppTheme()
  const overlay = useOverlay()
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay

  // Subscribe to Android VIEW / SEND intents cleanly once bootstrapped
  useEffect(() => {
    if (!bootstrapped) return

    const handleImported = (message: string, authChanged: boolean) => {
      overlayRef.current.showToast(message, "success")
      if (authChanged) onLoggedInChanged(session.isAuthenticated)
    }

    const handleIncomingIntent = (intent: any) => {
      if (!intent) return
      try {
        const plan = resolveIncomingIntent(intent)
        switch (plan.type) {
          case "url": {
            const route = parseDeepLinkUrl(plan.url)
            if (route) {
              seedIfRoute(route)
              requestPixivRoute(route)
            }
            break
          }
          case "share-image": {
            // System gallery share: the native bridge already staged the content://
            // URI into the app cache, so hand that path straight to SauceNAO.
            openReverseImageSearch(overlayRef.current, { initialImagePath: plan.filePath })
            break
          }
          case "share-archive": {
            overlayRef.current.openIosImport({
              initialZipPath: plan.filePath,
              onImported: handleImported,
            })
            break
          }
          case "share-json":
          case "share-text-file": {
            try {
              const content = ScriptingFileManager.readAsStringSync(plan.filePath)
              overlayRef.current.openIosImport({
                initialJsonText: content,
                onImported: handleImported,
              })
            } catch (e: any) {
              overlayRef.current.showToast(
                `无法读取分享的配置文件：${e?.message ?? String(e)}`,
                "error",
              )
            }
            break
          }
          case "share-text": {
            const route = parseDeepLinkUrl(plan.text)
            if (route) {
              seedIfRoute(route)
              requestPixivRoute(route)
            } else if (plan.text.startsWith("{")) {
              overlayRef.current.openIosImport({
                initialJsonText: plan.text,
                onImported: handleImported,
              })
            } else {
              overlayRef.current.showToast(
                "分享的文本既不是 Pixiv 链接，也不是可导入的配置。",
                "error",
              )
            }
            break
          }
          case "share-unreadable":
          case "share-unsupported": {
            overlayRef.current.showToast(plan.message, "error")
            break
          }
          default:
            break
        }
      } finally {
        void PixSystemBridge?.clearIntent?.()
      }
    }

    const intentSub = DeviceEventEmitter.addListener("PixIntentEvent", handleIncomingIntent)
    void Promise.resolve(PixSystemBridge?.getInitialIntent?.())
      .then(handleIncomingIntent)
      .catch(() => {})

    return () => {
      intentSub.remove()
    }
  }, [bootstrapped, onLoggedInChanged])

  if (!bootstrapped) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg }]}>
        <Text style={[styles.brand, { color: colors.text }]}>Pix-Scripting</Text>
        <ActivityIndicator size="large" color={accent} style={{ marginTop: 18 }} />
      </View>
    )
  }

  return (
    <RootErrorBoundary
      isDark={isDark}
      accent={accent}
      onOpenImport={() =>
        overlay.openIosImport({
          onImported: (msg, authChanged) => {
            overlay.showToast(msg, "success")
            if (authChanged) onLoggedInChanged(session.isAuthenticated)
          },
        })
      }
    >
      {loggedIn ? (
        <AppShell />
      ) : (
        <LoginScreen onSuccess={() => onLoggedInChanged(session.isAuthenticated)} />
      )}
    </RootErrorBoundary>
  )
}

export default function App(): React.JSX.Element {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [loggedIn, setLoggedIn] = useState(session.isAuthenticated)
  const dismissOverlayRef = useRef<() => boolean>(() => false)

  useEffect(() => {
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

    const sceneListener = (phase: "active" | "inactive" | "background") => {
      if (phase === "background") {
        pauseAllNovelTranslations()
      } else if (phase === "active") {
        resumeMinimizedNovelTranslations()
        triggerFullResumeSync()
        try {
          DownloadTaskManager.checkPendingSignals()
        } catch {}
      }
    }
    ScriptingAppEvents.scenePhase.addListener(sceneListener)

    void (async () => {
      await bootstrapStorage()
      startBackgroundServices()
      setLoggedIn(session.isAuthenticated)
      setBootstrapped(true)
    })()

    return () => {
      stopAuth()
      stopAI()
      ScriptingAppEvents.scenePhase.removeListener(sceneListener)
      cleanupAppResources()
    }
  }, [])

  return (
    <ThemeProvider>
      <NavProvider
        isLoggedIn={loggedIn}
        dismissTopOverlay={() => dismissOverlayRef.current()}
      >
        <OverlayProvider
          registerDismissHandler={(fn) => {
            dismissOverlayRef.current = fn
          }}
        >
          <AppBootstrapStage
            bootstrapped={bootstrapped}
            loggedIn={loggedIn}
            onLoggedInChanged={setLoggedIn}
          />
        </OverlayProvider>
      </NavProvider>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  recoveryBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  recoveryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
})
