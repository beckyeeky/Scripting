/**
 * 译文缓存账本（纯逻辑）
 *
 * 目标：把「按小说页/段 + 源正文版本 + 模型/提示词配置指纹」的缓存语义集中在一处，
 * 并明确区分 未完成 / 完成 / 失败 / 失效，供 store 与 UI 复用且可离线单测。
 *
 * 安全边界：只做纯函数计算，不触网、不读取账号凭据、不写文件。
 */
import { stableHash } from "./novelAnchor"

export const TRANSLATION_LEDGER_CACHE_VERSION = 3
export const TRANSLATION_PROMPT_VERSION = 4

export type TranslationLedgerStatus = "unfinished" | "done" | "failed" | "stale"

export interface LedgerBlockIdentity {
  /** 源正文指纹 */
  source: string
  /** 模型 + 提示词配置指纹（不含密钥） */
  model?: string
}

export interface LedgerStoredBlock {
  source?: string
  translation?: string
  error?: string
  model?: string
}

export interface LedgerInputBlock {
  id: string
  original: string
  kind?: "text" | "chapter"
}

export interface LedgerCounts {
  total: number
  done: number
  failed: number
  unfinished: number
  stale: number
}

/** 源文本指纹（纯 JS，跨平台一致） */
export function ledgerSourceFingerprint(text: string): string {
  return stableHash(typeof text === "string" ? text : "")
}

/**
 * 模型 + 提示词配置指纹。
 * 只包含协议/端点/模型/温度/目标语言/提示词版本等非敏感字段，密钥永不参与。
 */
export function promptConfigurationFingerprint(input: {
  protocol: string
  endpoint: string
  model: string
  temperature?: number | null
  targetLanguage: string
  promptVersion?: number
  thinkingPolicy?: string
  cacheVersion?: number
}): string {
  return stableHash(
    JSON.stringify({
      cacheVersion: input.cacheVersion ?? TRANSLATION_LEDGER_CACHE_VERSION,
      promptVersion: input.promptVersion ?? TRANSLATION_PROMPT_VERSION,
      thinkingPolicy: input.thinkingPolicy ?? "off-v1",
      protocol: input.protocol,
      endpoint: input.endpoint,
      model: input.model,
      temperature: input.temperature ?? null,
      targetLanguage: input.targetLanguage,
    })
  )
}

/**
 * 单个块的账本状态。
 * - 没有存档 → unfinished
 * - 源正文指纹变化 → stale（旧译文失效，不得静默复用）
 * - 模型/提示词配置指纹变化 → stale
 * - 有译文 → done；有错误 → failed；其余 → unfinished
 */
export function ledgerBlockStatus(
  stored: LedgerStoredBlock | null | undefined,
  currentSource: string,
  currentModel?: string
): TranslationLedgerStatus {
  if (!stored) return "unfinished"
  if (stored.source !== currentSource) return "stale"
  if (currentModel && stored.model && stored.model !== currentModel) return "stale"
  if (stored.translation && stored.translation.trim()) return "done"
  if (stored.error) return "failed"
  return "unfinished"
}

/** 批量统计账本状态；源指纹由 original 现场计算，避免调用方传错 */
export function ledgerCounts(
  blocks: LedgerInputBlock[] | null | undefined,
  stored: Record<string, LedgerStoredBlock> | null | undefined,
  currentModel?: string
): LedgerCounts {
  const list = Array.isArray(blocks) ? blocks : []
  const map = stored ?? {}
  const counts: LedgerCounts = { total: list.length, done: 0, failed: 0, unfinished: 0, stale: 0 }
  for (const block of list) {
    const status = ledgerBlockStatus(map[block.id], ledgerSourceFingerprint(block.original), currentModel)
    counts[status] += 1
  }
  return counts
}

/** 需要重新翻译的块：未完成、失败与失效（源改动后旧译文必须重译） */
export function retryableBlockIds(
  blocks: LedgerInputBlock[] | null | undefined,
  stored: Record<string, LedgerStoredBlock> | null | undefined,
  currentModel?: string,
  options: { includeStale?: boolean } = {}
): string[] {
  const list = Array.isArray(blocks) ? blocks : []
  const map = stored ?? {}
  const includeStale = options.includeStale !== false
  const ids: string[] = []
  for (const block of list) {
    const status = ledgerBlockStatus(map[block.id], ledgerSourceFingerprint(block.original), currentModel)
    if (status === "done") continue
    if (status === "stale" && !includeStale) continue
    ids.push(block.id)
  }
  return ids
}

/** 中文状态说明，供 UI 直接展示（未完成/完成/失败/失效区分明确） */
export function ledgerStatusLabel(status: TranslationLedgerStatus): string {
  switch (status) {
    case "done":
      return "已完成"
    case "failed":
      return "失败，可重试"
    case "stale":
      return "原文已改动，需重新翻译"
    default:
      return "未完成"
  }
}

/** 账本总体说明（标题栏用） */
export function ledgerSummaryText(counts: LedgerCounts): string {
  if (counts.total === 0) return "没有可翻译的段落"
  const parts = [`完成 ${counts.done}/${counts.total}`]
  if (counts.failed > 0) parts.push(`失败 ${counts.failed}`)
  if (counts.unfinished > 0) parts.push(`未完成 ${counts.unfinished}`)
  if (counts.stale > 0) parts.push(`失效 ${counts.stale}`)
  return parts.join(" · ")
}

