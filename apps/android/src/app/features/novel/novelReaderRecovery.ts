/**
 * Pure helpers for rebuilding the novel reader after the WebView renderer
 * process is killed by the system.
 *
 * Keep this module free of React Native / WebView imports so the retry policy
 * and the recovered reading anchor can be regression-tested with `node --test`.
 */

export const NOVEL_CRASH_MAX_REBUILDS = 2
export const NOVEL_CRASH_RETRY_WINDOW_MS = 60_000

export interface NovelCrashRecoveryState {
  /** Automatic rebuilds used in the current retry window. */
  attempts: number
  /** Timestamp (ms) of the most recent automatic rebuild, 0 when never tried. */
  lastAttemptAt: number
}

export interface NovelCrashEvent {
  crashed?: boolean
  success?: boolean
}

export interface NovelCrashRecoveryOptions {
  maxAttempts?: number
  windowMs?: number
}

export interface NovelCrashRecoveryDecision {
  rebuild: boolean
  exhausted: boolean
  attempt: number
  state: NovelCrashRecoveryState
}

export interface NovelRecoveryAttemptDecision {
  allowed: boolean
  attempts: number
  lastAttemptAt: number
}

export const EMPTY_CRASH_RECOVERY_STATE: NovelCrashRecoveryState = {
  attempts: 0,
  lastAttemptAt: 0,
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NOVEL_CRASH_MAX_REBUILDS
  return Math.max(0, Math.floor(value))
}

function normalizeWindowMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NOVEL_CRASH_RETRY_WINDOW_MS
  return Math.max(0, Math.floor(value))
}

function normalizeNow(value: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Consume one automatic rebuild from the budget.
 *
 * Crashes that are far apart (outside `windowMs`) start a fresh budget, so a
 * renderer kill days later is not blocked by an old exhausted counter, while a
 * tight crash loop still stops after `maxAttempts` rebuilds.
 */
export function nextRecoveryAttempt(
  state: NovelCrashRecoveryState | null | undefined,
  now: number,
  options: NovelCrashRecoveryOptions = {},
): NovelRecoveryAttemptDecision {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts)
  const windowMs = normalizeWindowMs(options.windowMs)
  const timestamp = normalizeNow(now)
  const rawAttempts = state?.attempts
  const rawLastAttemptAt = state?.lastAttemptAt
  const previousAttempts =
    typeof rawAttempts === "number" && Number.isFinite(rawAttempts)
      ? Math.max(0, Math.floor(rawAttempts))
      : 0
  const lastAttemptAt =
    typeof rawLastAttemptAt === "number" && Number.isFinite(rawLastAttemptAt)
      ? Math.max(0, Math.floor(rawLastAttemptAt))
      : 0
  const windowExpired =
    lastAttemptAt > 0 && timestamp > 0 && timestamp - lastAttemptAt > windowMs
  const attempts = windowExpired ? 0 : previousAttempts

  if (attempts >= maxAttempts) {
    return { allowed: false, attempts, lastAttemptAt }
  }
  return { allowed: true, attempts: attempts + 1, lastAttemptAt: timestamp }
}

/**
 * Decide whether an `onLoadComplete` event should trigger an automatic HTML
 * rebuild. Only renderer death qualifies; ordinary load failures keep the
 * existing in-place behaviour.
 */
export function shouldRebuildAfterCrash(
  event: NovelCrashEvent | null | undefined,
  state: NovelCrashRecoveryState | null | undefined,
  now: number,
  options: NovelCrashRecoveryOptions = {},
): NovelCrashRecoveryDecision {
  const base: NovelCrashRecoveryState = {
    attempts: Math.max(0, Math.floor(state?.attempts ?? 0)),
    lastAttemptAt: Math.max(0, Math.floor(state?.lastAttemptAt ?? 0)),
  }
  if (!event?.crashed) {
    return { rebuild: false, exhausted: false, attempt: base.attempts, state: base }
  }

  const next = nextRecoveryAttempt(base, now, options)
  return {
    rebuild: next.allowed,
    exhausted: !next.allowed,
    attempt: next.attempts,
    state: { attempts: next.attempts, lastAttemptAt: next.lastAttemptAt },
  }
}

export interface NovelReaderProgressLike {
  page?: number | null
  chunkId?: string | null
  offset?: number | null
  quote?: string | null
}

export interface NovelRecoveryAnchor {
  chunkId: string | null
  page: number
  offset: number
  quote?: string
}

/**
 * Build the anchor passed to `buildNovelReaderHtml` when recreating the
 * document. Invalid / missing values degrade to the start of the novel instead
 * of producing a broken jump target.
 */
export function recoveryAnchorFromProgress(
  progress: NovelReaderProgressLike | null | undefined,
): NovelRecoveryAnchor {
  const rawPage = progress?.page
  const page =
    typeof rawPage === "number" && Number.isFinite(rawPage)
      ? Math.max(1, Math.floor(rawPage))
      : 1
  const rawOffset = progress?.offset
  const offset =
    typeof rawOffset === "number" && Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0
  const rawChunkId = progress?.chunkId
  const chunkId =
    typeof rawChunkId === "string" && rawChunkId.trim().length > 0
      ? rawChunkId.trim()
      : null
  const rawQuote = progress?.quote
  const quote =
    typeof rawQuote === "string" ? rawQuote.trim().slice(0, 240) : ""

  return quote ? { chunkId, page, offset, quote } : { chunkId, page, offset }
}
