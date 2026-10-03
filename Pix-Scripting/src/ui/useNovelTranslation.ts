import { useEffect, useMemo, useState } from "scripting"
import { getNovelTranslationSession, type NovelTranslationSnapshot } from "../store/novelTranslation"
import { session as authSession } from "../api/session"
import { resolveEffectiveUID } from "../store/dataDirectory"
import { onCustomAIConfigChanged } from "../store/customAI"
import { parseNovelToChunks } from "./NovelReader"
import { loadNovelReaderSettings, onNovelReaderSettingsChanged } from "../store/novelReaderSettings"

export function useNovelTranslation(
  novelId: number,
  title: string,
  caption: string,
  text: string,
  seriesId?: number | null
) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let uid = resolveEffectiveUID()
    let targetLanguage = loadNovelReaderSettings().translationTargetLanguage
    const stopAuth = authSession.onAuthChanged(() => {
      const next = resolveEffectiveUID()
      if (next !== uid) {
        uid = next
        setRevision((value) => value + 1)
      }
    })
    const stopAI = onCustomAIConfigChanged(() => setRevision((value) => value + 1))
    const stopReaderSettings = onNovelReaderSettingsChanged((settings) => {
      if (settings.translationTargetLanguage !== targetLanguage) {
        targetLanguage = settings.translationTargetLanguage
        setRevision((value) => value + 1)
      }
    })
    return () => { stopAuth(); stopAI(); stopReaderSettings() }
  }, [])
  const session = useMemo(() => {
    if (!novelId || !text) return null
    const blocks = parseNovelToChunks(text)
      .filter((item) => (item.type === "text" && Boolean(item.text)) ||
        (item.type === "chapter" && Boolean(item.title)))
      .map((item) => ({ id: item.id, text: item.type === "chapter" ? item.title! : item.text!,
        kind: item.type === "chapter" ? "chapter" as const : "text" as const }))
    const targetLanguage = loadNovelReaderSettings().translationTargetLanguage
    return getNovelTranslationSession({ novelId, title, caption, text, targetLanguage, seriesId, blocks })
  }, [novelId, title, caption, text, seriesId, revision])
  const [view, setView] = useState<{ session: typeof session; snapshot: NovelTranslationSnapshot } | null>(
    () => session ? { session, snapshot: session.getSnapshot() } : null
  )

  useEffect(() => {
    if (!session) {
      setView(null)
      return
    }
    return session.subscribe((snapshot) => setView({ session, snapshot }))
  }, [session])

  return { session, snapshot: view?.session === session && view.snapshot.novelId === novelId ? view.snapshot : null }
}
