import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import {
  addNovelMarker,
  deleteNovelMarker,
  illustrationDetail,
  novelDetail,
  novelViewerData,
} from "../../../../../../Pix-Scripting/src/api/pixiv"
import { session } from "../../../../../../Pix-Scripting/src/api/session"
import { exportNovelToEpub } from "../../../../../../Pix-Scripting/src/downloader/epubExporter"
import { exportNovelToText } from "../../../../../../Pix-Scripting/src/downloader/novelTextExporter"
import { imageUrlOf, loadImage } from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  getCachedNovelMarker,
  onNovelMarkerChanged,
} from "../../../../../../Pix-Scripting/src/store/bookmarkSync"
import { computeNovelContentVersion } from "../../../../../../Pix-Scripting/src/store/novelAnchor"
import {
  buildBilingualNovelSource,
  buildNovelPlainTextDocument,
  buildTranslatedNovelSource,
  novelTranslationExportIssue,
} from "../../../../../../Pix-Scripting/src/store/novelExport"
import {
  offlineImageSummaryText,
  persistOfflineImages,
} from "../../../../../../Pix-Scripting/src/store/novelOfflineImages"
import {
  completePendingOfflineImage,
  hasOfflineEpisode,
  mimeFromPath,
  readOfflineEpisode,
  readOfflineImageDataUrl,
  saveOfflineEpisode,
} from "../../../../../../Pix-Scripting/src/store/novelOfflineLibrary"
import {
  flushNovelProgress,
  getNovelProgress,
  recordNovelProgress,
} from "../../../../../../Pix-Scripting/src/store/novelProgress"
import {
  loadNovelReaderSettings,
  onNovelReaderSettingsChanged,
  type NovelReaderSettings,
} from "../../../../../../Pix-Scripting/src/store/novelReaderSettings"
import { loadSettings, onSettingsChanged } from "../../../../../../Pix-Scripting/src/store/settings"
import {
  anchorFromReaderMessage,
  readerJumpPayload,
} from "../../../../../../Pix-Scripting/src/ui/novelReaderRuntime"
import {
  buildOfflineImageTasks,
  uploadedImageUrl,
} from "../../../../../../Pix-Scripting/src/ui/novelOfflineCapture"
import {
  ScriptingFileManager,
  ScriptingSafari,
  ScriptingShareSheet,
  ScriptingStorage,
} from "../../../scripting/hostGlobals"
import { useAppNav } from "../../navigation/NavContext"
import type { Route } from "../../navigation/types"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { NovelAISheet } from "./NovelAISheet"
import {
  buildNovelImagePatchScript,
  buildNovelJumpScript,
  buildNovelReaderHtml,
  buildNovelTranslationPatchScript,
  buildNovelTypographyPatchScript,
  indexNovelChunkPages,
  parseNovelToChunks,
  resolveReaderThemePalette,
  type NovelReaderThemeId,
} from "./novelHtmlBuilder"
import { NovelOutlineSearchSheet, type JumpAnchorTarget } from "./NovelOutlineSearchSheet"
import { NovelTranslationSheet } from "./NovelTranslationSheet"
import { NovelTypographySheet } from "./NovelTypographySheet"
import { PixNativeWebView, type PixNativeWebViewHandle } from "./PixNativeWebView"
import {
  EMPTY_CRASH_RECOVERY_STATE,
  recoveryAnchorFromProgress,
  shouldRebuildAfterCrash,
  type NovelCrashRecoveryState,
} from "./novelReaderRecovery"
import { useNovelTranslationHook } from "./useNovelTranslationHook"

const READER_THEME_KEY = "android_novel_reader_theme_v1"
const READER_RESTORE_NOTICE_TIMEOUT_MS = 10_000

type ReaderCrashNotice =
  | { phase: "restoring"; attempt: number }
  | { phase: "failed"; attempt: number }

function loadStoredReaderTheme(): NovelReaderThemeId {
  const saved = ScriptingStorage.get<string>(READER_THEME_KEY)
  if (saved === "light" || saved === "sepia" || saved === "dark" || saved === "system") {
    return saved
  }
  return "system"
}

