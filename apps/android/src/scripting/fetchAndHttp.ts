import { DeviceEventEmitter, NativeModules } from "react-native"
import { decodeUtf8, encodeUtf8 } from "./polyfills"
import { base64ToBytes, bytesToBase64, ScriptingData } from "./dataAndCrypto"
import { recordDiagnosticError } from "./diagnostics"

const { PixHttp, PixFileSystem } = NativeModules

let requestSeq = 1

function describeRequestTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`.slice(0, 200)
  } catch {
    return String(url || "").replace(/[?#].*$/, "").slice(0, 200)
  }
}

function recordHttpFailure(method: string, url: string, status: number): void {
  if (!Number.isFinite(status) || status < 400) return
  recordDiagnosticError({
    kind: "http",
    code: `HTTP_${status}`,
    message: `${method} ${describeRequestTarget(url)} → ${status}`,
  })
}

function getHeaderIgnoreCase(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function deleteHeaderIgnoreCase(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      delete headers[k]
    }
  }
}

function escapeHeaderParam(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ").replace(/"/g, '\\"')
}

export class ScriptingHeaders {
  private map = new Map<string, string>()

  constructor(init?: Record<string, string> | Array<[string, string]> | ScriptingHeaders) {
    if (init instanceof ScriptingHeaders) {
      init.map.forEach((v, k) => this.map.set(k, v))
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) this.map.set(k.toLowerCase(), String(v))
    } else if (init && typeof init === "object") {
      for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), String(v))
    }
  }

  get(name: string): string | null {
    return this.map.get(String(name).toLowerCase()) ?? null
  }
  has(name: string): boolean {
    return this.map.has(String(name).toLowerCase())
  }
  set(name: string, value: string): void {
    this.map.set(String(name).toLowerCase(), String(value))
  }
  entries(): IterableIterator<[string, string]> {
    return this.map.entries()
  }
}

export class ScriptingFormData {
  private fields: Array<[string, any, ...any[]]> = []
  append(name: string, value: any, ...extra: any[]): void {
    this.fields.push([String(name), value, ...extra])
  }
  entries(): Array<[string, any, ...any[]]> {
    return this.fields
  }
}

export function serializeFormData(formData: ScriptingFormData): {
  contentType: string
  bytes: Uint8Array
} {
  const boundary = `----PixScriptingBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  const parts: Uint8Array[] = []
  let totalLen = 0

  const pushBytes = (u8: Uint8Array) => {
    parts.push(u8)
    totalLen += u8.byteLength
  }
  const pushStr = (s: string) => pushBytes(encodeUtf8(s))

  for (const [name, value, arg2, arg3] of formData.entries()) {
    pushStr(`--${boundary}\r\n`)
    const safeName = escapeHeaderParam(name)

    let binaryBytes: Uint8Array | null = null
    if (value instanceof ScriptingData) {
      binaryBytes = value.toUint8Array()
    } else if (value instanceof Uint8Array) {
      binaryBytes = value
    } else if (value && typeof value.toUint8Array === "function") {
      binaryBytes = value.toUint8Array()
    }

    if (binaryBytes) {
      // Scripting convention: append(name, data, mimeType, fileName)
      // Standard FormData convention: append(name, blob, fileName)
      let mimeType = "application/octet-stream"
      let fileName = "blob"
      if (typeof arg2 === "string" && typeof arg3 === "string") {
        mimeType = arg2 || mimeType
        fileName = arg3 || fileName
      } else if (typeof arg2 === "string") {
        if (arg2.includes("/") && !arg2.includes(".")) {
          mimeType = arg2
        } else {
          fileName = arg2
        }
      }
      pushStr(
        `Content-Disposition: form-data; name="${safeName}"; filename="${escapeHeaderParam(fileName)}"\r\n` +
          `Content-Type: ${mimeType.replace(/[\r\n]+/g, "")}\r\n\r\n`,
      )
      pushBytes(binaryBytes)
      pushStr("\r\n")
    } else {
      pushStr(`Content-Disposition: form-data; name="${safeName}"\r\n\r\n`)
      pushStr(String(value ?? ""))
      pushStr("\r\n")
    }
  }

  pushStr(`--${boundary}--\r\n`)

  const out = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of parts) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    bytes: out,
  }
}

