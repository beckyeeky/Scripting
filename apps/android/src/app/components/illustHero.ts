/**
 * 首图大卡片的纯拆分逻辑，便于回归测试。只有用户开启开关且处于窄布局
 * （<= 2 列，与 iOS IllustFlowFeed 一致）时才把首条作品提升为大卡。
 */
export const HERO_FIRST_MAX_COLUMNS = 2

export interface HeroFirstSplit<T> {
  hero: T | null
  rest: T[]
}

export function splitHeroFirst<T>(
  items: readonly T[],
  enabled: boolean,
  columnCount: number,
): HeroFirstSplit<T> {
  if (!enabled || columnCount < 1 || columnCount > HERO_FIRST_MAX_COLUMNS || items.length === 0) {
    return { hero: null, rest: items.slice() }
  }
  return { hero: items[0], rest: items.slice(1) }
}
