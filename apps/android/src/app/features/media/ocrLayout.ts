// OCR 预览几何：<Image resizeMode="contain"> 会把图片按比例缩放并居中，
// 因此气泡坐标必须以「实际绘制区域」为基准换算；直接用容器宽高会在
// 竖长图两侧留白时把气泡整体推偏。

export interface Size {
  width: number
  height: number
}

export interface ContainedRect {
  /** 绘制区域左上角相对容器左上角的偏移（点） */
  x: number
  y: number
  width: number
  height: number
  /** 原图像素到容器点的缩放比 */
  scale: number
}

export interface BubbleRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 竖长条漫最多按高度的 12.5 倍容器宽度显示；超过该比例才允许左右留白。
 * 旧实现把比例夹在 [0.45, 2.2]，普通长条漫会被强行压扁并出现黑边。
 */
export const MIN_STAGE_ASPECT_RATIO = 0.08

const EMPTY_RECT: ContainedRect = { x: 0, y: 0, width: 0, height: 0, scale: 0 }

function positive(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 按 contain 语义计算图片在容器中的真实绘制矩形。
 * 容器或原图尺寸无效时返回全零矩形，调用方据此跳过绘制。
 */
export function computeContainedRect(box: Size, content: Size): ContainedRect {
  const boxWidth = positive(box?.width)
  const boxHeight = positive(box?.height)
  const contentWidth = positive(content?.width)
  const contentHeight = positive(content?.height)
  if (!boxWidth || !boxHeight || !contentWidth || !contentHeight) return { ...EMPTY_RECT }

  const scale = Math.min(boxWidth / contentWidth, boxHeight / contentHeight)
  const width = contentWidth * scale
  const height = contentHeight * scale
  return {
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
    width,
    height,
    scale,
  }
}

/**
 * 预览容器的宽高比。与 computeContainedRect 配合：比例未被夹取时
 * 绘制矩形正好铺满容器，长条漫不再出现左右黑边。
 */
export function computeStageAspectRatio(content: Size): number {
  const width = positive(content?.width)
  const height = positive(content?.height)
  if (!width || !height) return MIN_STAGE_ASPECT_RATIO
  return Math.max(MIN_STAGE_ASPECT_RATIO, width / height)
}

/**
 * 把 0..1000 归一化的 OCR 气泡框 [ymin, xmin, ymax, xmax] 换算到绘制区域。
 * minSize 保证极小气泡仍可点击。
 */
export function mapBubbleBoxToRect(
  box2d: readonly number[] | null | undefined,
  rect: ContainedRect,
  minSize: Size = { width: 24, height: 18 },
): BubbleRect | null {
  if (!box2d || box2d.length < 4) return null
  const [rawYMin, rawXMin, rawYMax, rawXMax] = box2d
  const values = [rawYMin, rawXMin, rawYMax, rawXMax]
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null
  if (!(rect.width > 0) || !(rect.height > 0)) return null

  const ymin = Math.min(rawYMin, rawYMax)
  const ymax = Math.max(rawYMin, rawYMax)
  const xmin = Math.min(rawXMin, rawXMax)
  const xmax = Math.max(rawXMin, rawXMax)

  return {
    left: rect.x + (xmin / 1000) * rect.width,
    top: rect.y + (ymin / 1000) * rect.height,
    width: Math.max(minSize.width, ((xmax - xmin) / 1000) * rect.width),
    height: Math.max(minSize.height, ((ymax - ymin) / 1000) * rect.height),
  }
}