interface StreamChannel {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>
    cancel: (reason?: any) => Promise<void>
    releaseLock: () => void
  }
  readAllBytes: () => Promise<Uint8Array>
  dispose: () => void
}

function createStreamChannel(reqId: string): StreamChannel {
  const queue: Array<{ done: boolean; value?: Uint8Array }> = []
  let waitingResolve: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null
  let waitingReject: ((err: any) => void) | null = null
  let terminalError: Error | null = null
  let closed = false

  const sub = DeviceEventEmitter.addListener("PixHttpStreamChunk", (evt: any) => {
    if (!evt || evt.reqId !== reqId) return

    if (evt.error) {
      const err = new Error(String(evt.error))
      closed = true
      sub.remove()
      if (waitingReject) {
        const rej = waitingReject
        waitingResolve = null
        waitingReject = null
        rej(err)
      } else {
        terminalError = err
      }
      return
    }

    if (evt.done) {
      closed = true
      sub.remove()
      const item = { done: true as const, value: undefined }
      if (waitingResolve) {
        const res = waitingResolve
        waitingResolve = null
        waitingReject = null
        res(item)
      } else {
        queue.push(item)
      }
      return
    }

    if (evt.chunkBase64) {
      const bytes = base64ToBytes(evt.chunkBase64)
      if (bytes.length > 0) {
        const item = { done: false as const, value: bytes }
        if (waitingResolve) {
          const res = waitingResolve
          waitingResolve = null
          waitingReject = null
          res(item)
        } else {
          queue.push(item)
        }
      }
    }
  })

  const readNext = (): Promise<{ done: boolean; value?: Uint8Array }> => {
    if (queue.length > 0) {
      const item = queue.shift()!
      if (item.done && terminalError) {
        const err = terminalError
        terminalError = null
        return Promise.reject(err)
      }
      return Promise.resolve(item)
    }
    if (terminalError) {
      const err = terminalError
      terminalError = null
      return Promise.reject(err)
    }
    if (closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    return new Promise((resolve, reject) => {
      waitingResolve = resolve
      waitingReject = reject
    })
  }

  const dispose = () => {
    closed = true
    sub.remove()
    if (waitingResolve) {
      const res = waitingResolve
      waitingResolve = null
      waitingReject = null
      res({ done: true, value: undefined })
    }
  }

  return {
    getReader() {
      return {
        read: readNext,
        cancel(): Promise<void> {
          dispose()
          PixHttp?.abortRequest?.(reqId)
          return Promise.resolve()
        },
        releaseLock(): void {
          // no-op
        },
      }
    },
    async readAllBytes(): Promise<Uint8Array> {
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await readNext()
        if (done) break
        if (value && value.byteLength > 0) {
          chunks.push(value)
          total += value.byteLength
        }
      }
      const out = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.byteLength
      }
      return out
    },
    dispose,
  }
}

export class ScriptingResponse {
  readonly status: number
  readonly statusText: string = ""
  readonly ok: boolean
  readonly url: string
  readonly headers: ScriptingHeaders
  private _tempFilePath?: string
  private _bodyBase64?: string
  private _byteLength: number
  private _streamChannel?: StreamChannel
  readonly body: { getReader: () => any } | null

  constructor(opts: {
    status: number
    url: string
    headers: Record<string, string>
    tempFilePath?: string
    bodyBase64?: string
    byteLength: number
    streamChannel?: StreamChannel
  }) {
    this.status = opts.status
    this.ok = opts.status >= 200 && opts.status < 300
    this.url = opts.url
    this.headers = new ScriptingHeaders(opts.headers)
    this._tempFilePath = opts.tempFilePath
    this._bodyBase64 = opts.bodyBase64
    this._byteLength = opts.byteLength
    this._streamChannel = opts.streamChannel
    this.body = opts.streamChannel ? { getReader: () => opts.streamChannel!.getReader() } : null
  }

