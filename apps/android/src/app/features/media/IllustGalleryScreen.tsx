import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native"
import { saveImageToPixivAlbum } from "../../../../../../Pix-Scripting/src/downloader/photoAlbum"
import {
  cachedFilePath,
  imageUrlOf,
  loadImage,
  resolveIllustUnderlayUrl,
} from "../../../../../../Pix-Scripting/src/image/imageLoader"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import { getDetailImageQuality } from "../../../../../../Pix-Scripting/src/store/settings"
import type { PixivIllustration } from "../../../../../../Pix-Scripting/src/types"
import { PixImage } from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import type { CustomGalleryImage } from "../../navigation/types"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { getIllustPageCount, shareItems } from "./mediaHelpers"

interface GalleryItem {
  key: string
  url: string
  previewUrl?: string | null
  title?: string
  fileName: string
}

function touchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number {
  if (touches.length < 2) return 0
  const dx = touches[0].pageX - touches[1].pageX
  const dy = touches[0].pageY - touches[1].pageY
  return Math.sqrt(dx * dx + dy * dy)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function ZoomableGalleryPage({
  item,
  width,
  height,
  isActive,
  onToggleHud,
  onZoomChange,
}: {
  item: GalleryItem
  width: number
  height: number
  isActive: boolean
  onToggleHud: () => void
  onZoomChange: (zoomed: boolean) => void
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current
  const txAnim = useRef(new Animated.Value(0)).current
  const tyAnim = useRef(new Animated.Value(0)).current

  const scaleValRef = useRef(1)
  const txValRef = useRef(0)
  const tyValRef = useRef(0)

  const pinchStartDistRef = useRef(0)
  const pinchStartScaleRef = useRef(1)
  const panStartTxRef = useRef(0)
  const panStartTyRef = useRef(0)
  const isPinchingRef = useRef(false)

  const lastTapTimeRef = useRef(0)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clampTranslations = useCallback(
    (scale: number, tx: number, ty: number) => {
      const maxX = Math.max(0, (width * (scale - 1)) / 2)
      const maxY = Math.max(0, (height * (scale - 1)) / 2)
      return {
        x: clamp(tx, -maxX, maxX),
        y: clamp(ty, -maxY, maxY),
      }
    },
    [height, width],
  )

  const animateTo = useCallback(
    (targetScale: number, targetTx: number, targetTy: number) => {
      const clamped = clampTranslations(targetScale, targetTx, targetTy)
      scaleValRef.current = targetScale
      txValRef.current = clamped.x
      tyValRef.current = clamped.y
      onZoomChange(targetScale > 1.05)

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: targetScale,
          useNativeDriver: true,
          bounciness: 0,
          speed: 22,
        }),
        Animated.spring(txAnim, {
          toValue: clamped.x,
          useNativeDriver: true,
          bounciness: 0,
          speed: 22,
        }),
        Animated.spring(tyAnim, {
          toValue: clamped.y,
          useNativeDriver: true,
          bounciness: 0,
          speed: 22,
        }),
      ]).start()
    },
    [clampTranslations, onZoomChange, scaleAnim, txAnim, tyAnim],
  )

  // Reset zoom when leaving this page
  useEffect(() => {
    if (!isActive && scaleValRef.current > 1.01) {
      scaleValRef.current = 1
      txValRef.current = 0
      tyValRef.current = 0
      scaleAnim.setValue(1)
      txAnim.setValue(0)
      tyAnim.setValue(0)
      onZoomChange(false)
    }
  }, [isActive, onZoomChange, scaleAnim, txAnim, tyAnim])

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
    }
  }, [])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          const touches = evt.nativeEvent.touches
          // Always capture 2-finger pinch gestures
          if (touches.length >= 2) return true
          // At 1x zoom, let the parent horizontal FlatList own single-finger swipes!
          if (scaleValRef.current <= 1.05) return false
          // When zoomed, capture panning
          return Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3
        },
        onPanResponderTerminationRequest: () => scaleValRef.current <= 1.05 && !isPinchingRef.current,
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches
          if (touches.length >= 2) {
            isPinchingRef.current = true
            pinchStartDistRef.current = touchDistance(touches)
            pinchStartScaleRef.current = scaleValRef.current
            onZoomChange(true)
          } else {
            isPinchingRef.current = false
            panStartTxRef.current = txValRef.current
            panStartTyRef.current = tyValRef.current
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          const touches = evt.nativeEvent.touches
          if (touches.length >= 2) {
            if (!isPinchingRef.current) {
              isPinchingRef.current = true
              pinchStartDistRef.current = touchDistance(touches)
              pinchStartScaleRef.current = scaleValRef.current
            }
            const dist = touchDistance(touches)
            if (pinchStartDistRef.current > 10) {
              const nextScale = clamp(
                pinchStartScaleRef.current * (dist / pinchStartDistRef.current),
                1.0,
                4.5,
              )
              const clamped = clampTranslations(nextScale, txValRef.current, tyValRef.current)
              scaleValRef.current = nextScale
              txValRef.current = clamped.x
              tyValRef.current = clamped.y
              scaleAnim.setValue(nextScale)
              txAnim.setValue(clamped.x)
              tyAnim.setValue(clamped.y)
              onZoomChange(nextScale > 1.05)
            }
            return
          }

          if (scaleValRef.current > 1.05 && !isPinchingRef.current) {
            const clamped = clampTranslations(
              scaleValRef.current,
              panStartTxRef.current + gestureState.dx,
              panStartTyRef.current + gestureState.dy,
            )
            txValRef.current = clamped.x
            tyValRef.current = clamped.y
            txAnim.setValue(clamped.x)
            tyAnim.setValue(clamped.y)
          }
        },
        onPanResponderRelease: () => {
          isPinchingRef.current = false
          if (scaleValRef.current < 1.08) {
            animateTo(1, 0, 0)
          } else {
            animateTo(scaleValRef.current, txValRef.current, tyValRef.current)
          }
        },
        onPanResponderTerminate: () => {
          isPinchingRef.current = false
          if (scaleValRef.current < 1.08) {
            animateTo(1, 0, 0)
          }
        },
      }),
    [animateTo, clampTranslations, onZoomChange, scaleAnim, txAnim, tyAnim],
  )

  const handlePress = useCallback(
    (evt: any) => {
      const now = Date.now()
      const locX = evt?.nativeEvent?.locationX ?? width / 2
      const locY = evt?.nativeEvent?.locationY ?? height / 2

      if (now - lastTapTimeRef.current < 260) {
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current)
          singleTapTimerRef.current = null
        }
        lastTapTimeRef.current = 0
        try {
          triggerHaptic("selection")
        } catch {}
        if (scaleValRef.current > 1.2) {
          animateTo(1, 0, 0)
        } else {
          const targetScale = 2.5
          const offsetX = (width / 2 - locX) * (targetScale - 1)
          const offsetY = (height / 2 - locY) * (targetScale - 1)
          animateTo(targetScale, offsetX, offsetY)
        }
      } else {
        lastTapTimeRef.current = now
        singleTapTimerRef.current = setTimeout(() => {
          singleTapTimerRef.current = null
          onToggleHud()
        }, 260)
      }
    },
    [animateTo, height, onToggleHud, width],
  )

  return (
    <View style={{ width, height, backgroundColor: "#000000" }} {...panResponder.panHandlers}>
      <Pressable onPress={handlePress} style={styles.flex}>
        <Animated.View
          style={[
            styles.flex,
            {
              transform: [
                { translateX: txAnim },
                { translateY: tyAnim },
                { scale: scaleAnim },
              ],
            },
          ]}
        >
          <PixImage
            url={item.url}
            previewUrl={item.previewUrl}
            priority={isActive ? 1 : 40}
            resizeMode="contain"
            showSpinner={true}
            showRetry={true}
            style={{ width, height, backgroundColor: "#000000" }}
          />
        </Animated.View>
      </Pressable>
    </View>
  )
}

