import {
  LazyVStack,
  useEffect,
  VStack,
} from "scripting"
import type { PixivIllustration } from "../../types"
import {
  cachedFilePath,
  maxConcurrentDownloads,
  pageThumbUrlOf,
  prefetch,
} from "../../image/imageLoader"
import { getDetailImageQuality, getFeedImageQuality } from "../../store/settings"
import { CachedImage } from "../components/CachedImage"
import { UgoiraPlayerView } from "../UgoiraView"

export interface IllustMediaViewportProps {
  illust: PixivIllustration
  quality: "medium" | "large" | "original"
  pageCount: number
  pageURLs: (string | null)[]
  pageAspect: number
  onMediaReady: () => void
  onMainImageLoaded: () => void
  onOpenGallery: (pageIndex?: number) => void
}

export function IllustMediaViewport(props: IllustMediaViewportProps) {
  const {
    illust,
    quality,
    pageCount,
    pageURLs,
    pageAspect,
    onMediaReady,
    onMainImageLoaded,
    onOpenGallery,
  } = props

  const feedQuality = getFeedImageQuality()
  const detailQuality = getDetailImageQuality()

  // 垫底图清晰度：流为大图时取大图垫底，流为中等时取中等图垫底
  const previewQuality: "medium" | "large" = feedQuality === "large" ? "large" : "medium"

  // 垫底图动画模式：
  // 1. 中等 + 大图 / 中等 + 原图 -> blur（高斯模糊消融）
  // 2. 大图 + 大图 -> none（首帧秒开无动画）
  // 3. 大图 + 原图 -> sharp（高清大图锐利垫底 + 原图锐化覆盖）
  const previewMode: "blur" | "sharp" | "none" =
    feedQuality === "large" && detailQuality === "large"
      ? "none"
      : feedQuality === "large" && detailQuality === "original"
        ? "sharp"
        : "blur"

  // 当为多页作品时，在详情页挂载的第一时间高优先级并发预热首批缩略图（首批数量跟随调试前台并发数设置），
  // 已就绪落盘的文件直接跳过绝不重复请求；首图按画质设置预热，后续页预热轻量 medium。
  // 退出详情页时通过 prefetch 取消句柄立即熔断未完成的预取，杜绝离开页面后后台偷跑流量。
  useEffect(() => {
    if (!illust || pageCount <= 1) return
    const warmLimit = Math.min(pageCount, maxConcurrentDownloads())
    const urlsToPrefetch: string[] = []

    for (let idx = 0; idx < warmLimit; idx++) {
      const thumb = pageThumbUrlOf(illust, idx, idx === 0 ? previewQuality : "medium")
      if (thumb && !cachedFilePath(thumb)) {
        urlsToPrefetch.push(thumb)
      }
    }

    if (!urlsToPrefetch.length) return

    const handle = prefetch(urlsToPrefetch)
    return () => {
      handle.cancel()
    }
  }, [illust, pageCount, previewQuality])

  return (
    <VStack
      alignment="center"
      spacing={4}
      frame={{ maxWidth: "infinity" }}
    >
      {illust.type === "ugoira" ? (
        <UgoiraPlayerView
          illustID={illust.id}
          previewUrl={pageThumbUrlOf(illust, 0, previewQuality)}
          aspectRatioValue={pageAspect}
          cornerRadius={8}
          onLoaded={onMediaReady}
        />
      ) : pageCount > 1 ? (
        <LazyVStack spacing={0} alignment="center">
          {pageURLs.map((url, idx) => {
            const isFirst = idx === 0
            const preview = pageThumbUrlOf(illust, idx, isFirst ? previewQuality : "medium")
            const itemPreviewMode = isFirst ? previewMode : "blur"
            const isLast = idx === pageCount - 1
            const cornerRadii = isFirst
              ? { topLeading: 8, topTrailing: 8, bottomLeading: 0, bottomTrailing: 0 }
              : isLast
                ? { topLeading: 0, topTrailing: 0, bottomLeading: 8, bottomTrailing: 8 }
                : 0
            return (
              <CachedImage
                key={`illust-page-${illust.id}-${idx}`}
                url={url}
                previewUrl={(isFirst ? illust.extra_preview_url : null) || preview}
                previewMode={itemPreviewMode}
                aspectRatioValue={pageAspect}
                useIntrinsicAspectRatio={true}
                cornerRadius={cornerRadii}
                contentMode="fit"
                frame={{ maxWidth: "infinity" }}
                priority={isFirst ? -5000 : idx}
                isSprint={isFirst}
                onLoaded={isFirst ? onMainImageLoaded : undefined}
                onTapGesture={() => onOpenGallery(idx)}
              />
            )
          })}
        </LazyVStack>
      ) : (
        <CachedImage
          key={`illust-single-${illust.id}`}
          url={pageURLs[0] ?? null}
          previewUrl={illust.extra_preview_url || pageThumbUrlOf(illust, 0, previewQuality)}
          previewMode={previewMode}
          aspectRatioValue={pageAspect}
          useIntrinsicAspectRatio={true}
          cornerRadius={8}
          contentMode="fit"
          frame={{ maxWidth: "infinity" }}
          priority={-5000}
          isSprint={true}
          onLoaded={onMainImageLoaded}
          onTapGesture={() => onOpenGallery(0)}
        />
      )}
    </VStack>
  )
}