  async data(): Promise<ScriptingData> {
    if (this._tempFilePath) {
      return new ScriptingData(null, this._tempFilePath, this._byteLength)
    }
    if (this._streamChannel) {
      const bytes = await this._streamChannel.readAllBytes()
      this._streamChannel = undefined
      return new ScriptingData(bytes)
    }
    return ScriptingData.fromBase64String(this._bodyBase64 ?? "") ?? new ScriptingData(new Uint8Array(0))
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.data()).toArrayBuffer()
  }

  async text(): Promise<string> {
    if (this._tempFilePath && PixFileSystem) {
      const str = PixFileSystem.fsReadStringSync(this._tempFilePath)
      if (typeof str === "string") return str
    }
    if (this._streamChannel) {
      const bytes = await this._streamChannel.readAllBytes()
      this._streamChannel = undefined
      return decodeUtf8(bytes)
    }
    return decodeUtf8(base64ToBytes(this._bodyBase64 ?? ""))
  }

  async json(): Promise<any> {
    return JSON.parse(await this.text())
  }
}

export function isStreamCandidateRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyStr?: string,
): boolean {
  if (String(method || "GET").toUpperCase() !== "POST") return false
  const accept = getHeaderIgnoreCase(headers, "accept") || ""
  if (accept.toLowerCase().includes("text/event-stream")) return true
  if (typeof bodyStr === "string" && /"stream"\s*:\s*true/.test(bodyStr)) return true
  if (/[?&]alt=sse(?:&|$)/i.test(url) || /:streamGenerateContent(?:[/?#]|$)/i.test(url)) return true
  return false
}

export async function scriptingFetch(url: string, init: any = {}): Promise<ScriptingResponse> {
  if (!PixHttp) {
    recordDiagnosticError({
      kind: "http",
      code: "HTTP_BRIDGE_MISSING",
      message: "PixHttp native module unavailable",
    })
    throw new Error("PixHttp native module unavailable")
  }
  const signal = init?.signal
  if (signal?.aborted) {
    throw Object.assign(new Error("Aborted"), { name: "AbortError" })
  }

  const baseReqId = `http_${Date.now()}_${requestSeq++}`
  let activeReqId = baseReqId
  let unsubscribeAbort: (() => void) | undefined

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      PixHttp.abortRequest?.(activeReqId)
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
    }
    if (signal) {
      if (typeof signal.onAbort === "function") {
        unsubscribeAbort = signal.onAbort(onAbort)
      } else if (typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort)
        unsubscribeAbort = () => signal.removeEventListener("abort", onAbort)
      }
    }
  })

  const headers: Record<string, string> = {}
  if (init?.headers) {
    if (init.headers instanceof ScriptingHeaders) {
      for (const [k, v] of init.headers.entries()) {
        headers[k] = v
      }
    } else {
      for (const [k, v] of Object.entries(init.headers)) {
        if (v != null) headers[k] = String(v)
      }
    }
  }

  let bodyStr: string | undefined
  let bodyBase64: string | undefined
  if (init?.body != null) {
    if (init.body instanceof ScriptingFormData || typeof init.body?.entries === "function") {
      const serialized = serializeFormData(init.body)
      bodyBase64 = bytesToBase64(serialized.bytes)
      deleteHeaderIgnoreCase(headers, "content-type")
      headers["Content-Type"] = serialized.contentType
    } else if (typeof init.body === "string") {
      bodyStr = init.body
    } else if (init.body instanceof ScriptingData) {
      bodyBase64 = init.body.toBase64String()
    } else if (init.body instanceof Uint8Array) {
      bodyBase64 = bytesToBase64(init.body)
    } else if (init.body instanceof ArrayBuffer) {
      bodyBase64 = bytesToBase64(new Uint8Array(init.body))
    } else {
      bodyStr = String(init.body)
    }
  }

  const method = String(init?.method || "GET").toUpperCase()
  const isStreamCandidate = isStreamCandidateRequest(url, method, headers, bodyStr)

  const timeoutMs =
    typeof init?.timeout === "number" && init.timeout > 0
      ? Math.round(init.timeout * 1000)
      : isStreamCandidate
        ? 180_000
        : 30_000

  try {
    if (isStreamCandidate) {
      // Subscribe BEFORE starting native streamRequest so zero initial chunks or errors are lost
      const channel = createStreamChannel(activeReqId)
      try {
        const resMeta = await Promise.race([
          PixHttp.streamRequest(activeReqId, {
            url,
            method,
            headers,
            body: bodyStr,
            bodyBase64,
            timeoutMs,
          }),
          abortPromise,
        ])
        if (resMeta?.isStream === false) {
          channel.dispose()
          recordHttpFailure(method, resMeta.url || url, resMeta.status)
          return new ScriptingResponse({
            status: resMeta.status,
            url: resMeta.url || url,
            headers: resMeta.headers || {},
            tempFilePath: resMeta.tempFilePath,
            bodyBase64: resMeta.bodyBase64,
            byteLength: resMeta.byteLength || 0,
          })
        }
        return new ScriptingResponse({
          status: resMeta.status,
          url: resMeta.url || url,
          headers: resMeta.headers || {},
          byteLength: 0,
          streamChannel: channel,
        })
      } catch (err) {
        channel.dispose()
        throw err
      }
    }

    // Handle manual redirect inspection if handleRedirect is provided
    let currentUrl = url
    let currentMethod = method
    let currentHeaders = { ...headers }
    let currentBodyStr = bodyStr
    let currentBodyBase64 = bodyBase64
    const hasRedirectHandler = typeof init?.handleRedirect === "function"
    let redirects = 0

    while (true) {
      activeReqId = redirects === 0 ? baseReqId : `${baseReqId}_r${redirects}`
      const res = await Promise.race([
        PixHttp.request(activeReqId, {
          url: currentUrl,
          method: currentMethod,
          headers: currentHeaders,
          body: currentBodyStr,
          bodyBase64: currentBodyBase64,
          timeoutMs,
          followRedirects: !hasRedirectHandler,
        }),
        abortPromise,
      ])

      if (hasRedirectHandler && res.status >= 300 && res.status < 400 && redirects < 6) {
        const loc = res.headers?.location || res.headers?.Location
        if (loc) {
          if (res.tempFilePath) {
            try {
              PixFileSystem?.fsRemoveSync?.(res.tempFilePath)
            } catch {}
          }
          const nextUrl = new URL(loc, currentUrl).toString()
          const decision = await init.handleRedirect({ url: nextUrl })
          if (!decision) {
            throw new Error("Blocked unexpected redirect")
          }
          const resolvedUrl = decision.url || nextUrl
          try {
            if (new URL(resolvedUrl).origin !== new URL(currentUrl).origin) {
              deleteHeaderIgnoreCase(currentHeaders, "authorization")
              deleteHeaderIgnoreCase(currentHeaders, "cookie")
            }
          } catch {}
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
            currentMethod = "GET"
            currentBodyStr = undefined
            currentBodyBase64 = undefined
            deleteHeaderIgnoreCase(currentHeaders, "content-type")
            deleteHeaderIgnoreCase(currentHeaders, "content-length")
          }
          currentUrl = resolvedUrl
          redirects++
          continue
        }
      }

      recordHttpFailure(currentMethod, res.url || currentUrl, res.status)
      return new ScriptingResponse({
        status: res.status,
        url: res.url || currentUrl,
        headers: res.headers || {},
        tempFilePath: res.tempFilePath,
        bodyBase64: res.bodyBase64,
        byteLength: res.byteLength || 0,
      })
    }
  } catch (err: any) {
    const aborted = err?.code === "AbortError" || err?.name === "AbortError"
    if (aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" })
    }
    const timedOut = err?.code === "TimeoutError" || err?.name === "TimeoutError"
    recordDiagnosticError({
      kind: "http",
      code: timedOut ? "HTTP_TIMEOUT" : String(err?.code || err?.name || "HTTP_NETWORK_ERROR"),
      message: `${method} ${describeRequestTarget(url)}: ${err?.message ?? String(err)}`,
    })
    if (timedOut) {
      throw Object.assign(new Error(err.message || "Request timed out"), { name: "TimeoutError" })
    }
    throw err
  } finally {
    unsubscribeAbort?.()
  }
}
