import { NOVEL_MIN_TEXT_LENGTH_THRESHOLD } from "../../../../../../Pix-Scripting/src/types"

/**
 * 长篇小说字数门槛。与 iOS v1.8.14.3 的「仅看 8,000 字以上」共用
 * Pixiv 接口自带的 text_length 统计，不在客户端估算字数。
 */
export const NOVEL_LONG_FORM_MIN_TEXT_LENGTH = NOVEL_MIN_TEXT_LENGTH_THRESHOLD

/** 把任意来源的字数门槛收敛成非负整数；非法值等价于「不筛选」。 */
export function normalizeMinTextLength(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.trunc(num)
}

/** 是否已经开启长篇过滤（门槛达到 8,000 字）。 */
export function isLongNovelFilterEnabled(value: unknown): boolean {
  return normalizeMinTextLength(value) >= NOVEL_LONG_FORM_MIN_TEXT_LENGTH
}

/** 开关状态 -> 查询参数里的 minTextLength。 */
export function minTextLengthForLongNovelFilter(enabled: boolean): number {
  return enabled ? NOVEL_LONG_FORM_MIN_TEXT_LENGTH : 0
}

/** 3541 -> "3,541"，与 iOS 的 toLocaleString 展示一致且不受运行环境 locale 影响。 */
export function formatCountWithSeparators(count: number): string {
  const int = Math.max(0, Math.trunc(count))
  return String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/** 筛选胶囊文案；未开启过滤时返回 null。 */
export function formatMinTextLengthLabel(value: unknown): string | null {
  const min = normalizeMinTextLength(value)
  return min > 0 ? `≥${formatCountWithSeparators(min)} 字` : null
}

/**
 * 单条小说是否满足门槛。Pixiv 未返回 text_length 时按 0 处理，
 * 因此开启过滤后会被隐藏（与 iOS 的 `(text_length ?? 0) < min` 一致）。
 */
export function matchesMinTextLength(textLength: unknown, minTextLength: unknown): boolean {
  const min = normalizeMinTextLength(minTextLength)
  if (min === 0) return true
  if (typeof textLength !== "number" || !Number.isFinite(textLength)) return false
  return textLength >= min
}

/** 纯过滤函数：只作用于小说列表，保持原有顺序。 */
export function filterNovelsByMinTextLength<T extends { text_length?: number | null }>(
  items: readonly T[],
  minTextLength: unknown,
): T[] {
  const min = normalizeMinTextLength(minTextLength)
  return items.filter((item) => matchesMinTextLength(item.text_length, min))
}