/* ───────────────────────── 术语表锁定 ───────────────────────── */

export interface GlossaryEntry {
  category: string
  source: string
  target: string
  note?: string
}

/** 解析「类别｜原文｜译文[｜备注]」格式的术语行（与既有存储格式保持一致） */
export function parseGlossaryEntries(raw: string | null | undefined): GlossaryEntry[] {
  if (!raw) return []
  const entries: GlossaryEntry[] = []
  for (const line of raw.split("\n")) {
    const parts = line.split(/[｜|]/).map((part) => part.trim())
    const source = parts[1]
    if (!source || !parts[2]) continue
    if (source.length > 100 || parts[2].length > 100) continue
    entries.push({
      category: parts[0] || "名称",
      source,
      target: parts[2],
      note: parts[3] || undefined,
    })
  }
  return entries
}

/** 序列化术语表（保留既有「｜」分隔格式，便于既有解析器继续工作） */
export function serializeGlossaryEntries(entries: GlossaryEntry[] | null | undefined): string {
  const list = Array.isArray(entries) ? entries : []
  return list
    .filter((item) => item && item.source && item.target)
    .map((item) => {
      const base = `${item.category || "名称"}｜${item.source}｜${item.target}`
      return item.note ? `${base}｜${item.note}` : base
    })
    .join("\n")
}

/** 术语表是否已锁定（锁定后不重新生成，且必须进入 prompt） */
export function isGlossaryLocked(stored: { glossary?: string; glossaryLocked?: boolean } | null | undefined): boolean {
  return Boolean(stored && stored.glossaryLocked && stored.glossary && stored.glossary.trim())
}

/**
 * 合并本地术语表与系列术语表：以本地（锁定）条目优先，系列条目补充缺口。
 * 保证锁定后的术语不会被自动生成的系列术语覆盖。
 */
export function mergeLockedGlossary(local: string | null | undefined, series: string | null | undefined): string {
  const localEntries = parseGlossaryEntries(local)
  const result = new Map<string, GlossaryEntry>()
  for (const entry of localEntries) result.set(entry.source.toLowerCase(), entry)
  for (const entry of parseGlossaryEntries(series)) {
    const key = entry.source.toLowerCase()
    if (!result.has(key)) result.set(key, entry)
  }
  return serializeGlossaryEntries(Array.from(result.values())).slice(0, 8000)
}

/* ───────────────────────── 发送范围与对齐校验 ───────────────────────── */

export type TranslationProviderKind = "assistant" | "openai" | "anthropic" | "gemini" | "unknown"

/** 供应商展示名（不含端点与密钥） */
export function providerLabel(kind: TranslationProviderKind): string {
  switch (kind) {
    case "assistant":
      return "系统智能助手"
    case "openai":
      return "OpenAI 兼容接口"
    case "anthropic":
      return "Anthropic"
    case "gemini":
      return "Google Gemini"
    default:
      return "自定义接口"
  }
}

/**
 * 发送范围提示：明确告知用户即将发送的内容构成。
 * 只统计与描述，不包含端点、密钥或私有正文；正文由用户在阅读页主动发起翻译。
 */
export function translationSendScopeNotice(input: {
  provider: TranslationProviderKind
  title: string
  caption: string
  blocks: LedgerInputBlock[] | null | undefined
  targetLanguage: string
  glossaryCount: number
}): string {
  const list = Array.isArray(input.blocks) ? input.blocks : []
  const bodyBlocks = list.filter((block) => (block.kind ?? "text") === "text").length
  const chapterBlocks = list.length - bodyBlocks
  const pieces = [`将向${providerLabel(input.provider)}请求翻译：标题与简介`]
  if (chapterBlocks > 0) pieces.push(`${chapterBlocks} 个章节标题`)
  pieces.push(`${bodyBlocks} 个正文段落`)
  if (input.glossaryCount > 0) pieces.push(`术语表 ${input.glossaryCount} 条`)
  pieces.push(`目标语言 ${input.targetLanguage}`)
  return `${pieces.join("、")}。仅发送上述文本，不含账号序列号、令牌或本地凭据；未完成段落会按块重试，源文改动后旧译文自动失效。`
}

/**
 * 对齐校验回退：当译文块与原文块不是一一对应时，给出明确警告，
 * 避免 UI 宣称「段落逐句绝对对齐」。
 */
export function translationAlignmentWarnings(
  blocks: LedgerInputBlock[] | null | undefined,
  snapshotBlocks: Record<string, { status?: string }> | null | undefined
): string[] {
  const list = Array.isArray(blocks) ? blocks : []
  const map = snapshotBlocks ?? {}
  const warnings: string[] = []
  const missing = list.filter((block) => !map[block.id])
  if (missing.length > 0) {
    warnings.push(`${missing.length} 个原文段落没有对应译文块，已回退为按块对照（非逐句对齐）`)
  }
  const done = list.filter((block) => map[block.id]?.status === "done")
  if (done.length !== list.length && list.length > 0) {
    warnings.push("部分段落尚未完成翻译，对照视图会保留原文占位")
  }
  return warnings
}
