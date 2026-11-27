import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isAIAvailable } from "../../../../../../Pix-Scripting/src/api/aiService"
import {
  loadNovelReaderSettings,
  onNovelReaderSettingsChanged,
  saveNovelReaderSettings,
  type NovelTranslationTargetLanguage,
} from "../../../../../../Pix-Scripting/src/store/novelReaderSettings"
import {
  getNovelTranslationSession,
  type NovelTranslationSession,
  type NovelTranslationSnapshot,
  type TranslationDisplayMode,
} from "../../../../../../Pix-Scripting/src/store/novelTranslation"
import { extractTranslatableBlocks, type NovelChunkItem } from "./novelHtmlBuilder"

export interface UseNovelTranslationParams {
  novelId: number
  title: string
  caption?: string
  text: string
  chunks: NovelChunkItem[]
  seriesId?: number | null
}

export interface UseNovelTranslationResult {
  snapshot: NovelTranslationSnapshot | null
  targetLanguage: NovelTranslationTargetLanguage
  aiAvailable: boolean
  providerNotice: string
  alignmentWarnings: string[]
  start: () => Promise<void>
  pause: () => void
  retryPending: () => Promise<void>
  retryBlock: (blockId: string) => Promise<void>
  clear: () => void
  setMode: (mode: TranslationDisplayMode) => void
  toggleMode: () => void
  setGlossary: (raw: string, locked: boolean) => void
  setTargetLanguage: (lang: NovelTranslationTargetLanguage) => void
}

export function useNovelTranslationHook(
  params: UseNovelTranslationParams,
): UseNovelTranslationResult {
  const [targetLanguage, setTargetLanguageState] = useState<NovelTranslationTargetLanguage>(
    () => loadNovelReaderSettings().translationTargetLanguage,
  )
  const [snapshot, setSnapshot] = useState<NovelTranslationSnapshot | null>(null)
  const sessionRef = useRef<NovelTranslationSession | null>(null)

  useEffect(() => {
    return onNovelReaderSettingsChanged((next) => {
      setTargetLanguageState(next.translationTargetLanguage)
    })
  }, [])

  const blocks = useMemo(() => extractTranslatableBlocks(params.chunks), [params.chunks])

  useEffect(() => {
    if (!params.novelId || !params.text || blocks.length === 0) {
      sessionRef.current = null
      setSnapshot(null)
      return
    }
    const trSession = getNovelTranslationSession({
      novelId: params.novelId,
      title: params.title,
      caption: params.caption ?? "",
      text: params.text,
      targetLanguage,
      seriesId: params.seriesId ?? null,
      blocks,
    })
    sessionRef.current = trSession
    const unsub = trSession.subscribe((next) => {
      setSnapshot(next)
    })
    return () => {
      unsub()
    }
  }, [params.novelId, params.title, params.caption, params.text, params.seriesId, targetLanguage, blocks])

  const start = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    if (s.getSnapshot().mode !== "translated") {
      s.setMode("translated")
    }
    await s.start()
  }, [])

  const pause = useCallback(() => {
    sessionRef.current?.pause()
  }, [])

  const retryPending = useCallback(async () => {
    const s = sessionRef.current
    if (!s) return
    if (s.getSnapshot().mode !== "translated") {
      s.setMode("translated")
    }
    await s.retryPending()
  }, [])

  const retryBlock = useCallback(async (blockId: string) => {
    await sessionRef.current?.retry(blockId)
  }, [])

  const clear = useCallback(() => {
    sessionRef.current?.clear()
  }, [])

  const setMode = useCallback((mode: TranslationDisplayMode) => {
    sessionRef.current?.setMode(mode)
  }, [])

  const toggleMode = useCallback(() => {
    const s = sessionRef.current
    if (!s) return
    const cur = s.getSnapshot().mode
    s.setMode(cur === "translated" ? "original" : "translated")
  }, [])

  const setGlossary = useCallback((raw: string, locked: boolean) => {
    sessionRef.current?.setGlossary(raw, locked)
  }, [])

  const setTargetLanguage = useCallback((lang: NovelTranslationTargetLanguage) => {
    saveNovelReaderSettings({ translationTargetLanguage: lang })
    setTargetLanguageState(lang)
  }, [])

  const aiAvailable = isAIAvailable()
  const providerNotice = useMemo(() => {
    const s = sessionRef.current
    if (!s) return ""
    try {
      return s.sendScopeNotice(s.currentProviderKind())
    } catch {
      return ""
    }
  }, [snapshot?.glossaryCount, targetLanguage])

  const alignmentWarnings = useMemo(() => {
    const s = sessionRef.current
    if (!s) return []
    try {
      return s.alignmentWarnings()
    } catch {
      return []
    }
  }, [snapshot?.done, snapshot?.failed])

  return {
    snapshot,
    targetLanguage,
    aiAvailable,
    providerNotice,
    alignmentWarnings,
    start,
    pause,
    retryPending,
    retryBlock,
    clear,
    setMode,
    toggleMode,
    setGlossary,
    setTargetLanguage,
  }
}