export function NovelReaderScreen(props: Extract<Route, { name: "novelReader" }>) {
  const { isDark, colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const webViewRef = useRef<PixNativeWebViewHandle | null>(null)
  const ownerGenRef = useRef(1)
  const currentChunkIdRef = useRef<string | null>(
    props.initialChunkId ?? getNovelProgress(props.novelId)?.chunkId ?? null,
  )
  const currentChunkIdxRef = useRef<number>(0)
  // novelImmersiveReaderEnabled 在 AppSettings（设置页「小说沉浸阅读模式」），默认开启时才隐藏上下栏
  const immersiveReaderRef = useRef<boolean>(loadSettings().novelImmersiveReaderEnabled)
  const [showHud, setShowHud] = useState<boolean>(
    () => !loadSettings().novelImmersiveReaderEnabled,
  )
  const [readerSettings, setReaderSettings] = useState<NovelReaderSettings>(() =>
    loadNovelReaderSettings(),
  )
  const [readerTheme, setReaderTheme] = useState<NovelReaderThemeId>(() =>
    loadStoredReaderTheme(),
  )
  const [currentPage, setCurrentPage] = useState<number>(
    () => props.initialPage ?? getNovelProgress(props.novelId)?.page ?? 1,
  )
  const [scrollRatio, setScrollRatio] = useState<number>(0)
  const [markerPage, setMarkerPage] = useState<number | null>(
    () => getCachedNovelMarker(props.novelId) ?? null,
  )
  const [isOfflineSaved, setIsOfflineSaved] = useState<boolean>(() =>
    hasOfflineEpisode(props.novelId),
  )
  const [navigatingEpisode, setNavigatingEpisode] = useState(false)
  const [htmlReadyGen, setHtmlReadyGen] = useState(0)
  // Crash recovery: rebuild the document with a fresh generation and remount
  // the native WebView (a WebView whose renderer died cannot be reused).
  const [recoveryDoc, setRecoveryDoc] = useState<{ html: string; generation: number } | null>(
    null,
  )
  const [webViewEpoch, setWebViewEpoch] = useState(0)
  const [crashNotice, setCrashNotice] = useState<ReaderCrashNotice | null>(null)
  const crashRecoveryStateRef = useRef<NovelCrashRecoveryState>({
    ...EMPTY_CRASH_RECOVERY_STATE,
  })
  const lastCrashGenerationRef = useRef(0)
  const lastAnchorRef = useRef<{
    page: number
    chunkId: string | null
    offset: number
    quote: string
  } | null>(null)

  useEffect(() => {
    return onNovelReaderSettingsChanged((next) => {
      setReaderSettings(next)
    })
  }, [])

  useEffect(() => {
    return onSettingsChanged(() => {
      const next = loadSettings().novelImmersiveReaderEnabled
      if (next === immersiveReaderRef.current) return
      immersiveReaderRef.current = next
      setShowHud(!next)
    })
  }, [])

  useEffect(() => {
    return onNovelMarkerChanged((novelID, page) => {
      if (novelID === props.novelId) setMarkerPage(page)
    })
  }, [props.novelId])

  useEffect(() => {
    return () => {
      flushNovelProgress()
    }
  }, [])

  const chunks = useMemo(
    () => parseNovelToChunks(props.text, props.textEmbeddedImages),
    [props.text, props.textEmbeddedImages],
  )
  const contentVersion = useMemo(
    () => computeNovelContentVersion(props.text),
    [props.text],
  )
  const chunkPageMap = useMemo(() => indexNovelChunkPages(chunks), [chunks])
  const totalPages = useMemo(() => {
    let maxP = 1
    for (const p of Object.values(chunkPageMap)) {
      if (p > maxP) maxP = p
    }
    return maxP
  }, [chunkPageMap])

  const translation = useNovelTranslationHook({
    novelId: props.novelId,
    title: props.title,
    caption: props.caption,
    text: props.text,
    chunks,
    seriesId: props.seriesId ?? null,
  })
  const translationRef = useRef(translation.snapshot)
  translationRef.current = translation.snapshot

  // Resolve initial reading anchor once per novel load
  const initialJump = useMemo(() => {
    const saved = getNovelProgress(props.novelId)
    if (props.initialChunkId || (props.initialPage && props.initialPage > 1)) {
      return {
        chunkId: props.initialChunkId ?? null,
        page: props.initialPage ?? 1,
        offset: 0,
      }
    }
    if (saved) {
      const resolved = readerJumpPayload(
        {
          novelId: props.novelId,
          page: saved.page,
          chunkId: saved.chunkId,
          contentVersion: saved.contentVersion,
          offset: saved.offset,
          quote: saved.quote,
          chunkIndex: saved.chunkIndex,
          updatedAt: saved.updatedAt,
        },
        chunks,
        contentVersion,
      )
      return {
        chunkId: resolved.chunkId,
        page: resolved.page,
        offset: resolved.offset,
        quote: resolved.quote,
      }
    }
    return null
  }, [props.novelId, props.initialChunkId, props.initialPage, chunks, contentVersion])

  // Pre-read any offline embedded images
  const offlineInitialImages = useMemo(() => {
    const map: Record<string, string> = {}
    for (const chunk of chunks) {
      if (chunk.type === "uploadedimage" || chunk.type === "pixivimage") {
        const dataUrl = readOfflineImageDataUrl(props.novelId, chunk.id)
        if (dataUrl) map[chunk.id] = dataUrl
      }
    }
    return map
  }, [props.novelId, chunks])

  // Build a full reader document. Used both by the structural memo below and
  // by crash recovery (with an explicit anchor + fresh owner generation).
  const composeReaderHtml = (
    ownerGeneration: number,
    anchor: { chunkId?: string | null; page?: number; offset?: number; quote?: string } | null,
  ) =>
    buildNovelReaderHtml({
      novelId: props.novelId,
      title: props.title,
      chunks,
      settings: readerSettings,
      readerTheme,
      systemIsDark: isDark,
      ownerGeneration,
      safeTopPx: insets.top,
      safeBottomPx: insets.bottom,
      initialChunkId: anchor?.chunkId ?? null,
      initialPage: anchor?.page ?? 1,
      initialAnchor: anchor,
      seriesTitle: props.seriesTitle ?? null,
      seriesPrev: props.seriesPrev ?? null,
      seriesNext: props.seriesNext ?? null,
      episodeNumber: props.episodeNumber ?? null,
      initialImages: offlineInitialImages,
    })

  // Rebuild HTML only when structural layout/content changes (NOT on font size/theme/translation patch)
  const { html, generation } = useMemo(() => {
    const gen = ++ownerGenRef.current
    const doc = composeReaderHtml(gen, initialJump)
    return { html: doc, generation: gen }
    // Intentionally omit fontSize/fontWeight/lineSpacing/fontId/readerTheme/isDark so they live-patch smoothly!
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.novelId,
    props.title,
    chunks,
    readerSettings.layoutDirection,
    readerSettings.pageDisplayMode,
    props.seriesTitle,
    props.seriesPrev?.id,
    props.seriesNext?.id,
    props.episodeNumber,
  ])

  const activeGeneration = recoveryDoc?.generation ?? generation
  const activeHtml = recoveryDoc?.html ?? html

  // A structural rebuild replaces the recovered document; drop recovery state
  // so the freshly built base document is used instead.
  useEffect(() => {
    setRecoveryDoc(null)
    setCrashNotice(null)
    crashRecoveryStateRef.current = { ...EMPTY_CRASH_RECOVERY_STATE }
  }, [generation])

  // Live-patch typography & theme changes without reloading HTML
  useEffect(() => {
    if (htmlReadyGen !== activeGeneration) return
    const script = buildNovelTypographyPatchScript(readerSettings, readerTheme, isDark)
    void webViewRef.current?.evaluateJavaScript(script)
  }, [
    htmlReadyGen,
    activeGeneration,
    readerSettings.fontId,
    readerSettings.fontSize,
    readerSettings.fontWeight,
    readerSettings.lineSpacingLevel,
    readerSettings.customFontPostscriptName,
    readerTheme,
    isDark,
  ])

  // Live-patch translation updates without reloading HTML
  useEffect(() => {
    if (htmlReadyGen !== activeGeneration) return
    const script = buildNovelTranslationPatchScript(
      translation.snapshot,
      currentChunkIdRef.current,
    )
    void webViewRef.current?.evaluateJavaScript(script)
  }, [htmlReadyGen, activeGeneration, translation.snapshot])

  // Async resolve & inject [uploadedimage:] and [pixivimage:] embedded images
  useEffect(() => {
    if (htmlReadyGen !== activeGeneration) return
    let cancelled = false
    const imageChunks = chunks.filter(
      (c) => (c.type === "uploadedimage" || c.type === "pixivimage") && !offlineInitialImages[c.id],
    )
    if (imageChunks.length === 0) return

    ;(async () => {
      for (const chunk of imageChunks) {
        if (cancelled) return
        try {
          let url: string | null = null
          if (chunk.type === "uploadedimage") {
            url = uploadedImageUrl(chunk.info)
            if (!url && chunk.imageId && props.textEmbeddedImages) {
              url = uploadedImageUrl(props.textEmbeddedImages[chunk.imageId])
            }
          } else if (chunk.type === "pixivimage" && chunk.illustId) {
            const illust = await session.call((tk) => illustrationDetail(chunk.illustId!, tk))
            const pageIdx = Math.max(0, (chunk.page ?? 1) - 1)
            url = imageUrlOf(illust, pageIdx, "large") || imageUrlOf(illust, pageIdx, "medium")
          }
          if (!url || cancelled) continue
          const filePath = await loadImage(url, 50)
          if (!filePath || cancelled) continue
          completePendingOfflineImage(props.novelId, chunk.id, filePath)
          const data = ScriptingFileManager.readAsDataSync(filePath)
          const b64 = data.toBase64String()
          if (!b64 || cancelled) continue
          const dataUrl = `data:${mimeFromPath(filePath)};base64,${b64}`
          const script = buildNovelImagePatchScript(chunk.id, dataUrl, currentChunkIdRef.current)
          void webViewRef.current?.evaluateJavaScript(script)
        } catch {
          // Keep placeholder gracefully if an embedded image fails
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [htmlReadyGen, activeGeneration, chunks, offlineInitialImages, props.novelId, props.textEmbeddedImages])

  const handleThemeChange = useCallback((next: NovelReaderThemeId) => {
    setReaderTheme(next)
    ScriptingStorage.set(READER_THEME_KEY, next)
  }, [])

  const handleJumpToAnchor = useCallback((target: JumpAnchorTarget, toastText?: string) => {
    if (target.chunkId) currentChunkIdRef.current = target.chunkId
    if (target.page && target.page > 0) setCurrentPage(target.page)
    lastAnchorRef.current = {
      page: target.page && target.page > 0 ? target.page : currentPage,
      chunkId: target.chunkId ?? currentChunkIdRef.current,
      offset: typeof target.offset === "number" ? target.offset : 0,
      quote: typeof target.quote === "string" ? target.quote : "",
    }
    void webViewRef.current?.evaluateJavaScript(buildNovelJumpScript(target))
    if (toastText) overlay.showToast(toastText, "info")
  }, [currentPage, overlay])

  const openSeriesEpisode = useCallback(
    async (targetId: number) => {
      if (navigatingEpisode || !targetId) return
      setNavigatingEpisode(true)
      try {
        flushNovelProgress()
        const offline = readOfflineEpisode(targetId)
        let nextText = offline?.text ?? ""
        let nextCover = offline?.coverUrl ?? null
        let nextEmbedded: Record<string, any> | undefined
        let nextTitle = offline?.title ?? `作品 ${targetId}`
        let nextCaption = offline?.caption ?? undefined
        let nextSeriesId = props.seriesId ?? null
        let nextSeriesTitle = props.seriesTitle ?? null
        let nextPrev: { id: number; title?: string } | null = null
        let nextNext: { id: number; title?: string } | null = null
        let nextEp: number | null = offline?.episodeNumber ?? null

        try {
          const [detail, viewer] = await Promise.all([
            session.call((tk) => novelDetail(targetId, tk)),
            session.call((tk) => novelViewerData(targetId, tk)),
          ])
          if (viewer?.text) nextText = viewer.text
          if (viewer?.coverUrl) nextCover = viewer.coverUrl
          if (viewer?.textEmbeddedImages) nextEmbedded = viewer.textEmbeddedImages
          if (detail) {
            nextTitle = detail.title || nextTitle
            nextCaption = detail.caption || nextCaption
            nextSeriesId = detail.series?.id ?? nextSeriesId
            nextSeriesTitle = detail.series?.title ?? nextSeriesTitle
            nextPrev = detail.series_prev
              ? { id: detail.series_prev.id, title: detail.series_prev.title }
              : null
            nextNext = detail.series_next
              ? { id: detail.series_next.id, title: detail.series_next.title }
              : null
            nextEp = detail.episode_number ?? nextEp
          }
        } catch (err) {
          if (!nextText) throw err
        }

        if (!nextText) {
          overlay.showToast("无法加载该章节正文", "error")
          return
        }
        nav.replace({
          name: "novelReader",
          novelId: targetId,
          title: nextTitle,
          caption: nextCaption,
          text: nextText,
          coverUrl: nextCover,
          textEmbeddedImages: nextEmbedded,
          seriesId: nextSeriesId,
          seriesTitle: nextSeriesTitle,
          seriesPrev: nextPrev,
          seriesNext: nextNext,
          episodeNumber: nextEp,
        })
      } catch (err: any) {
        overlay.showToast(`切换章节失败：${err?.message ?? err}`, "error")
      } finally {
        setNavigatingEpisode(false)
      }
    },
    [navigatingEpisode, nav, overlay, props.seriesId, props.seriesTitle],
  )

  const handleScriptMessage = useCallback(
    (name: string, payload: any, _gen: number) => {
      if (payload?.owner != null && payload.owner !== ownerGenRef.current) return
      if (name === "toggleControls") {
        // 未开启沉浸模式时上下栏常驻，轻触正文不隐藏
        if (!immersiveReaderRef.current) return
        setShowHud((v) => !v)
        return
      }
      if (name === "readerReady") {
        const ownerGeneration = Number(payload?.owner)
        setHtmlReadyGen(
          Number.isFinite(ownerGeneration) && ownerGeneration > 0
            ? ownerGeneration
            : ownerGenRef.current,
        )
        // A loaded document clears the transient notice, but the retry budget
        // stays: a renderer that dies shortly after every load must not loop
        // forever. nextRecoveryAttempt expires the budget after the window.
        setCrashNotice((prev) => (prev?.phase === "restoring" ? null : prev))
        return
      }
      if (name === "onProgressChange") {
        const page = typeof payload?.page === "number" && payload.page > 0 ? payload.page : 1
        const chunkId = typeof payload?.chunkId === "string" ? payload.chunkId : undefined
        const chunkIndex = typeof payload?.chunkIndex === "number" ? payload.chunkIndex : 0
        currentChunkIdRef.current = chunkId ?? null
        currentChunkIdxRef.current = chunkIndex
        setCurrentPage(page)
        if (typeof payload?.ratio === "number") setScrollRatio(payload.ratio)

        const chunkObj = chunks[chunkIndex]
        const chunkText = chunkObj?.type === "chapter" ? chunkObj.title : chunkObj?.text
        const anchor = anchorFromReaderMessage(payload, chunkText, contentVersion, props.novelId)
        lastAnchorRef.current = {
          page,
          chunkId: chunkId ?? null,
          offset:
            typeof anchor?.offset === "number"
              ? anchor.offset
              : typeof payload?.offset === "number"
                ? Math.max(0, payload.offset)
                : 0,
          quote:
            typeof anchor?.quote === "string"
              ? anchor.quote
              : typeof payload?.quote === "string"
                ? payload.quote
                : "",
        }
        recordNovelProgress(props.novelId, page, chunkId, false, {
          contentVersion,
          offset: anchor?.offset,
          quote: anchor?.quote,
          chunkIndex,
        })
        return
      }
      if (name === "openIllust" && payload?.illustId) {
        nav.push({ name: "illust", id: Number(payload.illustId) })
        return
      }
      if (name === "jumpToPage" && payload?.page) {
        setCurrentPage(Number(payload.page))
        return
      }
      if (name === "openLink" && payload?.url) {
        void ScriptingSafari.openURL(String(payload.url))
        return
      }
      if (name === "onSeriesNav" && payload?.id) {
        void openSeriesEpisode(Number(payload.id))
      }
    },
    [chunks, contentVersion, nav, openSeriesEpisode, props.novelId],
  )

  const toggleNovelMarker = useCallback(async () => {
    try {
      triggerHaptic("light")
      if (markerPage === currentPage) {
        await session.call((tk) => deleteNovelMarker(props.novelId, tk))
        setMarkerPage(null)
        overlay.showToast("已移除云端书签", "info")
      } else {
        await session.call((tk) => addNovelMarker(props.novelId, currentPage, tk))
        setMarkerPage(currentPage)
        overlay.showToast(`已标记书签：第 ${currentPage} 页`, "success")
      }
    } catch (err: any) {
      overlay.showToast(`书签操作失败：${err?.message ?? err}`, "error")
    }
  }, [currentPage, markerPage, overlay, props.novelId])

  const saveOffline = useCallback(async () => {
    try {
      const saved = saveOfflineEpisode({
        novelId: props.novelId,
        title: props.title,
        text: props.text,
        caption: props.caption ?? null,
        coverUrl: props.coverUrl ?? null,
        seriesId: props.seriesId ?? null,
        episodeNumber: props.episodeNumber ?? null,
      })
      if (!saved) {
        overlay.showToast("离线保存失败", "error")
        return
      }
      setIsOfflineSaved(true)
      const tasks = await buildOfflineImageTasks({
        chunks,
        embeddedImages: props.textEmbeddedImages,
        resolveIllustUrl: async (illustId, pageIdx) => {
          try {
            const illust = await session.call((tk) => illustrationDetail(illustId, tk))
            return imageUrlOf(illust, pageIdx, "large") || imageUrlOf(illust, pageIdx, "medium") || null
          } catch {
            return null
          }
        },
      })
      if (tasks.length === 0) {
        overlay.showToast("已保存到离线书库", "success")
        return
      }
      overlay.showToast(`正文已离线，正在保存 ${tasks.length} 张插图…`, "info")
      const summary = await persistOfflineImages({
        novelId: props.novelId,
        tasks,
        loadBytes: (url) => loadImage(url, 40),
      })
      overlay.showToast(
        `已离线保存 · ${offlineImageSummaryText(summary)}`,
        summary.failed > 0 || summary.missing > 0 ? "info" : "success",
      )
    } catch (err: any) {
      overlay.showToast(`离线保存失败：${err?.message ?? err}`, "error")
    }
  }, [chunks, overlay, props])

  const handleExportMenu = useCallback(async () => {
    const trSnap = translationRef.current
    const canExportTr = !novelTranslationExportIssue(trSnap, false)
    const actions = [
      { label: "导出原文 EPUB" },
      { label: "导出原文 TXT" },
      ...(canExportTr
        ? [{ label: "导出译文 EPUB" }, { label: "导出双语对照 EPUB" }, { label: "导出译文 TXT" }]
        : []),
      { label: isOfflineSaved ? "更新离线缓存" : "保存到离线书库" },
    ]
    const picked = await overlay.presentActionSheet({
      title: "导出与离线",
      actions,
    })
    if (picked == null) return
    const chosen = actions[picked]?.label
    if (!chosen) return

    if (chosen.includes("离线")) {
      await saveOffline()
      return
    }

    try {
      let exportText = props.text
      let exportTitle = props.title
      if (chosen.includes("译文")) {
        const trSrc = buildTranslatedNovelSource(chunks, trSnap)
        if (!trSrc) {
          overlay.showToast("请先完成全文翻译后再导出译文", "error")
          return
        }
        exportText = trSrc
        if (trSnap?.translatedTitle) exportTitle = trSnap.translatedTitle
      } else if (chosen.includes("双语")) {
        const biSrc = buildBilingualNovelSource(chunks, trSnap)
        if (!biSrc) {
          overlay.showToast("请先完成全文翻译后再导出双语版", "error")
          return
        }
        exportText = biSrc
        if (trSnap?.translatedTitle) exportTitle = `${trSnap.translatedTitle}（双语）`
      }

      if (chosen.includes("TXT")) {
        const doc = buildNovelPlainTextDocument({
          title: exportTitle,
          author: "",
          caption: props.caption,
          text: exportText,
          sourceUrl: `https://www.pixiv.net/novel/show.php?id=${props.novelId}`,
        })
        const outPath = exportNovelToText({
          title: exportTitle,
          author: "Pixiv",
          content: doc,
        })
        if (outPath) {
          overlay.showToast("TXT 已导出，正在打开分享", "success")
          await ScriptingShareSheet.present([outPath])
        } else {
          overlay.showToast("TXT 导出失败", "error")
        }
        return
      }

      overlay.showToast("正在生成 EPUB…", "info")
      const embeddedMap: Record<string, string> = {}
      if (props.textEmbeddedImages) {
        for (const [k, v] of Object.entries(props.textEmbeddedImages)) {
          const u = uploadedImageUrl(v)
          if (u) embeddedMap[k] = u
        }
      }
      const epubPath = await exportNovelToEpub({
        id: props.novelId,
        title: exportTitle,
        author: "Pixiv",
        seriesTitle: props.seriesTitle ?? undefined,
        description: props.caption,
        coverUrl: props.coverUrl ?? undefined,
        chapters: [
          {
            id: props.novelId,
            title: exportTitle,
            text: exportText,
            images: Object.keys(embeddedMap).length > 0 ? embeddedMap : undefined,
            caption: props.caption,
          },
        ],
      })
      if (epubPath) {
        overlay.showToast("EPUB 已生成，正在打开分享", "success")
        await ScriptingShareSheet.present([epubPath])
      } else {
        overlay.showToast("EPUB 生成失败", "error")
      }
    } catch (err: any) {
      overlay.showToast(`导出失败：${err?.message ?? err}`, "error")
    }
  }, [chunks, isOfflineSaved, overlay, props, saveOffline])

  const openOutlineSearch = useCallback(
    (initialTab: "outline" | "search") => {
      overlay.presentSheet({
        title: "目录与全文检索",
        fullHeight: true,
        render: (close) => (
          <NovelOutlineSearchSheet
            novelId={props.novelId}
            chunks={chunks}
            contentVersion={contentVersion}
            translation={translation.snapshot}
            currentChunkIndex={currentChunkIdxRef.current}
            currentPage={currentPage}
            initialTab={initialTab}
            onJump={handleJumpToAnchor}
            onClose={close}
          />
        ),
      })
    },
    [chunks, contentVersion, currentPage, handleJumpToAnchor, overlay, props.novelId, translation.snapshot],
  )

  const openTypography = useCallback(() => {
    overlay.presentSheet({
      title: "阅读器排版",
      render: () => (
        <NovelTypographySheet
          initialTheme={readerTheme}
          onChangeSettings={setReaderSettings}
          onChangeTheme={handleThemeChange}
        />
      ),
    })
  }, [handleThemeChange, overlay, readerTheme])

  const openTranslation = useCallback(() => {
    overlay.presentSheet({
      title: "AI 翻译",
      fullHeight: true,
      render: (close) => (
        <NovelTranslationSheet
          novelId={props.novelId}
          title={props.title}
          caption={props.caption}
          text={props.text}
          chunks={chunks}
          seriesId={props.seriesId ?? null}
          onOpenCustomAISettings={() => nav.push({ name: "customAI" })}
          onClose={close}
        />
      ),
    })
  }, [chunks, nav, overlay, props.caption, props.novelId, props.seriesId, props.text, props.title])

  const openAISheet = useCallback(() => {
    overlay.presentSheet({
      title: "AI 导读与续写",
      fullHeight: true,
      render: (close) => (
        <NovelAISheet
          title={props.title}
          text={props.text}
          currentPage={currentPage}
          onOpenCustomAISettings={() => nav.push({ name: "customAI" })}
          onClose={close}
        />
      ),
    })
  }, [currentPage, nav, overlay, props.text, props.title])

  // Never leave the "restoring" pill on screen forever if the reloaded
  // document cannot reach readerReady; turn it into the retry card instead.
  useEffect(() => {
    if (crashNotice?.phase !== "restoring") return
    const timer = setTimeout(() => {
      setCrashNotice((prev) =>
        prev?.phase === "restoring" ? { phase: "failed", attempt: prev.attempt } : prev,
      )
    }, READER_RESTORE_NOTICE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [crashNotice])

  const rebuildReaderAfterCrash = (manual: boolean) => {
    if (manual) {
      // A user-initiated retry gets a fresh budget; automatic retries stay capped.
      crashRecoveryStateRef.current = { ...EMPTY_CRASH_RECOVERY_STATE }
    }
    const decision = shouldRebuildAfterCrash(
      { success: false, crashed: true },
      crashRecoveryStateRef.current,
      Date.now(),
    )
    if (!decision.rebuild) {
      setCrashNotice({ phase: "failed", attempt: decision.attempt })
      return
    }
    crashRecoveryStateRef.current = decision.state

    const saved = getNovelProgress(props.novelId)
    const live = lastAnchorRef.current
    const anchor = recoveryAnchorFromProgress({
      page: currentPage,
      chunkId: currentChunkIdRef.current ?? saved?.chunkId ?? null,
      offset: live?.offset ?? saved?.offset ?? 0,
      quote: live?.quote ?? saved?.quote ?? "",
    })

    // Persist synchronously before the reload: even if rebuilding fails, the
    // reader keeps the position reached before the renderer died.
    recordNovelProgress(props.novelId, anchor.page, anchor.chunkId ?? undefined, true, {
      contentVersion,
      offset: anchor.offset,
      quote: anchor.quote,
      chunkIndex: currentChunkIdxRef.current,
    })

    const nextGeneration = ++ownerGenRef.current
    let nextHtml = ""
    try {
      nextHtml = composeReaderHtml(nextGeneration, anchor)
    } catch {
      setCrashNotice({ phase: "failed", attempt: decision.attempt })
      return
    }
    setRecoveryDoc({ html: nextHtml, generation: nextGeneration })
    // onRenderProcessGone leaves the native WebView unusable; remount it.
    setWebViewEpoch((value) => value + 1)
    setCrashNotice({ phase: "restoring", attempt: decision.attempt })
  }

  const readerPalette = resolveReaderThemePalette(readerTheme, isDark)
  const displayTitle =
    translation.snapshot?.mode === "translated" && translation.snapshot.translatedTitle
      ? translation.snapshot.translatedTitle
      : props.title

  const translationBadge = translation.snapshot?.running
    ? `${translation.snapshot.done}/${translation.snapshot.total}`
    : translation.snapshot?.mode === "translated"
      ? "译文"
      : "翻译"

  return (
    <View style={[styles.root, { backgroundColor: readerPalette.bg }]}>
      <PixNativeWebView
        key={webViewEpoch}
        ref={webViewRef}
        initialHtml={activeHtml}
        htmlGeneration={activeGeneration}
        onScriptMessage={handleScriptMessage}
        onLoadComplete={(gen, success, crashed) => {
          if (crashed) {
            // Renderer death is not a user exit: rebuild the same document
            // (up to the retry budget) instead of leaving a blank WebView.
            if (gen > 0 && lastCrashGenerationRef.current === gen) return
            if (gen > 0) lastCrashGenerationRef.current = gen
            rebuildReaderAfterCrash(false)
            return
          }
          if (success) setHtmlReadyGen(gen)
        }}
        style={styles.webview}
      />

      {crashNotice?.phase === "restoring" ? (
        <View
          pointerEvents="none"
          style={[
            styles.recoveryBanner,
            {
              top: insets.top + (showHud ? 54 : 10),
              backgroundColor: colors.glassBg,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Text style={[styles.recoveryBannerText, { color: colors.textSecondary }]}>
            阅读器渲染异常，正在恢复阅读位置…
          </Text>
        </View>
      ) : null}

      {crashNotice?.phase === "failed" ? (
        <View pointerEvents="box-none" style={styles.recoveryErrorLayer}>
          <View
            style={[
              styles.recoveryErrorCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.separator,
              },
            ]}
          >
            <Text style={[styles.recoveryErrorTitle, { color: colors.text }]}>
              阅读器渲染进程已停止
            </Text>
            <Text style={[styles.recoveryErrorBody, { color: colors.textSecondary }]}>
              自动恢复失败。阅读进度已保留，重试后会回到原位置。
            </Text>
            <Pressable
              onPress={() => rebuildReaderAfterCrash(true)}
              style={({ pressed }) => [
                styles.recoveryRetryBtn,
                { backgroundColor: accent, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.recoveryRetryText}>重试恢复</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Safe-area HUD Overlay: pointerEvents="box-none" so WebView receives all body touches/scrolls */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {showHud ? (
          <>
            <View
              style={[
                styles.topBar,
                {
                  paddingTop: insets.top,
                  paddingLeft: Math.max(insets.left, 8),
                  paddingRight: Math.max(insets.right, 8),
                  backgroundColor: colors.glassBg,
                  borderBottomColor: colors.separator,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  flushNovelProgress()
                  nav.pop()
                }}
                hitSlop={10}
                style={styles.topBtn}
              >
                <Text style={[styles.topBack, { color: accent }]}>‹ 返回</Text>
              </Pressable>
              <View style={styles.topTitleWrap}>
                <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                <Text style={[styles.topSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  第 {currentPage}/{totalPages} 页 · {Math.round(scrollRatio * 100)}%
                  {readerSettings.layoutDirection === "vertical" ? " · 竖排" : ""}
                </Text>
              </View>
              <Pressable onPress={() => void toggleNovelMarker()} hitSlop={8} style={styles.topBtn}>
                <Text
                  style={[
                    styles.topActionText,
                    { color: markerPage === currentPage ? accent : colors.textSecondary },
                  ]}
                >
                  {markerPage === currentPage ? "★ 已签" : "☆ 书签"}
                </Text>
              </Pressable>
            </View>

            <View
              style={[
                styles.bottomBar,
                {
                  paddingBottom: Math.max(effectiveBottomInset(insets), 10),
                  paddingLeft: Math.max(insets.left, 10),
                  paddingRight: Math.max(insets.right, 10),
                  backgroundColor: colors.glassBg,
                  borderTopColor: colors.separator,
                },
              ]}
            >
              {props.seriesPrev || props.seriesNext ? (
                <View style={[styles.seriesStrip, { borderBottomColor: colors.separator }]}>
                  <Pressable
                    disabled={!props.seriesPrev || navigatingEpisode}
                    onPress={() => props.seriesPrev && void openSeriesEpisode(props.seriesPrev.id)}
                    style={[styles.seriesBtn, !props.seriesPrev && { opacity: 0.35 }]}
                  >
                    <Text style={[styles.seriesBtnText, { color: colors.text }]} numberOfLines={1}>
                      ‹ 上一话
                    </Text>
                  </Pressable>
                  <Text style={[styles.seriesLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                    {props.seriesTitle || "系列"}
                    {props.episodeNumber ? ` #${props.episodeNumber}` : ""}
                  </Text>
                  <Pressable
                    disabled={!props.seriesNext || navigatingEpisode}
                    onPress={() => props.seriesNext && void openSeriesEpisode(props.seriesNext.id)}
                    style={[styles.seriesBtn, !props.seriesNext && { opacity: 0.35 }]}
                  >
                    <Text style={[styles.seriesBtnText, { color: colors.text }]} numberOfLines={1}>
                      下一话 ›
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.hudRow}>
                <HudButton
                  icon="☰"
                  label="目录"
                  color={colors.text}
                  onPress={() => openOutlineSearch("outline")}
                />
                <HudButton
                  icon="⌕"
                  label="搜索"
                  color={colors.text}
                  onPress={() => openOutlineSearch("search")}
                />
                <HudButton
                  icon="译"
                  label={translationBadge}
                  color={translation.snapshot?.mode === "translated" ? accent : colors.text}
                  onPress={openTranslation}
                />
                <HudButton
                  icon="Aa"
                  label="排版"
                  color={colors.text}
                  onPress={openTypography}
                />
                <HudButton
                  icon="✦"
                  label="AI"
                  color={colors.text}
                  onPress={openAISheet}
                />
                <HudButton
                  icon="↗"
                  label="导出"
                  color={colors.text}
                  onPress={() => void handleExportMenu()}
                />
              </View>
            </View>
          </>
        ) : null}
      </View>
    </View>
  )
}

function HudButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string
  label: string
  color: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.hudBtn, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.hudIcon, { color }]}>{icon}</Text>
      <Text style={[styles.hudLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  topBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topBack: {
    fontSize: 16,
    fontWeight: "600",
  },
  topTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  topTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  topSub: {
    fontSize: 11,
    marginTop: 1,
  },
  topActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  seriesStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seriesBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  seriesBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  seriesLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
  },
  hudRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  hudBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 2,
  },
  hudIcon: {
    fontSize: 16,
    fontWeight: "700",
  },
  hudLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  recoveryBanner: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "86%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recoveryBannerText: {
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  recoveryErrorLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  recoveryErrorCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 8,
  },
  recoveryErrorTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  recoveryErrorBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryRetryBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  recoveryRetryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
})
