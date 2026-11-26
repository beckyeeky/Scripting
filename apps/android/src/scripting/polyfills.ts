// Spec-compliant polyfills for Hermes / React Native:
// URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, AbortController.

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function polyfillAtob(input: string): string {
  const str = String(input).replace(/[\t\n\f\r ]+/g, "").replace(/=+$/, "")
  if (str.length % 4 === 1) {
    throw new Error("Invalid base64 string")
  }
  let output = ""
  let bc = 0
  let bs = 0
  let buffer: number
  for (let i = 0; i < str.length; i++) {
    buffer = B64_CHARS.indexOf(str.charAt(i))
    if (buffer === -1) throw new Error("Invalid base64 character")
    bs = bc % 4 ? bs * 64 + buffer : buffer
    if (bc++ % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))
    }
  }
  return output
}

export function polyfillBtoa(input: string): string {
  const str = String(input)
  let output = ""
  for (let block = 0, charCode = 0, idx = 0, map = B64_CHARS; str.charAt(idx | 0) || ((map = "="), idx % 1); output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))) {
    charCode = str.charCodeAt((idx += 3 / 4))
    if (charCode > 0xff) {
      throw new Error("btoa failed: character out of Latin1 range")
    }
    block = (block << 8) | charCode
  }
  return output
}

export function encodeUtf8(str: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        )
        i++
      } else {
        out.push(0xef, 0xbf, 0xbd)
      }
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(out)
}

export function decodeUtf8(bytes: Uint8Array): string {
  let out = ""
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i++]
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++] & 0x3f
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1)
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++] & 0x3f
      const b2 = bytes[i++] & 0x3f
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2)
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++] & 0x3f
      const b2 = bytes[i++] & 0x3f
      const b3 = bytes[i++] & 0x3f
      const cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += "\uFFFD"
    }
  }
  return out
}

export class PolyfillTextEncoder {
  readonly encoding = "utf-8"
  encode(input = ""): Uint8Array {
    return encodeUtf8(String(input))
  }
}

export class PolyfillTextDecoder {
  readonly encoding = "utf-8"
  decode(input?: ArrayBuffer | ArrayBufferView | null): string {
    if (!input) return ""
    if (input instanceof Uint8Array) return decodeUtf8(input)
    if (ArrayBuffer.isView(input)) {
      return decodeUtf8(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
    }
    return decodeUtf8(new Uint8Array(input))
  }
}

export class PolyfillURLSearchParams {
  private entriesList: Array<[string, string]> = []
  private onChange?: () => void

  constructor(
    init?: string | Record<string, string> | Array<[string, string]> | PolyfillURLSearchParams,
    onChange?: () => void,
  ) {
    this.onChange = onChange
    if (typeof init === "string") {
      const clean = init.startsWith("?") ? init.slice(1) : init
      if (clean.length > 0) {
        for (const pair of clean.split("&")) {
          if (!pair) continue
          const eqIdx = pair.indexOf("=")
          const k = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair
          const v = eqIdx >= 0 ? pair.slice(eqIdx + 1) : ""
          this.entriesList.push([decodeComponent(k), decodeComponent(v)])
        }
      }
    } else if (init instanceof PolyfillURLSearchParams) {
      this.entriesList = init.entriesList.map(([k, v]) => [k, v])
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) {
        this.entriesList.push([String(k), String(v)])
      }
    } else if (init && typeof init === "object") {
      for (const [k, v] of Object.entries(init)) {
        this.entriesList.push([String(k), String(v)])
      }
    }
  }

  _replaceFromRaw(raw: string): void {
    this.entriesList = []
    const clean = raw.startsWith("?") ? raw.slice(1) : raw
    if (!clean) return
    for (const pair of clean.split("&")) {
      if (!pair) continue
      const eqIdx = pair.indexOf("=")
      const k = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair
      const v = eqIdx >= 0 ? pair.slice(eqIdx + 1) : ""
      this.entriesList.push([decodeComponent(k), decodeComponent(v)])
    }
  }

  append(name: string, value: string): void {
    this.entriesList.push([String(name), String(value)])
    this.onChange?.()
  }

  delete(name: string): void {
    const key = String(name)
    this.entriesList = this.entriesList.filter(([k]) => k !== key)
    this.onChange?.()
  }

