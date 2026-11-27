/**
 * 小说导出的作者 / 标签 / R18 元数据解析。
 *
 * 职责：在「详情接口已加载」「详情缺失（离线/旧路由）」「路由显式携带」之间
 * 给出稳定的回退顺序，供详情页与阅读器导出共用，避免各处硬编码 "Pixiv"。
 * 边界：纯函数，不做网络与存储访问；缺字段才回退，绝不猜测真实作者。
 */
import type { PixivNovel } from "../../../../../../Pix-Scripting/src/types"

/** 详情与路由都拿不到作者时的占位，保持与旧导出行为一致 */
export const NOVEL_EXPORT_FALLBACK_AUTHOR = "Pixiv"

export interface NovelExportRouteMeta {
  author?: string | null
  tags?: readonly string[] | null
  isR18?: boolean | null
}

export interface NovelExportMetadata {
  author: string
  authorId?: number
  tags: string[]
  isR18: boolean
}

/** PixivNovel / PixivNovelDetail / 离线记录都满足的最小元数据结构 */
type NovelMetaSource = Partial<Pick<PixivNovel, "user" | "tags" | "x_restrict">>

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** 统一清洗标签来源（详情 tag 对象或路由 string[]），去空、去重、保序 */
export function normalizeNovelTagNames(
  values: readonly unknown[] | null | undefined,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const raw =
      typeof value === "string"
        ? value
        : value && typeof value === "object"
          ? (value as { name?: unknown }).name
          : null
    const name = cleanText(raw)
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 与 iOS 一致：x_restrict > 0，或标签命中 R-18 / R18 */
export function isNovelR18(source: NovelMetaSource): boolean {
  if (!source) return false
  if (Number(source.x_restrict ?? 0) > 0) return true
  return normalizeNovelTagNames(source.tags).some((name) => /r-?18/i.test(name))
}

/**
 * 解析导出元数据。逐字段回退：
 * - 作者：详情作者 → 路由 author → NOVEL_EXPORT_FALLBACK_AUTHOR
 * - 标签：详情标签（非空时）→ 路由 tags
 * - R18：详情标记 或 路由 isR18（宁可多标注，不静默漏标）
 */
export function resolveNovelExportMetadata(input: {
  detail?: NovelMetaSource
  route?: NovelExportRouteMeta | null
}): NovelExportMetadata {
  const detail = input?.detail ?? null
  const route = input?.route ?? null

  const detailAuthor = cleanText(detail?.user?.name)
  const routeAuthor = cleanText(route?.author)
  const detailTags = normalizeNovelTagNames(detail?.tags)
  const routeTags = normalizeNovelTagNames(route?.tags)
  const authorId =
    detail?.user?.id && Number(detail.user.id) > 0 ? Number(detail.user.id) : undefined

  return {
    author: detailAuthor || routeAuthor || NOVEL_EXPORT_FALLBACK_AUTHOR,
    authorId,
    tags: detailTags.length > 0 ? detailTags : routeTags,
    isR18: isNovelR18(detail) || Boolean(route?.isR18),
  }
}
