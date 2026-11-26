import { DeviceEventEmitter, NativeModules } from "react-native"
import { decodeUtf8, encodeUtf8, polyfillAtob, PolyfillAbortController } from "./polyfills"
import { ScriptingData } from "./dataAndCrypto"

const { PixHttp, PixFileSystem } = NativeModules

let requestSeq = 1

function base64ToUint8Array(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0)
  const bin = polyfillAtob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) & 0xff
  }
  return out
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

export class ScriptingResponse {
  readonly status: number
  readonly statusText: string = ""
  readonly ok: boolean
  readonly url: string
  readonly headers: ScriptingHeaders
  private _tempFilePath?: string
  private _bodyBase64?: string
  private _byteLength: number
  readonly body: { getReader: () => any } | null

  constructor(opts: {
    status: number
    url: string
    headers: Record<string, string>
    tempFilePath?: string
    bodyBase64?: string
    byteLength: number
    streamReqId?: string
  }) {
    this.status = opts.status
    this.ok = opts.status >= 200 && opts.status < 300
    this.url = opts.url
    this.headers = new ScriptingHeaders(opts.headers)
    this._tempFilePath = opts.tempFilePath
    this._bodyBase64 = opts.bodyBase64
    this._byteLength = opts.byteLength
    this.body = opts.streamReqId ? createStreamBody(opts.streamReqId) : null
  }

  async data(): Promise<ScriptingData> {
    if (this._tempFilePath) {
      return new ScriptingData(null, this._tempFilePath, this._byteLength)
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
    return decodeUtf8(base64ToUint8Array(this._bodyBase64 ?? ""))
  }

  async json(): Promise<any> {
    return JSON.parse(await this.text())
  }
}

function createStreamBody(reqId: string) {
  return {
    getReader() {
      const queue: Array<{ done: boolean; value?: Uint8Array }> = []
      let waitingResolve: ((v: { done: boolean; value?: Uint8Array }) => void) | null = null
      let waitingReject: ((err: any) => void) | null = null
      let closed = false

      const sub = DeviceEventEmitter.addListener("PixHttpStreamChunk", (evt: any) => {
        if (!evt || evt.reqId !== reqId) return
        if (evt.error) {
          closed = true
          sub.remove()
          if (waitingReject) {
            const rej = waitingReject
            waitingResolve = null
            waitingReject = null
            rej(new Error(evt.error))
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
        const bytes = base64ToUint8Array(evt.chunkBase64 || "")
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
      })

      return {
        read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (queue.length > 0) {
            return Promise.resolve(queue.shift()!)
          }
          if (closed) {
            return Promise.resolve({ done: true, value: undefined })
          }
          return new Promise((resolve, reject) => {
            waitingResolve = resolve
            waitingReject = reject
          })
        },
        cancel(): Promise<void> {
          closed = true
          sub.remove()
          PixHttp?.abortRequest?.(reqId)
          return Promise.resolve()
        },
        releaseLock(): void {
          // no-op
        },
      }
    },
  }
}

export async function scriptingFetch(url: string, init: any = {}): Promise<ScriptingResponse> {
  if (!PixHttp) {
    throw new Error("PixHttp native module unavailable")
  }
  const signal = init?.signal
  if (signal?.aborted) {
    throw Object.assign(new Error("Aborted"), { name: "AbortError" })
  }

  const reqId = `http_${Date.now()}_${requestSeq++}`
  let unsubscribeAbort: (() => void) | undefined

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      PixHttp.abortRequest?.(reqId)
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
    for (const [k, v] of Object.entries(init.headers)) {
      if (v != null) headers[k] = String(v)
    }
  }

  let bodyStr: string | undefined
  let bodyBase64: string | undefined
  if (init?.body != null) {
    if (typeof init.body === "string") {
      bodyStr = init.body
    } else if (init.body instanceof ScriptingData) {
      bodyBase64 = init.body.toBase64String()
    } else if (init.body instanceof Uint8Array) {
      bodyBase64 = new ScriptingData(init.body).toBase64String()
    } else {
      bodyStr = String(init.body)
    }
  }

  const timeoutMs =
    typeof init?.timeout === "number" && init.timeout > 0
      ? Math.round(init.timeout * 1000)
      : 30_000

  const isStreamCandidate =
    String(init?.method || "GET").toUpperCase() === "POST" &&
    (headers["Accept"]?.includes("text/event-stream") ||
      (typeof bodyStr === "string" && bodyStr.includes('"stream":true')))

  try {
    if (isStreamCandidate) {
      const resMeta = await Promise.race([
        PixHttp.streamRequest(reqId, {
          url,
          method: init?.method || "POST",
          headers,
          body: bodyStr,
          timeoutMs,
        }),
        abortPromise,
      ])
      return new ScriptingResponse({
        status: resMeta.status,
        url: resMeta.url || url,
        headers: resMeta.headers || {},
        byteLength: 0,
        streamReqId: reqId,
      })
    }

    // Handle manual redirect inspection if handleRedirect is provided
    let currentUrl = url
    const hasRedirectHandler = typeof init?.handleRedirect === "function"
    let redirects = 0
    while (true) {
      const res = await Promise.race([
        PixHttp.request(reqId, {
          url: currentUrl,
          method: init?.method || "GET",
          headers,
          body: bodyStr,
          bodyBase64,
          timeoutMs,
          followRedirects: !hasRedirectHandler,
        }),
        abortPromise,
      ])

      if (hasRedirectHandler && res.status >= 300 && res.status < 400 && redirects < 6) {
        const loc = res.headers?.location || res.headers?.Location
        if (loc) {
          const nextUrl = new URL(loc, currentUrl).toString()
          const decision = await init.handleRedirect({ url: nextUrl })
          if (!decision) {
            throw new Error("Blocked unexpected redirect")
          }
          currentUrl = decision.url || nextUrl
          redirects++
          continue
        }
      }

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
    if (err?.code === "AbortError" || err?.name === "AbortError") {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" })
    }
    if (err?.code === "TimeoutError" || err?.name === "TimeoutError") {
      throw Object.assign(new Error(err.message || "Request timed out"), { name: "TimeoutError" })
    }
    throw err
  } finally {
    unsubscribeAbort?.()
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
