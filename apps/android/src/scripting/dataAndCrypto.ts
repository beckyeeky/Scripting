import { decodeUtf8, encodeUtf8, polyfillAtob, polyfillBtoa } from "./polyfills"

export interface NativeFsBridge {
  fsReadBase64Sync(path: string): string | null
  fsReadStringSync(path: string): string | null
  fsWriteBase64Sync(path: string, base64: string): boolean
  fsWriteFromFileSync(srcPath: string, destPath: string, move: boolean): boolean
}

let nativeFsBridge: NativeFsBridge | null = null

export function setNativeFsBridgeForData(bridge: NativeFsBridge | null): void {
  nativeFsBridge = bridge
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const chunk = 0x4000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    for (let j = 0; j < slice.length; j++) {
      bin += String.fromCharCode(slice[j])
    }
  }
  return polyfillBtoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = polyfillAtob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) & 0xff
  }
  return out
}

export class ScriptingData {
  private _bytes: Uint8Array | null
  readonly _backingFilePath?: string
  readonly _length: number

  constructor(bytes: Uint8Array | null, backingFilePath?: string, knownLength?: number) {
    this._bytes = bytes
    this._backingFilePath = backingFilePath
    this._length = bytes ? bytes.byteLength : (knownLength ?? 0)
  }

  private ensureBytes(): Uint8Array {
    if (this._bytes) return this._bytes
    if (this._backingFilePath && nativeFsBridge) {
      const b64 = nativeFsBridge.fsReadBase64Sync(this._backingFilePath)
      if (b64 != null) {
        this._bytes = base64ToBytes(b64)
        return this._bytes
      }
    }
    this._bytes = new Uint8Array(0)
    return this._bytes
  }

  get length(): number {
    return this._bytes ? this._bytes.byteLength : this._length
  }

  get size(): number {
    return this.length
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.ensureBytes())
  }

  toArrayBuffer(): ArrayBuffer {
    const u8 = this.ensureBytes()
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  }

  toRawString(): string {
    return decodeUtf8(this.ensureBytes())
  }

  toBase64String(): string {
    return bytesToBase64(this.ensureBytes())
  }

  toHexString(): string {
    const u8 = this.ensureBytes()
    let hex = ""
    for (let i = 0; i < u8.length; i++) {
      hex += u8[i].toString(16).padStart(2, "0")
    }
    return hex
  }

  slice(start?: number, end?: number): ScriptingData {
    return new ScriptingData(this.ensureBytes().slice(start, end))
  }

  static fromRawString(str: string): ScriptingData | null {
    if (typeof str !== "string") return null
    return new ScriptingData(encodeUtf8(str))
  }

  static fromString(str: string): ScriptingData | null {
    return ScriptingData.fromRawString(str)
  }

  static fromBase64String(b64: string): ScriptingData | null {
    if (typeof b64 !== "string") return null
    try {
      return new ScriptingData(base64ToBytes(b64))
    } catch {
      return null
    }
  }

  static fromArrayBuffer(buf: ArrayBuffer | ArrayBufferView): ScriptingData {
    if (buf instanceof ArrayBuffer) {
      return new ScriptingData(new Uint8Array(buf.slice(0)))
    }
    return new ScriptingData(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
  }

  static fromUint8Array(arr: Uint8Array): ScriptingData {
    return new ScriptingData(new Uint8Array(arr))
  }

  static fromFile(path: string): ScriptingData | null {
    if (!nativeFsBridge || !path) return null
    const b64 = nativeFsBridge.fsReadBase64Sync(path)
    if (b64 == null) return null
    return new ScriptingData(base64ToBytes(b64), path)
  }

  static fromJPEG(img: any, _quality?: number): ScriptingData | null {
    if (!img) return null
    if (typeof img.toJPEGBase64String === "function") {
      const b64 = img.toJPEGBase64String()
      return b64 ? ScriptingData.fromBase64String(b64) : null
    }
    return null
  }
}

// Pure-TypeScript RFC 1321 MD5
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
const MD5_K = new Uint32Array(64)
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
}

export function md5Bytes(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8
  const padLen = ((input.length + 8) >> 6) * 64 + 64
  const msg = new Uint8Array(padLen)
  msg.set(input)
  msg[input.length] = 0x80
  const view = new DataView(msg.buffer)
  view.setUint32(padLen - 8, bitLen >>> 0, true)
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true)

  let a0 = 0x67452301 >>> 0
  let b0 = 0xefcdab89 >>> 0
  let c0 = 0x98badcfe >>> 0
  let d0 = 0x10325476 >>> 0

  for (let offset = 0; offset < padLen; offset += 64) {
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i++) {
      let F = 0
      let g = 0
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      const word = view.getUint32(offset + g * 4, true)
      const temp = (F + A + MD5_K[i] + word) >>> 0
      A = D
      D = C
      C = B
      const s = MD5_S[i]
      B = (B + (((temp << s) | (temp >>> (32 - s))) >>> 0)) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return out
}

// Pure-TypeScript FIPS 180-4 SHA-256
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

export function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8
  const padLen = ((input.length + 8) >> 6) * 64 + 64
  const msg = new Uint8Array(padLen)
  msg.set(input)
  msg[input.length] = 0x80
  const view = new DataView(msg.buffer)
  view.setUint32(padLen - 4, bitLen >>> 0, false)
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, h0, false)
  outView.setUint32(4, h1, false)
  outView.setUint32(8, h2, false)
  outView.setUint32(12, h3, false)
  outView.setUint32(16, h4, false)
  outView.setUint32(20, h5, false)
  outView.setUint32(24, h6, false)
  outView.setUint32(28, h7, false)
  return out
}

function toInputBytes(data: ScriptingData | Uint8Array | string): Uint8Array {
  if (typeof data === "string") return encodeUtf8(data)
  if (data instanceof Uint8Array) return data
  return data.toUint8Array()
}

export const ScriptingCrypto = {
  md5(data: ScriptingData | Uint8Array | string): ScriptingData {
    return new ScriptingData(md5Bytes(toInputBytes(data)))
  },
  sha256(data: ScriptingData | Uint8Array | string): ScriptingData {
    return new ScriptingData(sha256Bytes(toInputBytes(data)))
  },
  generateSymmetricKey(bits: number = 256): ScriptingData {
    const byteLen = Math.max(1, Math.ceil(bits / 8))
    const out = new Uint8Array(byteLen)
    const gCrypto = (globalThis as any).crypto
    if (gCrypto && typeof gCrypto.getRandomValues === "function") {
      gCrypto.getRandomValues(out)
    } else {
      for (let i = 0; i < byteLen; i++) {
        out[i] = Math.floor(Math.random() * 256)
      }
    }
    return new ScriptingData(out)
  },
}
