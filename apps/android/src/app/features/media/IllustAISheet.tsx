import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"
import {
  cleanHtmlCaption,
  cleanOCRDisplayMarkdown,
  isAIAvailable,
  streamGenerateTranslatedImage,
  streamTranslateText,
  streamVisionTranslateImage,
  type OCRBubble,
} from "../../../../../../Pix-Scripting/src/api/aiService"
import { saveImageToPixivAlbum } from "../../../../../../Pix-Scripting/src/downloader/photoAlbum"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import type { PixivIllustration } from "../../../../../../Pix-Scripting/src/types"
import { ScriptingData } from "../../../scripting/dataAndCrypto"
import { recordDiagnosticError } from "../../../scripting/diagnostics"
import {
  ScriptingFileManager,
  ScriptingImageRenderer,
} from "../../../scripting/hostGlobals"
import { PolyfillAbortController } from "../../../scripting/polyfills"
import { ActionButton, SegmentedControl } from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"
import { computeContainedRect, computeStageAspectRatio, mapBubbleBoxToRect } from "./ocrLayout"
import { copyToClipboard, getIllustPageCount, shareItems, toFileUri } from "./mediaHelpers"

const { PixImageMedia } = NativeModules

function recordAIError(err: any, fallbackCode: string): void {
  if (err?.name === "AbortError") return
  recordDiagnosticError({
    kind: "ai",
    code: err?.code || err?.name || fallbackCode,
    message: err?.message ?? String(err),
  })
}

export type IllustAIMode = "caption" | "ocr" | "imageGen"

export interface IllustAISheetProps {
  illust: PixivIllustration
  initialMode?: IllustAIMode
  initialPage?: number
  onClose: () => void
}