export function IllustGalleryScreen({
  illust,
  initialPage = 0,
  customImages,
}: {
  illust?: PixivIllustration
  initialPage?: number
  customImages?: CustomGalleryImage[]
}) {
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()
  const { width, height } = useWindowDimensions()

  const [quality, setQuality] = useState<"large" | "original">(() => getDetailImageQuality())
  const [hudVisible, setHudVisible] = useState(true)
  const [isZoomed, setIsZoomed] = useState(false)
  const [busyAction, setBusyAction] = useState<"save" | "share" | null>(null)

  const items = useMemo<GalleryItem[]>(() => {
    if (customImages && customImages.length > 0) {
      return customImages.map((img, idx) => ({
        key: `custom-${idx}-${img.url}`,
        url: img.url,
        previewUrl: img.previewUrl ?? null,
        title: img.title,
        fileName: `pixiv_gallery_${idx + 1}.jpg`,
      }))
    }
    if (!illust) return []
    const count = getIllustPageCount(illust)
    const list: GalleryItem[] = []
    for (let i = 0; i < count; i++) {
      const url = imageUrlOf(illust, i, quality)
      if (!url) continue
      list.push({
        key: `illust-${illust.id}-p${i}-${quality}`,
        url,
        previewUrl: resolveIllustUnderlayUrl(illust, i),
        title: illust.title,
        fileName: `pixiv_${illust.id}_p${i + 1}`,
      })
    }
    return list
  }, [customImages, illust, quality])

  const safeInitial = Math.max(0, Math.min(Math.max(0, items.length - 1), initialPage))
  const [currentIndex, setCurrentIndex] = useState(safeInitial)
  const listRef = useRef<FlatList<GalleryItem>>(null)

  const currentItem = items[currentIndex] ?? items[0] ?? null

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]
      if (first && typeof first.index === "number") {
        setCurrentIndex(first.index)
        setIsZoomed(false)
      }
    },
  ).current

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current

  const jumpToPage = useCallback(
    (nextIdx: number) => {
      if (nextIdx < 0 || nextIdx >= items.length) return
      setCurrentIndex(nextIdx)
      setIsZoomed(false)
      listRef.current?.scrollToIndex({ index: nextIdx, animated: true })
    },
    [items.length],
  )

  const handleSaveCurrent = useCallback(async () => {
    if (!currentItem || busyAction) return
    setBusyAction("save")
    try {
      const localPath = cachedFilePath(currentItem.url) ?? (await loadImage(currentItem.url, 1))
      if (!localPath) {
        overlay.showToast("图片尚未加载完成，无法保存", "error")
        return
      }
      const ok = await saveImageToPixivAlbum(localPath, currentItem.fileName)
      try {
        if (ok) triggerHaptic("success")
      } catch {}
      overlay.showToast(ok ? "已保存原图至系统相册" : "保存相册失败", ok ? "success" : "error")
    } catch (err: any) {
      overlay.showToast(err?.message ?? "保存失败", "error")
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, currentItem, overlay])

  const handleShareCurrent = useCallback(async () => {
    if (!currentItem || busyAction) return
    setBusyAction("share")
    try {
      const localPath = cachedFilePath(currentItem.url) ?? (await loadImage(currentItem.url, 1))
      if (!localPath) {
        overlay.showToast("图片下载失败，无法分享", "error")
        return
      }
      await shareItems([localPath])
    } catch (err: any) {
      overlay.showToast(err?.message ?? "分享失败", "error")
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, currentItem, overlay])

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal={true}
        pagingEnabled={true}
        scrollEnabled={!isZoomed}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={safeInitial}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        keyExtractor={(it) => it.key}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        renderItem={({ item, index }) => (
          <ZoomableGalleryPage
            item={item}
            width={width}
            height={height}
            isActive={index === currentIndex}
            onToggleHud={() => setHudVisible((v) => !v)}
            onZoomChange={setIsZoomed}
          />
        )}
      />

      {/* Safe-area HUD overlay */}
      {hudVisible ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Top HUD */}
          <View
            style={[
              styles.topBar,
              {
                paddingTop: insets.top + 8,
                paddingLeft: insets.left + 12,
                paddingRight: insets.right + 12,
              },
            ]}
          >
            <Pressable onPress={() => nav.pop()} hitSlop={10} style={styles.hudPill}>
              <Text style={styles.hudPillText}>‹ 返回</Text>
            </Pressable>

            <View style={styles.topCenter}>
              <Text style={styles.counterText}>
                {items.length > 0 ? `${currentIndex + 1} / ${items.length}` : "0 / 0"}
              </Text>
              {currentItem?.title ? (
                <Text style={styles.titleText} numberOfLines={1}>
                  {currentItem.title}
                </Text>
              ) : null}
            </View>

            {illust && !customImages ? (
              <Pressable
                onPress={() => {
                  try {
                    triggerHaptic("selection")
                  } catch {}
                  setQuality((q) => (q === "original" ? "large" : "original"))
                }}
                style={[
                  styles.hudPill,
                  quality === "original" && styles.hudPillActive,
                ]}
              >
                <Text style={styles.hudPillText}>
                  {quality === "original" ? "原图" : "大图"}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.hudSpacer} />
            )}
          </View>

          {/* Bottom HUD */}
          <View
            style={[
              styles.bottomBar,
              {
                paddingBottom: effectiveBottomInset(insets) + 12,
                paddingLeft: insets.left + 14,
                paddingRight: insets.right + 14,
              },
            ]}
          >
            <View style={styles.bottomGroup}>
              {items.length > 1 ? (
                <>
                  <Pressable
                    disabled={currentIndex <= 0}
                    onPress={() => jumpToPage(currentIndex - 1)}
                    style={[styles.hudPill, currentIndex <= 0 && { opacity: 0.35 }]}
                  >
                    <Text style={styles.hudPillText}>上一页</Text>
                  </Pressable>
                  <Pressable
                    disabled={currentIndex >= items.length - 1}
                    onPress={() => jumpToPage(currentIndex + 1)}
                    style={[
                      styles.hudPill,
                      currentIndex >= items.length - 1 && { opacity: 0.35 },
                    ]}
                  >
                    <Text style={styles.hudPillText}>下一页</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.hintText}>双击或双指缩放</Text>
              )}
            </View>

            <View style={styles.bottomGroup}>
              <Pressable
                disabled={Boolean(busyAction)}
                onPress={() => void handleSaveCurrent()}
                style={styles.hudPill}
              >
                {busyAction === "save" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.hudPillText}>↓ 保存</Text>
                )}
              </Pressable>
              <Pressable
                disabled={Boolean(busyAction)}
                onPress={() => void handleShareCurrent()}
                style={styles.hudPill}
              >
                {busyAction === "share" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.hudPillText}>↗ 分享</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
  },
  flex: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    backgroundColor: "rgba(0, 0, 0, 0.56)",
    gap: 8,
  },
  topCenter: {
    flex: 1,
    alignItems: "center",
  },
  counterText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  titleText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    marginTop: 2,
  },
  hudSpacer: {
    width: 60,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    backgroundColor: "rgba(0, 0, 0, 0.56)",
  },
  bottomGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hudPill: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  hudPillActive: {
    backgroundColor: "#0A84FF",
  },
  hudPillText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  hintText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
  },
})