  get(name: string): string | null {
    const key = String(name)
    for (const [k, v] of this.entriesList) {
      if (k === key) return v
    }
    return null
  }

  getAll(name: string): string[] {
    const key = String(name)
    return this.entriesList.filter(([k]) => k === key).map(([, v]) => v)
  }

  has(name: string): boolean {
    const key = String(name)
    return this.entriesList.some(([k]) => k === key)
  }

  set(name: string, value: string): void {
    const key = String(name)
    const val = String(value)
    let replaced = false
    const next: Array<[string, string]> = []
    for (const [k, v] of this.entriesList) {
      if (k === key) {
        if (!replaced) {
          next.push([key, val])
          replaced = true
        }
      } else {
        next.push([k, v])
      }
    }
    if (!replaced) next.push([key, val])
    this.entriesList = next
    this.onChange?.()
  }

  forEach(cb: (value: string, key: string, parent: PolyfillURLSearchParams) => void): void {
    for (const [k, v] of this.entriesList) {
      cb(v, k, this)
    }
  }

  *entries(): IterableIterator<[string, string]> {
    for (const entry of this.entriesList) yield entry
  }

  *keys(): IterableIterator<string> {
    for (const [k] of this.entriesList) yield k
  }

  *values(): IterableIterator<string> {
    for (const [, v] of this.entriesList) yield v
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }

  toString(): string {
    return this.entriesList
      .map(([k, v]) => `${encodeSearchPart(k)}=${encodeSearchPart(v)}`)
      .join("&")
  }
}

function decodeComponent(str: string): string {
  const plusReplaced = str.replace(/\+/g, " ")
  try {
    return decodeURIComponent(plusReplaced)
  } catch {
    return plusReplaced
  }
}

function encodeSearchPart(str: string): string {
  return encodeURIComponent(str).replace(/%20/g, "+")
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "ws:": "80",
  "wss:": "443",
}

const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/

export class PolyfillURL {
  protocol: string = ""
  private _username: string = ""
  private _password: string = ""
  hostname: string = ""
  port: string = ""
  pathname: string = "/"
  private _search: string = ""
  hash: string = ""
  readonly searchParams: PolyfillURLSearchParams

  constructor(url: string, base?: string | PolyfillURL) {
    let input = String(url).trim()
    if (base !== undefined) {
      const baseUrl = base instanceof PolyfillURL ? base : new PolyfillURL(String(base))
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
        if (input.startsWith("//")) {
          input = `${baseUrl.protocol}${input}`
        } else if (input.startsWith("/")) {
          input = `${baseUrl.protocol}//${baseUrl.host}${input}`
        } else if (input.startsWith("?")) {
          input = `${baseUrl.protocol}//${baseUrl.host}${baseUrl.pathname}${input}`
        } else if (input.startsWith("#")) {
          input = `${baseUrl.protocol}//${baseUrl.host}${baseUrl.pathname}${baseUrl.search}${input}`
        } else {
          const dir = baseUrl.pathname.replace(/\/[^/]*$/, "/")
          input = `${baseUrl.protocol}//${baseUrl.host}${dir}${input}`
        }
      }
    }

    const match = URL_RE.exec(input)
    if (!match) {
      throw new TypeError(`Invalid URL: ${url}`)
    }

    this.protocol = match[1].toLowerCase()
    const authority = match[2]
    const rawPath = match[3] || ""
    this._search = match[4] && match[4] !== "?" ? match[4] : ""
    this.hash = match[5] && match[5] !== "#" ? match[5] : ""