export function IllustAISheet({
  illust,
  initialMode = "caption",
  initialPage = 0,
  onClose,
}: IllustAISheetProps) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const pageCount = getIllustPageCount(illust)
  const [mode, setMode] = useState<IllustAIMode>(initialMode)
  const [pageIndex, setPageIndex] = useState<number>(Math.max(0, Math.min(pageCount - 1, initialPage)))

  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Caption translation
  const [captionResult, setCaptionResult] = useState("")

  // Manga OCR
  const [ocrText, setOcrText] = useState("")
  const [ocrImagePath, setOcrImagePath] = useState<string | null>(null)
  const [ocrBubbles, setOcrBubbles] = useState<OCRBubble[]>([])
  const [showOverlay, setShowOverlay] = useState(true)
  const [fontScale, setFontScale] = useState(1.0)
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(() => new Set())
  const [exportingOcr, setExportingOcr] = useState(false)
  const [imageBox, setImageBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: Math.max(1, illust.width || 1),
    height: Math.max(1, illust.height || 1),
  })

  // ImageGen translation
  const [genStatus, setGenStatus] = useState("")
  const [genImage, setGenImage] = useState<{ base64: string; mediaType: string } | null>(null)
  const [savingGen, setSavingGen] = useState(false)

  const abortRef = useRef<PolyfillAbortController | null>(null)
  const cleanCaption = useMemo(() => cleanHtmlCaption(illust.caption), [illust.caption])

  const abortRunning = useCallback(() => {
    // PolyfillAbortController 的 signal 暴露 onAbort/addEventListener，
    // fetchAndHttp 依赖它调用 PixHttp.abortRequest；普通对象不会真正断开原生请求。
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // Reset per-page OCR state when switching pages
  useEffect(() => {
    setOcrBubbles([])
    setHiddenIndices(new Set())
    setOcrText("")
    setOcrImagePath(null)
    setGenImage(null)
    setGenStatus("")
    setError(null)
  }, [pageIndex])

  const runCaptionTranslate = useCallback(async () => {
    if (!cleanCaption) {
      setError("该作品暂无简介可供翻译")
      return
    }
    abortRunning()
    const ctrl = new PolyfillAbortController()
    abortRef.current = ctrl
    setRunning(true)
    setError(null)
    setCaptionResult("")
    try {
      const out = await streamTranslateText(cleanCaption, {
        signal: ctrl.signal,
        onChunk: (txt) => {
          if (!ctrl.signal.aborted) setCaptionResult(txt)
        },
      })
      if (!ctrl.signal.aborted && out) setCaptionResult(out)
    } catch (err: any) {
      if (err?.name !== "AbortError" && !ctrl.signal.aborted) {
        recordAIError(err, "AI_CAPTION_TRANSLATE_FAILED")
        setError(err?.message ?? "翻译失败")
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setRunning(false)
      }
    }
  }, [abortRunning, cleanCaption])

  const runOcrAnalyze = useCallback(async () => {
    abortRunning()
    const ctrl = new PolyfillAbortController()
    abortRef.current = ctrl
    setRunning(true)
    setError(null)
    setOcrText("")
    setOcrBubbles([])
    setHiddenIndices(new Set())
    try {
      const out = await streamVisionTranslateImage(illust, pageIndex, {
        signal: ctrl.signal,
        onChunk: (txt) => {
          if (!ctrl.signal.aborted) setOcrText(txt)
        },
        onImageReady: (filePath) => {
          if (!ctrl.signal.aborted) setOcrImagePath(filePath)
        },
        onBubblesParsed: (bubbles) => {
          if (!ctrl.signal.aborted) setOcrBubbles(bubbles)
        },
      })
      if (!ctrl.signal.aborted && out) setOcrText(out)
    } catch (err: any) {
      if (err?.name !== "AbortError" && !ctrl.signal.aborted) {
        recordAIError(err, "AI_OCR_FAILED")
        setError(err?.message ?? "漫画气泡识别失败")
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setRunning(false)
      }
    }
  }, [abortRunning, illust, pageIndex])

  const runImageGenTranslate = useCallback(async () => {
    abortRunning()
    const ctrl = new PolyfillAbortController()
    abortRef.current = ctrl
    setRunning(true)
    setError(null)
    setGenStatus("正在发送图片到多模态生图模型…")
    setGenImage(null)
    try {
      await streamGenerateTranslatedImage(illust, pageIndex, {
        signal: ctrl.signal,
        onChunk: (txt) => {
          if (!ctrl.signal.aborted) setGenStatus(txt)
        },
        onImageGenerated: (img) => {
          if (!ctrl.signal.aborted) setGenImage(img)
        },
      })
    } catch (err: any) {
      if (err?.name !== "AbortError" && !ctrl.signal.aborted) {
        recordAIError(err, "AI_IMAGE_GEN_FAILED")
        setError(err?.message ?? "重绘汉化失败")
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setRunning(false)
      }
    }
  }, [abortRunning, illust, pageIndex])

  const toggleBubbleVisibility = useCallback((idx: number) => {
    try {
      triggerHaptic("selection")
    } catch {}
    setHiddenIndices((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const renderOcrOutputBase64 = useCallback(async (): Promise<string | null> => {
    if (!ocrImagePath) return null
    const visibleBubbles = showOverlay
      ? ocrBubbles.filter((_, idx) => !hiddenIndices.has(idx))
      : []

    if (PixImageMedia?.renderOCRImage) {
      const b64 = await PixImageMedia.renderOCRImage(
        ocrImagePath,
        JSON.stringify(visibleBubbles),
        fontScale,
        "jpeg",
      )
      return b64 || null
    }

    // Fallback through ScriptingImageRenderer descriptor
    const data = await ScriptingImageRenderer.toJPEGData({
      props: {
        __ocrRenderDescriptor: {
          kind: "ocr",
          filePath: ocrImagePath,
          bubbles: ocrBubbles,
          showOverlay,
          hiddenIndices,
          scale: fontScale,
        },
      },
    })
    return data ? data.toBase64String() : null
  }, [fontScale, hiddenIndices, ocrBubbles, ocrImagePath, showOverlay])

  const handleExportOcrImage = useCallback(
    async (action: "save" | "share") => {
      if (exportingOcr || !ocrImagePath) return
      setExportingOcr(true)
      try {
        const b64 = await renderOcrOutputBase64()
        if (!b64) {
          overlay.showToast("生成汉化渲染图失败", "error")
          return
        }
        const data = ScriptingData.fromBase64String(b64)
        if (!data) {
          overlay.showToast("图像数据解码失败", "error")
          return
        }
        const fileName = `pixiv_${illust.id}_p${pageIndex + 1}_ocr.jpg`
        if (action === "save") {
          const ok = await saveImageToPixivAlbum(data, fileName)
          overlay.showToast(ok ? "已保存汉化图片至相册" : "保存相册失败", ok ? "success" : "error")
        } else {
          const tmpPath = `${ScriptingFileManager.temporaryDirectory}/${fileName}`
          ScriptingFileManager.writeAsDataSync(tmpPath, data)
          await shareItems([tmpPath])
        }
      } catch (err: any) {
        overlay.showToast(err?.message ?? "导出失败", "error")
      } finally {
        setExportingOcr(false)
      }
    },
    [exportingOcr, illust.id, ocrImagePath, overlay, pageIndex, renderOcrOutputBase64],
  )

  const handleExportGenImage = useCallback(
    async (action: "save" | "share") => {
      if (savingGen || !genImage) return
      setSavingGen(true)
      try {
        const data = ScriptingData.fromBase64String(genImage.base64)
        if (!data) {
          overlay.showToast("图片数据无效", "error")
          return
        }
        const ext = genImage.mediaType.includes("png") ? "png" : "jpg"
        const fileName = `pixiv_${illust.id}_p${pageIndex + 1}_translated.${ext}`
        if (action === "save") {
          const ok = await saveImageToPixivAlbum(data, fileName)
          overlay.showToast(ok ? "已保存汉化生图至相册" : "保存失败", ok ? "success" : "error")
        } else {
          const tmpPath = `${ScriptingFileManager.temporaryDirectory}/${fileName}`
          ScriptingFileManager.writeAsDataSync(tmpPath, data)
          await shareItems([tmpPath])
        }
      } catch (err: any) {
        overlay.showToast(err?.message ?? "保存失败", "error")
      } finally {
        setSavingGen(false)
      }
    },
    [genImage, illust.id, overlay, pageIndex, savingGen],
  )

  const handleImageBoxLayout = useCallback((evt: LayoutChangeEvent) => {
    const { width, height } = evt.nativeEvent.layout
    setImageBox({ width, height })
  }, [])

  const stageAspectRatio = computeStageAspectRatio(naturalSize)
  // 气泡与预览共用同一套 contain 绘制几何，长条漫两侧留白不再导致坐标错位。
  const ocrDrawRect = computeContainedRect(imageBox, naturalSize)
  const cleanedOcrMarkdown = useMemo(() => cleanOCRDisplayMarkdown(ocrText), [ocrText])
  const aiConfigured = isAIAvailable()

  return (
    <ScrollView
      style={styles.root}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 24 },
      ]}
    >
      <SegmentedControl
        value={mode}
        onChange={(next) => {
          abortRunning()
          setError(null)
          setMode(next)
        }}
        options={[
          { value: "caption", label: "简介翻译" },
          { value: "ocr", label: "气泡 OCR" },
          { value: "imageGen", label: "视觉重绘" },
        ]}
      />

      {!aiConfigured ? (
        <View style={[styles.noticeCard, { backgroundColor: colors.fill, borderColor: colors.glassBorder }]}>
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            尚未配置自定义 AI 模型。前往「设置 → 自定义 AI」配置后即可使用翻译与漫画汉化功能。
          </Text>
          <ActionButton
            title="去配置 AI 模型"
            variant="secondary"
            onPress={() => {
              onClose()
              nav.push({ name: "customAI" })
            }}
          />
        </View>
      ) : null}

      {pageCount > 1 && mode !== "caption" ? (
        <View style={styles.pagePickerRow}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>目标页码</Text>
          <View style={styles.pageStepper}>
            <Pressable
              disabled={pageIndex <= 0 || running}
              onPress={() => setPageIndex((p) => Math.max(0, p - 1))}
              style={[styles.stepBtn, { backgroundColor: colors.fill, opacity: pageIndex <= 0 ? 0.4 : 1 }]}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>‹</Text>
            </Pressable>
            <Text style={[styles.pageText, { color: colors.text }]}>
              第 {pageIndex + 1} / {pageCount} 页
            </Text>
            <Pressable
              disabled={pageIndex >= pageCount - 1 || running}
              onPress={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              style={[
                styles.stepBtn,
                { backgroundColor: colors.fill, opacity: pageIndex >= pageCount - 1 ? 0.4 : 1 },
              ]}
            >
              <Text style={[styles.stepBtnText, { color: colors.text }]}>›</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: `${colors.danger}18`, borderColor: colors.danger }]}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}

      {/* MODE 1: CAPTION TRANSLATION */}
      {mode === "caption" ? (
        <View style={styles.section}>
          <View style={[styles.textCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.glassBorder }]}>
            <Text style={[styles.cardHeader, { color: colors.textSecondary }]}>原文简介</Text>
            <Text style={[styles.bodyText, { color: colors.text }]}>
              {cleanCaption || "（该作品没有简介）"}
            </Text>
          </View>

          <View style={styles.btnRow}>
            <ActionButton
              title={running ? "停止翻译" : captionResult ? "重新翻译" : "开始 AI 翻译"}
              variant={running ? "danger" : "primary"}
              disabled={!cleanCaption}
              onPress={() => (running ? abortRunning() : void runCaptionTranslate())}
              style={styles.flexBtn}
            />
            {captionResult ? (
              <ActionButton
                title="复制译文"
                variant="secondary"
                onPress={() => {
                  void copyToClipboard(captionResult)
                  overlay.showToast("译文已复制", "success")
                }}
              />
            ) : null}
          </View>

          {captionResult || running ? (
            <View style={[styles.textCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardHeader, { color: accent }]}>中文译文</Text>
                {running ? <ActivityIndicator size="small" color={accent} /> : null}
              </View>
              <Text selectable={true} style={[styles.bodyText, { color: colors.text }]}>
                {captionResult || "正在思考与翻译…"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* MODE 2: MANGA OCR BUBBLE ANALYSIS */}
      {mode === "ocr" ? (
        <View style={styles.section}>
          <View style={styles.btnRow}>
            <ActionButton
              title={running ? "停止识别" : ocrBubbles.length > 0 ? "重新识别气泡" : "开始识别与气泡翻译"}
              variant={running ? "danger" : "primary"}
              onPress={() => (running ? abortRunning() : void runOcrAnalyze())}
              style={styles.flexBtn}
            />
          </View>

          {ocrImagePath ? (
            <View style={[styles.ocrCanvasWrap, { borderColor: colors.glassBorder }]}>
              <View
                style={[styles.ocrStage, { aspectRatio: stageAspectRatio }]}
                onLayout={handleImageBoxLayout}
              >
                <Image
                  source={{ uri: toFileUri(ocrImagePath) || undefined }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  onLoad={(evt) => {
                    const src = evt?.nativeEvent?.source
                    if (src?.width && src?.height) {
                      setNaturalSize({ width: src.width, height: src.height })
                    }
                  }}
                />
                {showOverlay && ocrDrawRect.width > 0 && ocrDrawRect.height > 0
                  ? ocrBubbles.map((bubble, idx) => {
                      if (hiddenIndices.has(idx)) return null
                      const mapped = mapBubbleBoxToRect(bubble.box_2d, ocrDrawRect)
                      if (!mapped) return null
                      const { left, top, width, height } = mapped
                      const isTransparent = bubble.shape === "transparent"
                      const radius =
                        bubble.shape === "ellipse"
                          ? Math.min(width, height) / 2
                          : bubble.shape === "rectangle"
                            ? 3
                            : 8
                      const baseFont = Math.max(9, Math.min(18, Math.sqrt((width * height) / Math.max(1, bubble.translation.length)) * 0.72))
                      const computedFont = Math.max(8, Math.min(24, baseFont * fontScale))

                      return (
                        <Pressable
                          key={idx}
                          onPress={() => toggleBubbleVisibility(idx)}
                          style={[
                            styles.bubbleOverlay,
                            {
                              left,
                              top,
                              width,
                              height,
                              borderRadius: radius,
                              backgroundColor: isTransparent
                                ? "rgba(0,0,0,0.68)"
                                : "rgba(255,255,255,0.95)",
                              borderColor: isTransparent ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.22)",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.bubbleText,
                              {
                                fontSize: computedFont,
                                lineHeight: computedFont * 1.22,
                                color: isTransparent ? "#FFFFFF" : "#111827",
                              },
                            ]}
                          >
                            {bubble.translation}
                          </Text>
                        </Pressable>
                      )
                    })
                  : null}
              </View>

              {/* Overlay controls */}
              <View style={[styles.ocrToolbar, { backgroundColor: colors.surface, borderTopColor: colors.separator }]}>
                <Pressable
                  onPress={() => setShowOverlay((v) => !v)}
                  style={[
                    styles.toolChip,
                    { backgroundColor: showOverlay ? accentSoft : colors.fill },
                  ]}
                >
                  <Text style={[styles.toolChipText, { color: showOverlay ? accent : colors.text }]}>
                    {showOverlay ? "隐藏遮罩" : "显示遮罩"}
                  </Text>
                </Pressable>

                <View style={styles.scaleGroup}>
                  <Pressable
                    onPress={() => setFontScale((s) => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))}
                    style={[styles.scaleBtn, { backgroundColor: colors.fill }]}
                  >
                    <Text style={[styles.scaleBtnText, { color: colors.text }]}>A-</Text>
                  </Pressable>
                  <Text style={[styles.scaleLabel, { color: colors.textSecondary }]}>
                    {Math.round(fontScale * 100)}%
                  </Text>
                  <Pressable
                    onPress={() => setFontScale((s) => Math.min(1.8, Math.round((s + 0.1) * 10) / 10))}
                    style={[styles.scaleBtn, { backgroundColor: colors.fill }]}
                  >
                    <Text style={[styles.scaleBtnText, { color: colors.text }]}>A+</Text>
                  </Pressable>
                </View>

                {hiddenIndices.size > 0 ? (
                  <Pressable
                    onPress={() => setHiddenIndices(new Set())}
                    style={[styles.toolChip, { backgroundColor: colors.fill }]}
                  >
                    <Text style={[styles.toolChipText, { color: colors.textSecondary }]}>
                      恢复全部
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {ocrBubbles.length > 0 ? (
                <View style={[styles.ocrExportRow, { backgroundColor: colors.surface, borderTopColor: colors.separator }]}>
                  <ActionButton
                    title="保存汉化图至相册"
                    loading={exportingOcr}
                    onPress={() => void handleExportOcrImage("save")}
                    style={styles.flexBtn}
                  />
                  <ActionButton
                    title="分享图片"
                    variant="secondary"
                    disabled={exportingOcr}
                    onPress={() => void handleExportOcrImage("share")}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {ocrBubbles.length > 0 ? (
            <View style={[styles.textCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
              <Text style={[styles.cardHeader, { color: colors.textSecondary }]}>
                识别到 {ocrBubbles.length} 个气泡（点击可单独开关遮罩）
              </Text>
              {ocrBubbles.map((b, idx) => {
                const isHidden = hiddenIndices.has(idx)
                return (
                  <Pressable
                    key={idx}
                    onPress={() => toggleBubbleVisibility(idx)}
                    style={[
                      styles.bubbleListItem,
                      {
                        borderTopColor: colors.separator,
                        opacity: isHidden ? 0.45 : 1,
                      },
                    ]}
                  >
                    <View style={styles.bubbleListHeader}>
                      <Text style={[styles.bubbleIndex, { color: accent }]}>#{idx + 1}</Text>
                      <Text style={[styles.bubbleToggleLabel, { color: colors.textTertiary }]}>
                        {isHidden ? "已隐藏" : "显示中"}
                      </Text>
                    </View>
                    {b.original ? (
                      <Text style={[styles.bubbleOrig, { color: colors.textSecondary }]}>{b.original}</Text>
                    ) : null}
                    <Text style={[styles.bubbleTrans, { color: colors.text }]}>{b.translation}</Text>
                  </Pressable>
                )
              })}
            </View>
          ) : cleanedOcrMarkdown || running ? (
            <View style={[styles.textCard, { backgroundColor: colors.surface, borderColor: colors.glassBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardHeader, { color: accent }]}>识别输出</Text>
                {running ? <ActivityIndicator size="small" color={accent} /> : null}
              </View>
              <Text selectable={true} style={[styles.bodyText, { color: colors.text }]}>
                {cleanedOcrMarkdown || "正在解析画面对话气泡…"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* MODE 3: VISION IMAGE TRANSLATION (IMAGE-GEN) */}
      {mode === "imageGen" ? (
        <View style={styles.section}>
          <View style={styles.btnRow}>
            <ActionButton
              title={running ? "停止生成" : genImage ? "重新生成汉化图" : "开始视觉重绘汉化"}
              variant={running ? "danger" : "primary"}
              onPress={() => (running ? abortRunning() : void runImageGenTranslate())}
              style={styles.flexBtn}
            />
          </View>

          {genStatus || running ? (
            <View style={[styles.textCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.glassBorder }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardHeader, { color: colors.textSecondary }]}>生成状态</Text>
                {running ? <ActivityIndicator size="small" color={accent} /> : null}
              </View>
              <Text style={[styles.bodyText, { color: colors.text }]}>
                {genStatus || "正在等待生图模型返回…"}
              </Text>
            </View>
          ) : null}

          {genImage ? (
            <View style={[styles.ocrCanvasWrap, { borderColor: colors.glassBorder }]}>
              <View style={[styles.ocrStage, { aspectRatio: stageAspectRatio }]}>
                <Image
                  source={{ uri: `data:${genImage.mediaType};base64,${genImage.base64}` }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
              </View>
              <View style={[styles.ocrExportRow, { backgroundColor: colors.surface, borderTopColor: colors.separator }]}>
                <ActionButton
                  title="保存至相册"
                  loading={savingGen}
                  onPress={() => void handleExportGenImage("save")}
                  style={styles.flexBtn}
                />
                <ActionButton
                  title="分享"
                  variant="secondary"
                  disabled={savingGen}
                  onPress={() => void handleExportGenImage("share")}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 12,
  },
  section: {
    gap: 12,
  },
  noticeCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
  },
  pagePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  pageStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 22,
  },
  pageText: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  errorBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flexBtn: {
    flex: 1,
  },
  textCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 6,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: "700",
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 21,
  },
  ocrCanvasWrap: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  ocrStage: {
    width: "100%",
    backgroundColor: "#111111",
    position: "relative",
    overflow: "hidden",
  },
  bubbleOverlay: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 3,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bubbleText: {
    fontWeight: "600",
    textAlign: "center",
  },
  ocrToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  toolChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  toolChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  scaleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scaleBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  scaleBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  scaleLabel: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 38,
    textAlign: "center",
  },
  ocrExportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bubbleListItem: {
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  bubbleListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bubbleIndex: {
    fontSize: 12,
    fontWeight: "700",
  },
  bubbleToggleLabel: {
    fontSize: 11,
  },
  bubbleOrig: {
    fontSize: 12,
    lineHeight: 17,
  },
  bubbleTrans: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
})
