import { AppEvents, Navigation, Script, type ScenePhase } from "scripting"
import { RootView } from "./src/ui/appRoot"
import {
  bootstrapStorage,
  cleanupAppResources,
  flushAllCaches,
  seedIfRoute,
  startBackgroundServices,
} from "./src/bootstrap"
import { triggerResumeSync } from "./src/store/historySync"
import { requestPixivRoute } from "./src/store/routeNavigation"
import { DownloadTaskManager } from "./src/downloader/downloadTaskManager"
import { discardNovelTranslationSessions, pauseAllNovelTranslations, resumeMinimizedNovelTranslations } from "./src/store/novelTranslation"
import { session } from "./src/api/session"
import { resolveEffectiveUID } from "./src/store/dataDirectory"
import { onCustomAIConfigChanged } from "./src/store/customAI"

async function main() {
  let stopAuth: (() => void) | undefined
  let stopAI: (() => void) | undefined
  let sceneListener: ((phase: ScenePhase) => void) | undefined
  try {
    let translationUID = resolveEffectiveUID()
    stopAuth = session.onAuthChanged(() => {
      const nextUID = resolveEffectiveUID()
      if (nextUID !== translationUID) {
        translationUID = nextUID
        discardNovelTranslationSessions()
      }
    })
    stopAI = onCustomAIConfigChanged(() => discardNovelTranslationSessions())
    sceneListener = (phase: ScenePhase) => {
      if (phase === "background") pauseAllNovelTranslations()
      else if (phase === "active" && !Script.isMinimized()) resumeMinimizedNovelTranslations()
    }
    AppEvents.scenePhase.addListener(sceneListener)
    const startupRoute =
      (Script.queryParameters?.route as string | undefined) ||
      (Script.widgetParameter
        ? (Script.widgetParameter.includes(":") ? Script.widgetParameter : `illust:${Script.widgetParameter}`)
        : null)
    if (startupRoute && typeof startupRoute === "string") {
      seedIfRoute(startupRoute)
      requestPixivRoute(startupRoute)
    }

    Script.onResume((details) => {
      if (details.resumeFromMinimized) resumeMinimizedNovelTranslations()
      const resumeRoute =
        (details.queryParameters?.route as string | undefined) ||
        (details.widgetParameter
          ? (details.widgetParameter.includes(":") ? details.widgetParameter : `illust:${details.widgetParameter}`)
          : null)
      if (resumeRoute && typeof resumeRoute === "string") {
        seedIfRoute(resumeRoute)
        requestPixivRoute(resumeRoute)
      }
      try {
        DownloadTaskManager.checkPendingSignals()
      } catch {}
      triggerResumeSync()
    })
    Script.onMinimize(() => {
      pauseAllNovelTranslations()
      flushAllCaches()
    })
    Script.enableMinimize()

    await bootstrapStorage()
    startBackgroundServices()

    await Navigation.present({
      element: <RootView />,
      modalPresentationStyle: "fullScreen",
    })
  } catch (e: any) {
    console.error("Main app runtime error:", e)
    try {
      await console.present()
    } catch {}
  } finally {
    stopAuth?.()
    stopAI?.()
    if (sceneListener) AppEvents.scenePhase.removeListener(sceneListener)
    cleanupAppResources()
    Script.exit()
  }
}

main()
