export type FeedColumnCap = 0 | 2 | 3 | 4 | 5 | 6

export function resolveFeedColumnCount(
  containerWidth: number,
  isLandscape: boolean,
  caps: { landscape: FeedColumnCap; portrait: FeedColumnCap }
): number {
  // 目标单列宽约 215pt。用户上限只缩小列数，不覆盖窄容器的自适应结果。
  const fitted = Math.max(2, Math.min(6, Math.round(containerWidth / 215)))
  const cap = isLandscape ? caps.landscape : caps.portrait
  return cap > 0 ? Math.min(fitted, cap) : fitted
}
