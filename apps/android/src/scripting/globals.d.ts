import type { Observable as ScriptingObservable } from "./navigation"
import type { ScriptingData } from "./dataAndCrypto"
import type { ScriptingUIImage } from "./hostGlobals"

declare global {
  namespace React {
    interface IntrinsicAttributes {
      toolbar?: any
      padding?: any
      contentShape?: any
      controlSize?: any
      fixedSize?: any
    }
  }
  namespace JSX {
    interface IntrinsicAttributes {
      toolbar?: any
      padding?: any
      contentShape?: any
      controlSize?: any
      fixedSize?: any
    }
  }
  type Observable<T> = ScriptingObservable<T>
  type Data = ScriptingData
  const Data: typeof ScriptingData
  type UIImage = ScriptingUIImage
  const UIImage: typeof ScriptingUIImage
  type PHAsset = any
  type PHAssetCollection = any
  type NamespaceID = any

  const Crypto: any
  const FileManager: any
  const Keychain: any
  const Storage: {
    contains: (key: string) => boolean
    get: <T = any>(key: string) => T | null
    set: (key: string, value: any) => void
    remove: (key: string) => void
  }
  const ImageRenderer: {
    toJPEGData: (node: any, opts?: number | { scale?: number; compressionQuality?: number }) => Promise<ScriptingData | null>
    toUIImage: (node: any, opts?: { scale?: number; opaque?: boolean; [key: string]: any }) => Promise<ScriptingUIImage | null>
  }
  const Device: any
  const AppEvents: any
  const Script: any
  const Dialog: any
  const DocumentPicker: any
  const ShareSheet: any
  const Pasteboard: any
  const Safari: any
  const Photos: any
  const HapticFeedback: any
  const WebViewController: any
  type WebViewController = import("./hostGlobals").ScriptingWebViewController
  const Archive: any
  const Python: any
  const Shell: any
  const BackgroundKeeper: any
  const Notification: any
  const Widget: any
  const Assistant: any
  const UIGlass: any
  type UIGlass = any
  const Animation: any
  const Transition: any
  const FontPicker: any
  const QuickLook: any
  const withAnimation: (animOrFn: any, fn?: () => void) => void
  const LiveActivityUI: (props: any) => any

  class TextDecoder {
    constructor(label?: string)
    decode(input?: ArrayBuffer | ArrayBufferView | null, options?: { stream?: boolean }): string
  }
  class TextEncoder {
    encode(input?: string): Uint8Array
  }
}

export {}