    if (authority !== undefined) {
      let hostPort = authority
      const atIdx = authority.lastIndexOf("@")
      if (atIdx >= 0) {
        const userInfo = authority.slice(0, atIdx)
        hostPort = authority.slice(atIdx + 1)
        const colonIdx = userInfo.indexOf(":")
        if (colonIdx >= 0) {
          this._username = userInfo.slice(0, colonIdx)
          this._password = userInfo.slice(colonIdx + 1)
        } else {
          this._username = userInfo
        }
      }

      if (hostPort.startsWith("[")) {
        const closeBracket = hostPort.indexOf("]")
        if (closeBracket < 0) throw new TypeError(`Invalid IPv6 host in URL: ${url}`)
        this.hostname = hostPort.slice(0, closeBracket + 1).toLowerCase()
        const rest = hostPort.slice(closeBracket + 1)
        if (rest.startsWith(":")) this.port = rest.slice(1)
      } else {
        const colonIdx = hostPort.lastIndexOf(":")
        if (colonIdx >= 0) {
          this.hostname = hostPort.slice(0, colonIdx).toLowerCase()
          this.port = hostPort.slice(colonIdx + 1)
        } else {
          this.hostname = hostPort.toLowerCase()
        }
      }

      if (this.port && DEFAULT_PORTS[this.protocol] === this.port) {
        this.port = ""
      }
      this.pathname = rawPath ? normalizePathname(rawPath) : "/"
    } else {
      this.pathname = rawPath || ""
    }

    this.searchParams = new PolyfillURLSearchParams(this._search, () => {
      const s = this.searchParams.toString()
      this._search = s ? `?${s}` : ""
    })
  }

  get username(): string {
    return this._username
  }
  set username(v: string) {
    this._username = String(v ?? "")
  }

  get password(): string {
    return this._password
  }
  set password(v: string) {
    this._password = String(v ?? "")
  }

  get host(): string {
    return this.port ? `${this.hostname}:${this.port}` : this.hostname
  }

  get origin(): string {
    if (this.protocol === "http:" || this.protocol === "https:" || this.protocol === "ws:" || this.protocol === "wss:") {
      return `${this.protocol}//${this.host}`
    }
    return "null"
  }

  get search(): string {
    return this._search
  }
  set search(v: string) {
    const clean = String(v ?? "")
    this._search = clean && clean !== "?" ? (clean.startsWith("?") ? clean : `?${clean}`) : ""
    this.searchParams._replaceFromRaw(this._search)
  }

  get href(): string {
    const auth = this._username || this._password
      ? `${this._username}${this._password ? `:${this._password}` : ""}@`
      : ""
    const hasAuthority = this.hostname.length > 0 || this.protocol === "http:" || this.protocol === "https:" || this.protocol === "pixiv:"
    const authority = hasAuthority ? `//${auth}${this.host}` : ""
    return `${this.protocol}${authority}${this.pathname}${this._search}${this.hash}`
  }

  toString(): string {
    return this.href
  }

  toJSON(): string {
    return this.href
  }
}

function normalizePathname(raw: string): string {
  const parts = raw.split("/")
  const stack: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === "..") {
      if (stack.length > 1) stack.pop()
    } else if (p !== ".") {
      stack.push(p)
    }
  }
  const joined = stack.join("/")
  return joined.startsWith("/") ? joined : `/${joined}`
}

export class PolyfillAbortSignal {
  aborted = false
  reason: any = undefined
  private listeners = new Set<() => void>()

  addEventListener(type: string, listener: () => void): void {
    if (type === "abort") this.listeners.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === "abort") this.listeners.delete(listener)
  }
  onAbort(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  _triggerAbort(reason?: any): void {
    if (this.aborted) return
    this.aborted = true
    this.reason = reason ?? Object.assign(new Error("Aborted"), { name: "AbortError" })
    for (const fn of Array.from(this.listeners)) {
      try {
        fn()
      } catch {}
    }
  }
}

export class PolyfillAbortController {
  readonly signal = new PolyfillAbortSignal()
  abort(reason?: any): void {
    this.signal._triggerAbort(reason)
  }
}

export function installPolyfills(target: Record<string, any> = globalThis as any): void {
  target.URL = PolyfillURL
  target.URLSearchParams = PolyfillURLSearchParams
  if (typeof target.TextEncoder === "undefined") target.TextEncoder = PolyfillTextEncoder
  if (typeof target.TextDecoder === "undefined") target.TextDecoder = PolyfillTextDecoder
  if (typeof target.atob === "undefined") target.atob = polyfillAtob
  if (typeof target.btoa === "undefined") target.btoa = polyfillBtoa
  if (typeof target.AbortController === "undefined") target.AbortController = PolyfillAbortController
  if (typeof target.AbortSignal === "undefined") target.AbortSignal = PolyfillAbortSignal
}

installPolyfills()
