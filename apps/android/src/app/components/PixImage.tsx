import React, { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import {
  cachedFilePath,
  DEFAULT_IMAGE_PRIORITY,
  loadImage,
} from "../../../../../Pix-Scripting/src/image/imageLoader"
import { ScriptingFileManager } from "../../scripting/hostGlobals"
import { useAppTheme } from "../theme/ThemeProvider"

export function clampedAspectRatio(
  width?: number | null,
  height?: number | null,
  minRatio = 0.55,
  maxRatio = 2.0,
  fallback = 0.85,
): number {
  if (!width || !height || width <= 0 || height <= 0) return fallback
  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio <= 0) return fallback
  return Math.min(maxRatio, Math.max(minRatio, ratio))
}

export interface UrlKeyedPath {
  url: string | null
  path: string | null
  retryToken: number
}

/**
 * Resolves the active local file path for the current `url`, ensuring recycled
 * FlashList cells never render a previous item's cached path on the first frame
 * before effects run.
 */
export function resolveUrlKeyedPath(
  url: string | null | undefined,
  syncPath: string | null,
  state: UrlKeyedPath,
  retryToken = 0,
): string | null {
  if (!url) return null
  if (state.url === url && state.retryToken === retryToken) {
    return state.path
  }
  if (retryToken === 0 && syncPath) {
    return syncPath
  }
  return null
}

function toFileUri(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith("file://") || path.startsWith("content://") || path.startsWith("data:")) {
    return path
  }
  return `file://${path}`
}

function evictCorruptCacheFile(filePath: string | null | undefined): void {
  if (!filePath) return
  const raw = filePath.startsWith("file://") ? filePath.slice("file://".length) : filePath
  if (!raw || raw.startsWith("content://") || raw.startsWith("data:")) return
  try {
    ScriptingFileManager?.removeSync?.(raw)
  } catch {
    // Best-effort cleanup of corrupt/truncated disk cache entry
  }
}

export interface PixImageProps {
  url: string | null | undefined
  previewUrl?: string | null
  priority?: number
  resizeMode?: "cover" | "contain"
  style?: StyleProp<ViewStyle>
  imageStyle?: StyleProp<ImageStyle>
  borderRadius?: number
  showRetry?: boolean
  showSpinner?: boolean
  onLoaded?: (ok: boolean, localPath?: string) => void
  onNaturalSize?: (width: number, height: number) => void
}

