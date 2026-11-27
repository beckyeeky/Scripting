import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  AppState,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"
import { exportUgoiraToAlbum, exportUgoiraZip } from "../../../../../../Pix-Scripting/src/downloader/ugoiraExporter"
import { imageUrlOf, resolveIllustUnderlayUrl } from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import type { PixivIllustration } from "../../../../../../Pix-Scripting/src/types"
import {
  cachedUgoiraFrames,
  prepareUgoira,
  type UgoiraFramesResult,
} from "../../../../../../Pix-Scripting/src/ugoira/ugoira"
import { clampedAspectRatio, PixImage } from "../../components"
import { useOverlay } from "../../overlay/OverlayHost"
import { useAppTheme } from "../../theme/ThemeProvider"
import { toFileUri } from "./mediaHelpers"

export interface UgoiraPlayerProps {
  illust: PixivIllustration
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, ms) / 1000
  return `${sec.toFixed(1)}s`
}

export function UgoiraPlayer({ illust }: UgoiraPlayerProps) {
  const { colors, accent } = useAppTheme()
  const overlay = useOverlay()

  const [framesData, setFramesData] = useState<UgoiraFramesResult | null>(() =>
    cachedUgoiraFrames(illust.id),
  )
  const [loading, setLoading] = useState<boolean>(() => !cachedUgoiraFrames(illust.id))
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [frameIndex, setFrameIndex] = useState(0)
  const [appActive, setAppActive] = useState(AppState.currentState === "active")
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [retrySeq, setRetrySeq] = useState(0)

  const scrubberWidthRef = useRef(1)
  const wasPlayingBeforeScrubRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const aspectRatio = useMemo(() => {
    const w = framesData?.width || illust.width
    const h = framesData?.height || illust.height
    return clampedAspectRatio(w, h, 0.45, 2.2, 1)
  }, [framesData?.width, framesData?.height, illust.width, illust.height])

  // Track app foreground state so ugoira timer pauses in background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active")
    })
    return () => sub.remove()
  }, [])

  // Prepare ugoira frames
  useEffect(() => {
    const cached = cachedUgoiraFrames(illust.id)
    if (cached) {
      setFramesData(cached)
      setLoading(false)
      setError(null)
      setFrameIndex(0)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setFrameIndex(0)

    void prepareUgoira(illust.id, {
      get isCancelled() {
        return cancelled
      },
      async checkOrWait() {
        if (cancelled) throw new Error("已取消")
      },
    })
      .then((res) => {
        if (cancelled) return
        setFramesData(res)
        setLoading(false)
      })
      .catch((err: any) => {
        if (cancelled) return
        setError(err?.message ?? "动图加载失败")
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [illust.id, retrySeq])

  // Exact frame.delay ms playback loop
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!framesData || framesData.frames.length <= 1 || !playing || !appActive) {
      return
    }

    const current = framesData.frames[frameIndex] ?? framesData.frames[0]
    const delay = Math.max(16, Number(current?.delay) || 50)
    timerRef.current = setTimeout(() => {
      setFrameIndex((prev) => (prev + 1) % framesData.frames.length)
    }, delay)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [framesData, frameIndex, playing, appActive])

  const frameCount = framesData?.frames.length ?? 0
  const safeFrameIdx = frameCount > 0 ? Math.min(frameIndex, frameCount - 1) : 0

  const elapsedMs = useMemo(() => {
    if (!framesData || frameCount === 0) return 0
    let sum = 0
    for (let i = 0; i < safeFrameIdx; i++) {
      sum += framesData.frames[i]?.delay || 0
    }
    return sum
  }, [framesData, frameCount, safeFrameIdx])

  const currentFrameUri = useMemo(() => {
    if (!framesData || frameCount === 0) return null
    const file = framesData.frames[safeFrameIdx]?.file
    if (!file) return null
    return toFileUri(`${framesData.framesDir}/${file}`)
  }, [framesData, frameCount, safeFrameIdx])

  const seekByLocationX = useCallback(
    (locX: number) => {
      if (frameCount <= 1) return
      const ratio = Math.max(0, Math.min(1, locX / Math.max(1, scrubberWidthRef.current)))
      const targetIdx = Math.round(ratio * (frameCount - 1))
      setFrameIndex(targetIdx)
    },
    [frameCount],
  )

  const scrubberResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => frameCount > 1,
        onMoveShouldSetPanResponder: () => frameCount > 1,
        onPanResponderGrant: (evt) => {
          wasPlayingBeforeScrubRef.current = playing
          setPlaying(false)
          seekByLocationX(evt.nativeEvent.locationX)
        },
        onPanResponderMove: (evt) => {
          seekByLocationX(evt.nativeEvent.locationX)
        },
        onPanResponderRelease: () => {
          if (wasPlayingBeforeScrubRef.current) {
            setPlaying(true)
          }
        },
        onPanResponderTerminate: () => {
          if (wasPlayingBeforeScrubRef.current) {
            setPlaying(true)
          }
        },
      }),
    [frameCount, playing, seekByLocationX],
  )

  const handleScrubberLayout = useCallback((evt: LayoutChangeEvent) => {
    scrubberWidthRef.current = Math.max(1, evt.nativeEvent.layout.width)
  }, [])

  const runExport = useCallback(
    async (kind: "mp4" | "gif" | "zip") => {
      if (exportStatus) return
      try {
        triggerHaptic("light")
      } catch {}
      setExportStatus(kind === "mp4" ? "正在合成 MP4…" : kind === "gif" ? "正在合成 GIF…" : "正在打包 ZIP…")
      try {
        const res =
          kind === "zip"
            ? await exportUgoiraZip(illust, (msg) => setExportStatus(msg))
            : await exportUgoiraToAlbum(illust, (msg) => setExportStatus(msg), kind)
        if (res.success) {
          try {
            triggerHaptic("success")
          } catch {}
          overlay.showToast(
            kind === "zip" ? "动图原始 ZIP 已保存至下载目录" : `已导出 ${kind.toUpperCase()} 至系统相册`,
            "success",
          )
        } else {
          overlay.showToast(res.error || "导出失败", "error")
        }
      } catch (err: any) {
        overlay.showToast(err?.message ?? "导出异常", "error")
      } finally {
        setExportStatus(null)
      }
    },
    [exportStatus, illust, overlay],
  )

  const coverUrl = imageUrlOf(illust, 0, "large")
  const previewUrl = resolveIllustUnderlayUrl(illust, 0)
  const progressRatio = frameCount > 1 ? safeFrameIdx / (frameCount - 1) : 0

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface }]}>
      <Pressable
        onPress={() => {
          if (!framesData) return
          try {
            triggerHaptic("selection")
          } catch {}
          setPlaying((p) => !p)
        }}
        style={[styles.stage, { aspectRatio, backgroundColor: colors.fill }]}
      >
        {currentFrameUri ? (
          <Image
            source={{ uri: currentFrameUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            fadeDuration={0}
          />
        ) : (
          <PixImage
            url={coverUrl}
            previewUrl={previewUrl}
            resizeMode="contain"
            style={StyleSheet.absoluteFill}
          />
        )}

        <View style={styles.badgeTopLeft} pointerEvents="none">
          <Text style={styles.badgeText}>UGOIRA</Text>
        </View>

        {loading ? (
          <View style={styles.overlayCenter}>
            <View style={styles.loadingPill}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.loadingText}>正在解压动图帧…</Text>
            </View>
          </View>
        ) : null}

        {error && !framesData ? (
          <View style={styles.overlayCenter}>
            <Pressable
              onPress={() => setRetrySeq((s) => s + 1)}
              style={[styles.errorPill, { backgroundColor: colors.danger }]}
            >
              <Text style={styles.loadingText}>{error} · 点击重试</Text>
            </Pressable>
          </View>
        ) : null}

        {framesData && !playing ? (
          <View style={styles.overlayCenter} pointerEvents="none">
            <View style={styles.pausedCircle}>
              <Text style={styles.pausedGlyph}>▶</Text>
            </View>
          </View>
        ) : null}
      </Pressable>

      {/* Controls + Scrubber */}
      <View style={[styles.controls, { borderTopColor: colors.separator }]}>
        <View style={styles.scrubberRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? "暂停动图" : "播放动图"}
            disabled={!framesData}
            onPress={() => {
              try {
                triggerHaptic("selection")
              } catch {}
              setPlaying((p) => !p)
            }}
            style={[styles.playBtn, { backgroundColor: accent, opacity: framesData ? 1 : 0.45 }]}
          >
            <Text style={styles.playBtnText}>{playing ? "❚❚" : "▶"}</Text>
          </Pressable>

          <View
            style={styles.scrubberHitArea}
            onLayout={handleScrubberLayout}
            {...scrubberResponder.panHandlers}
          >
            <View style={[styles.scrubberTrack, { backgroundColor: colors.fillStrong }]}>
              <View
                style={[
                  styles.scrubberFill,
                  {
                    backgroundColor: accent,
                    width: `${Math.round(progressRatio * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>

          <Text style={[styles.frameCounter, { color: colors.textSecondary }]}>
            {frameCount > 0 ? `${safeFrameIdx + 1}/${frameCount}` : "--"}
          </Text>
        </View>

        <View style={styles.exportRow}>
          <Text style={[styles.durationLabel, { color: colors.textTertiary }]}>
            {framesData
              ? `${formatDuration(elapsedMs)} / ${formatDuration(framesData.totalDurationMs)}`
              : "等待帧数据"}
          </Text>

          <View style={styles.exportBtns}>
            <Pressable
              disabled={Boolean(exportStatus)}
              onPress={() => void runExport("mp4")}
              style={[styles.exportBtn, { backgroundColor: colors.fill }]}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>存 MP4</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(exportStatus)}
              onPress={() => void runExport("gif")}
              style={[styles.exportBtn, { backgroundColor: colors.fill }]}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>存 GIF</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(exportStatus)}
              onPress={() => void runExport("zip")}
              style={[styles.exportBtn, { backgroundColor: colors.fill }]}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>原帧 ZIP</Text>
            </Pressable>
          </View>
        </View>

        {exportStatus ? (
          <View style={[styles.exportStatusBar, { backgroundColor: colors.fill }]}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={[styles.exportStatusText, { color: colors.text }]} numberOfLines={1}>
              {exportStatus}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    overflow: "hidden",
  },
  stage: {
    width: "100%",
    maxHeight: 520,
    position: "relative",
    overflow: "hidden",
  },
  badgeTopLeft: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.62)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  loadingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  errorPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  pausedCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
  },
  pausedGlyph: {
    color: "#FFFFFF",
    fontSize: 22,
    marginLeft: 3,
  },
  controls: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  scrubberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  scrubberHitArea: {
    flex: 1,
    paddingVertical: 10,
    justifyContent: "center",
  },
  scrubberTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  scrubberFill: {
    height: "100%",
    borderRadius: 3,
  },
  frameCounter: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 46,
    textAlign: "right",
  },
  exportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  durationLabel: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  exportBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  exportBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  exportStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  exportStatusText: {
    flex: 1,
    fontSize: 12,
  },
})
