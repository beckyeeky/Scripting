/**
 * Pure helpers for the "网页登录同步 Web Cookie" flow.
 *
 * The native dialog returns one raw cookie string per visited host (plus a
 * legacy merged `cookieHeader`). Merging happens here so the precedence is
 * explicit and covered by node tests:
 *
 *   1. the configured Web / reverse-proxy origin (what the app actually calls)
 *   2. the default Pixiv web hosts
 *   3. any other host the dialog collected cookies from
 *
 * A single `Cookie` header cannot carry two values for the same name, so the
 * highest-priority host wins on conflicts. This keeps a reverse-proxy session
 * from being overwritten by `accounts.pixiv.net` cookies (and vice versa).
 */

export type NativeCookieEntry = {
  url?: string
  host?: string
  cookie?: string
}

export type WebCookieSyncResult = {
  cancelled?: boolean
  cookieHeader?: string
  cookies?: NativeCookieEntry[]
  redirectUrl?: string
}

export type WebCookieSyncOutcome =
  | {
      status: "synced"
      cookieHeader: string
      via: "finish" | "dismiss"
      hasSessionCookie: boolean
    }
  | { status: "cancelled" }
  | { status: "empty" }

export const PIXIV_WEB_COOKIE_HOSTS: ReadonlyArray<string> = [
  "https://www.pixiv.net",
  "https://app-api.pixiv.net",
  "https://accounts.pixiv.net",
]

/** Normalizes a URL or bare host to an http(s) origin, or "" when unusable. */
export function normalizeCookieHost(value: string | null | undefined): string {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    if (!url.hostname) return ""
    return url.origin
  } catch {
    return ""
  }
}

/**
 * Host list passed to the native dialog as `extraCookieHosts`.
 * The configured Web base goes first so its cookies win on name conflicts.
 */
export function buildCookieHostList(
  webBase: string | null | undefined,
  extraHosts: ReadonlyArray<string> = [],
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const push = (value: string | null | undefined) => {
    const origin = normalizeCookieHost(value)
    if (!origin) return
    const key = origin.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(origin)
  }
  push(webBase)
  for (const host of extraHosts) push(host)
  for (const host of PIXIV_WEB_COOKIE_HOSTS) push(host)
  return result
}

/** Parses a raw `a=b; c=d` header into ordered name/value pairs. */
export function parseCookiePairs(
  header: string | null | undefined,
): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = []
  for (const part of String(header ?? "").split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    if (!name) continue
    pairs.push({ name, value: trimmed.slice(eq + 1).trim() })
  }
  return pairs
}

/** Rebuilds a header, keeping the last occurrence of duplicated names. */
export function normalizeCookieHeader(header: string | null | undefined): string {
  const merged = new Map<string, string>()
  for (const pair of parseCookiePairs(header)) merged.set(pair.name, pair.value)
  return Array.from(merged, ([name, value]) => `${name}=${value}`).join("; ")
}

/**
 * Merges per-host cookie strings into one `Cookie` header.
 * Hosts earlier in `preferredHosts` win on duplicate cookie names.
 */
export function mergeCookieEntries(
  entries: ReadonlyArray<NativeCookieEntry> | null | undefined,
  preferredHosts: ReadonlyArray<string>,
): string {
  const priority = new Map<string, number>()
  for (const host of preferredHosts) {
    const origin = normalizeCookieHost(host)
    if (origin && !priority.has(origin)) priority.set(origin, priority.size)
  }
  const fallback = priority.size
  const ranked = (entries ?? [])
    .map((entry, index) => {
      const origin = normalizeCookieHost(entry?.url ?? entry?.host ?? "")
      const rank = origin && priority.has(origin) ? (priority.get(origin) as number) : fallback
      return { entry, origin, index, rank }
    })
    .filter((it) => Boolean(it.origin) && typeof it.entry.cookie === "string" && it.entry.cookie.trim() !== "")
    .sort((a, b) => a.rank - b.rank || a.index - b.index)

  const merged = new Map<string, string>()
  for (const item of ranked) {
    for (const pair of parseCookiePairs(item.entry.cookie)) {
      if (!merged.has(pair.name)) merged.set(pair.name, pair.value)
    }
  }
  return Array.from(merged, ([name, value]) => `${name}=${value}`).join("; ")
}

/** Prefers structured per-host cookies; falls back to the legacy merged header. */
export function pickCookieHeaderFromResult(
  result: WebCookieSyncResult | null | undefined,
  webBase: string | null | undefined,
): string {
  const entries = Array.isArray(result?.cookies) ? result.cookies : []
  const fromEntries = mergeCookieEntries(entries, buildCookieHostList(webBase))
  if (fromEntries) return fromEntries
  return normalizeCookieHeader(result?.cookieHeader)
}

/** Pixiv's Web session cookie; without it the header is almost certainly anonymous. */
export function hasPixivSessionCookie(header: string | null | undefined): boolean {
  return parseCookiePairs(header).some((pair) => pair.name === "PHPSESSID" && pair.value !== "")
}

/**
 * Turns the native result into an actionable outcome.
 *
 * Closing the dialog is still a cancellation (`via: "dismiss"`), but any
 * cookies captured before closing are returned instead of discarded — that is
 * the P0 fix for reverse-proxy domains that `syncWebCookies()` cannot see.
 */
export function resolveWebCookieSyncResult(
  result: WebCookieSyncResult | null | undefined,
  webBase: string | null | undefined,
): WebCookieSyncOutcome {
  const cookieHeader = pickCookieHeaderFromResult(result, webBase)
  if (cookieHeader) {
    return {
      status: "synced",
      cookieHeader,
      via: result?.cancelled ? "dismiss" : "finish",
      hasSessionCookie: hasPixivSessionCookie(cookieHeader),
    }
  }
  return result?.cancelled ? { status: "cancelled" } : { status: "empty" }
}