export function PixImage({
  url,
  previewUrl,
  priority = DEFAULT_IMAGE_PRIORITY,
  resizeMode = "cover",
  style,
  imageStyle,
  borderRadius = 0,
  showRetry = false,
  showSpinner = false,
  onLoaded,
  onNaturalSize,
}: PixImageProps) {
  const { colors, accent } = useAppTheme()

  // Key retry count by URL so recycled FlashList cells start at retryToken=0 immediately
  const [retryState, setRetryState] = useState<{ url: string | null; count: number }>({
    url: url ?? null,
    count: 0,
  })
  const retryToken = url && retryState.url === url ? retryState.count : 0

  const syncPrimaryPath = url && retryToken === 0 ? cachedFilePath(url) : null
  const syncPreviewPath = previewUrl ? cachedFilePath(previewUrl) : null

  const [primaryState, setPrimaryState] = useState<UrlKeyedPath>(() => ({
    url: url ?? null,
    path: syncPrimaryPath,
    retryToken: 0,
  }))
  const [previewState, setPreviewState] = useState<UrlKeyedPath>(() => ({
    url: previewUrl ?? null,
    path: syncPreviewPath,
    retryToken: 0,
  }))
  const [failedState, setFailedState] = useState<{ url: string | null; retryToken: number }>({
    url: null,
    retryToken: -1,
  })
  const [readyState, setReadyState] = useState<{ url: string | null; retryToken: number }>({
    url: syncPrimaryPath ? (url ?? null) : null,
    retryToken: 0,
  })
  const [loadingState, setLoadingState] = useState<{
    url: string | null
    retryToken: number
    active: boolean
  }>({
    url: url ?? null,
    retryToken: 0,
    active: Boolean(url && !syncPrimaryPath),
  })

  // Load preview underlay if not cached yet and primary isn't ready
  useEffect(() => {
    const cached = previewUrl ? cachedFilePath(previewUrl) : null
    setPreviewState({ url: previewUrl ?? null, path: cached, retryToken: 0 })
    if (!previewUrl || cached || syncPrimaryPath) return
    let active = true
    void loadImage(previewUrl, Math.min(priority, 100))
      .then((path) => {
        if (active && path) {
          setPreviewState({ url: previewUrl, path, retryToken: 0 })
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [previewUrl, syncPrimaryPath, priority])

  // Load main target URL
  useEffect(() => {
    if (!url) {
      setPrimaryState({ url: null, path: null, retryToken: 0 })
      setReadyState({ url: null, retryToken: 0 })
      setLoadingState({ url: null, retryToken: 0, active: false })
      return
    }

    if (retryToken > 0) {
      evictCorruptCacheFile(cachedFilePath(url))
    } else {
      const cached = cachedFilePath(url)
      if (cached) {
        setPrimaryState({ url, path: cached, retryToken: 0 })
        setReadyState({ url, retryToken: 0 })
        setLoadingState({ url, retryToken: 0, active: false })
        onLoaded?.(true, cached)
        return
      }
    }

    let active = true
    setPrimaryState({ url, path: null, retryToken })
    setReadyState({ url: null, retryToken })
    setLoadingState({ url, retryToken, active: true })

    void loadImage(url, priority)
      .then((path) => {
        if (!active) return
        if (path) {
          setPrimaryState({ url, path, retryToken })
          setFailedState({ url: null, retryToken: -1 })
          setLoadingState({ url, retryToken, active: false })
          onLoaded?.(true, path)
        } else {
          setFailedState({ url, retryToken })
          setLoadingState({ url, retryToken, active: false })
          onLoaded?.(false)
        }
      })
      .catch(() => {
        if (!active) return
        setFailedState({ url, retryToken })
        setLoadingState({ url, retryToken, active: false })
        onLoaded?.(false)
      })

    return () => {
      active = false
    }
  }, [url, priority, retryToken])

  // Derive render-time values strictly for the current `url` to prevent FlashList stale flashes
  const activePrimaryPath = resolveUrlKeyedPath(url, syncPrimaryPath, primaryState, retryToken)
  const activePreviewPath = resolveUrlKeyedPath(previewUrl, syncPreviewPath, previewState, 0)
  const primaryFailed = Boolean(url && failedState.url === url && failedState.retryToken === retryToken)
  const primaryReady = Boolean(
    url &&
      activePrimaryPath &&
      ((readyState.url === url && readyState.retryToken === retryToken) ||
        (retryToken === 0 && syncPrimaryPath === activePrimaryPath)),
  )
  const isLoading = Boolean(
    url &&
      !primaryFailed &&
      !activePrimaryPath &&
      (loadingState.url !== url || loadingState.retryToken !== retryToken || loadingState.active),
  )

  const primaryUri = primaryFailed ? null : toFileUri(activePrimaryPath)
  const previewUri = toFileUri(activePreviewPath)

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.fill, borderRadius },
        style,
      ]}
    >
      {previewUri && !primaryReady ? (
        <Image
          source={{ uri: previewUri }}
          style={[StyleSheet.absoluteFill, { borderRadius }, imageStyle]}
          resizeMode={resizeMode}
          fadeDuration={0}
        />
      ) : null}

      {primaryUri ? (
        <Image
          source={{ uri: primaryUri }}
          style={[StyleSheet.absoluteFill, { borderRadius }, imageStyle]}
          resizeMode={resizeMode}
          resizeMethod="resize"
          fadeDuration={0}
          onLoad={(evt) => {
            if (url) setReadyState({ url, retryToken })
            const src = evt?.nativeEvent?.source
            if (src && src.width > 0 && src.height > 0) {
              onNaturalSize?.(src.width, src.height)
            }
          }}
          onError={() => {
            evictCorruptCacheFile(activePrimaryPath)
            if (url) {
              setFailedState({ url, retryToken })
              setPrimaryState({ url, path: null, retryToken })
            }
            setReadyState({ url: null, retryToken })
          }}
        />
      ) : null}

      {isLoading && showSpinner && !previewUri ? (
        <View style={styles.centerOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={accent} />
        </View>
      ) : null}

      {primaryFailed && showRetry ? (
        <Pressable
          style={[styles.retryOverlay, { backgroundColor: colors.fillStrong }]}
          onPress={() => {
            if (!url) return
            evictCorruptCacheFile(cachedFilePath(url))
            setFailedState({ url: null, retryToken: -1 })
            setRetryState((prev) => ({
              url,
              count: prev.url === url ? prev.count + 1 : 1,
            }))
          }}
        >
          <Text style={[styles.retryText, { color: colors.text }]}>加载失败 · 点击重试</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function PixAvatar({
  url,
  name,
  size = 36,
}: {
  url: string | null | undefined
  name?: string | null
  size?: number
}) {
  const { colors, accentSoft, accent } = useAppTheme()
  const initial = (name || "P").trim().slice(0, 1).toUpperCase()
  const radius = size / 2

  if (!url) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: accent, fontSize: Math.max(11, Math.round(size * 0.42)), fontWeight: "700" }}>
          {initial}
        </Text>
      </View>
    )
  }

  return (
    <PixImage
      url={url}
      priority={50}
      resizeMode="cover"
      borderRadius={radius}
      style={{
        width: size,
        height: size,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.separator,
      }}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  retryOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  retryText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
})
