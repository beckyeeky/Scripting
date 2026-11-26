import {
  Appearance,
  AppState,
  BackHandler,
  DeviceEventEmitter,
  Dimensions,
  LayoutAnimation,
  NativeModules,
  Platform,
} from "react-native"
import { polyfillAtob } from "./polyfills"
import { ScriptingCrypto, ScriptingData, setNativeFsBridgeForData } from "./dataAndCrypto"
import { scriptingFetch, ScriptingResponse } from "./fetchAndHttp"

const {
  PixFileSystem,
  PixImageMedia,
  PixSystemBridge,
} = NativeModules

if (PixFileSystem) {
  setNativeFsBridgeForData(PixFileSystem)
}

// ---------- In-memory write-through string cache for hot config/metadata files ----------
const hotTextCache = new Map<string, string>()

function encodeUtf8BytesToBase64(text: string): string {
  const data = ScriptingData.fromRawString(text)
  return data ? data.toBase64String() : ""
}

const dirs = PixFileSystem?.getDirectoriesSync?.() ?? {
  documents: "/tmp/pix-docs",
  temp: "/tmp/pix-tmp",
  appGroup: "/tmp/pix-group",
  icloud: "/tmp/pix-docs",
}

// ---------- FileManager ----------
const ScriptingFileManager = {
  documentsDirectory: dirs.documents,
  temporaryDirectory: dirs.temp,
  appGroupDocumentsDirectory: dirs.appGroup,
  iCloudDocumentsDirectory: dirs.icloud,
  isiCloudEnabled: false,

  existsSync(path: string): boolean {
    if (!path) return false
    if (hotTextCache.has(path)) return true
    return Boolean(PixFileSystem?.fsExistsSync(path))
  },

  isDirectorySync(path: string): boolean {
    if (!path) return false
    return Boolean(PixFileSystem?.fsIsDirectorySync(path))
  },

  isFileSync(path: string): boolean {
    if (!path) return false
    if (hotTextCache.has(path)) return true
    return Boolean(PixFileSystem?.fsIsFileSync(path))
  },

  createDirectorySync(path: string, recursive = true): boolean {
    if (!path) return false
    return Boolean(PixFileSystem?.fsMkdirSync(path, Boolean(recursive)))
  },

  readAsStringSync(path: string, _encoding?: string): string {
    if (hotTextCache.has(path)) return hotTextCache.get(path)!
    const res = PixFileSystem?.fsReadStringSync(path)
    if (res == null) throw new Error(`File not found: ${path}`)
    if (res.length < 256 * 1024 && path.endsWith(".json")) {
      hotTextCache.set(path, res)
    }
    return res
  },

  writeAsStringSync(path: string, content: string, _encoding?: string): void {
    const ok = PixFileSystem?.fsWriteStringSync(path, String(content))
    if (!ok) throw new Error(`Failed to write file: ${path}`)
    if (String(content).length < 256 * 1024) {
      hotTextCache.set(path, String(content))
    } else {
      hotTextCache.delete(path)
    }
  },

  readAsDataSync(path: string): ScriptingData {
    const data = ScriptingData.fromFile(path)
    if (!data) throw new Error(`Cannot read data from: ${path}`)
    return data
  },

  writeAsDataSync(path: string, data: ScriptingData): void {
    hotTextCache.delete(path)
    if (data?._backingFilePath) {
      const ok = PixFileSystem?.fsWriteFromFileSync(data._backingFilePath, path, false)
      if (!ok) throw new Error(`Failed to write data from backing file: ${path}`)
      return
    }
    const b64 = data.toBase64String()
    const ok = PixFileSystem?.fsWriteBase64Sync(path, b64)
    if (!ok) throw new Error(`Failed to write data: ${path}`)
  },

  readDirectorySync(path: string, recursive = false): string[] {
    if (!PixFileSystem) return []
    const items = PixFileSystem.fsReaddirSync(path, Boolean(recursive))
    return Array.isArray(items) ? items : []
  },

  statSync(path: string): { size: number; modificationDate: number; mtimeMs: number; isDirectory: boolean; isFile: boolean } {
    const stat = PixFileSystem?.fsStatSync(path)
    if (!stat) throw new Error(`Cannot stat: ${path}`)
    return stat
  },

  removeSync(path: string): void {
    hotTextCache.clear()
    PixFileSystem?.fsRemoveSync(path)
  },

  renameSync(fromPath: string, toPath: string): void {
    hotTextCache.delete(fromPath)
    hotTextCache.delete(toPath)
    const ok = PixFileSystem?.fsRenameSync(fromPath, toPath)
    if (!ok) throw new Error(`Failed to rename ${fromPath} -> ${toPath}`)
  },

  copyFileSync(fromPath: string, toPath: string): void {
    hotTextCache.delete(toPath)
    const ok = PixFileSystem?.fsCopySync(fromPath, toPath)
    if (!ok) throw new Error(`Failed to copy ${fromPath} -> ${toPath}`)
  },

  async copyFile(fromPath: string, toPath: string): Promise<void> {
    ScriptingFileManager.copyFileSync(fromPath, toPath)
  },

  bookmarkedPath(_bookmark: string): string | null {
    return null
  },

  isFileStoredIniCloud(_path: string): boolean {
    return false
  },

  isiCloudFileDownloaded(_path: string): boolean {
    return true
  },

  async downloadFileFromiCloud(_path: string): Promise<boolean> {
    return true
  },

  async zip(sourceDirPath: string, destZipPath: string): Promise<void> {
    if (!PixFileSystem?.zipDirectory) {
      throw new Error("ZIP module unavailable")
    }
    await PixFileSystem.zipDirectory(sourceDirPath, destZipPath)
  },
}

// ---------- Keychain & Storage ----------
const ScriptingKeychain = {
  get(key: string, opts?: { synchronizable?: boolean }): string | null {
    return PixFileSystem?.keychainGetSync(key, Boolean(opts?.synchronizable)) ?? null
  },
  set(key: string, value: string, opts?: { synchronizable?: boolean }): boolean {
    return Boolean(PixFileSystem?.keychainSetSync(key, String(value), Boolean(opts?.synchronizable)))
  },
  remove(key: string, opts?: { synchronizable?: boolean }): boolean {
    return Boolean(PixFileSystem?.keychainRemoveSync(key, Boolean(opts?.synchronizable)))
  },
}

const ScriptingStorage = {
  contains(key: string): boolean {
    return Boolean(PixFileSystem?.storageContainsSync(key))
  },
  get<T = any>(key: string): T | null {
    return (PixFileSystem?.storageGetSync(key) ?? null) as T | null
  },
  set(key: string, value: string): void {
    PixFileSystem?.storageSetSync(key, String(value))
  },
  remove(key: string): void {
    PixFileSystem?.storageRemoveSync(key)
  },
}

// ---------- UIImage & ImageRenderer ----------
const boundsCache = new Map<string, { width: number; height: number }>()

export class ScriptingUIImage {
  readonly filePath?: string
  readonly base64?: string
  readonly symbolName?: string
  readonly tintColor?: string
  readonly blurRadius?: number
  readonly width: number
  readonly height: number
  readonly scale: number = 1
  private readonly cropRect?: { x: number; y: number; width: number; height: number }

  constructor(opts: {
    filePath?: string
    base64?: string
    symbolName?: string
    tintColor?: string
    blurRadius?: number
    width: number
    height: number
    cropRect?: { x: number; y: number; width: number; height: number }
  }) {
    this.filePath = opts.filePath
    this.base64 = opts.base64
    this.symbolName = opts.symbolName
    this.tintColor = opts.tintColor
    this.blurRadius = opts.blurRadius
    this.width = opts.width
    this.height = opts.height
    this.cropRect = opts.cropRect
  }

  static fromFile(path: string): ScriptingUIImage | null {
    if (!path) return null
    let bounds = boundsCache.get(path)
    if (!bounds) {
      const nativeBounds = PixImageMedia?.imageBoundsSync(path)
      if (!nativeBounds || nativeBounds.width <= 0 || nativeBounds.height <= 0) return null
      bounds = { width: nativeBounds.width, height: nativeBounds.height }
      if (boundsCache.size > 800) boundsCache.clear()
      boundsCache.set(path, bounds)
    }
    return new ScriptingUIImage({
      filePath: path,
      width: bounds.width,
      height: bounds.height,
    })
  }

  static fromBase64String(b64: string): ScriptingUIImage | null {
    if (!b64) return null
    const clean = b64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "")
    return new ScriptingUIImage({
      base64: clean,
      width: 512,
      height: 512,
    })
  }

  static fromSFSymbol(name: string): ScriptingUIImage {
    return new ScriptingUIImage({
      symbolName: name,
      width: 24,
      height: 24,
    })
  }

  blurred(radius: number): ScriptingUIImage {
    return new ScriptingUIImage({
      filePath: this.filePath,
      base64: this.base64,
      symbolName: this.symbolName,
      tintColor: this.tintColor,
      blurRadius: radius,
      width: this.width,
      height: this.height,
      cropRect: this.cropRect,
    })
  }

  croppedTo(rect: { x: number; y: number; width: number; height: number }): ScriptingUIImage {
    return new ScriptingUIImage({
      filePath: this.filePath,
      base64: this.base64,
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      cropRect: rect,
    })
  }

  async preparingThumbnail(_size?: { width: number; height: number }): Promise<ScriptingUIImage | null> {
    return this
  }

  withTintColor(color: string): ScriptingUIImage {
    return new ScriptingUIImage({
      filePath: this.filePath,
      base64: this.base64,
      symbolName: this.symbolName,
      tintColor: color,
      blurRadius: this.blurRadius,
      width: this.width,
      height: this.height,
    })
  }

  private samplePalette(dominantCount: number) {
    if (!this.filePath || !PixImageMedia?.imagePaletteSync) return null
    const r = this.cropRect
    return PixImageMedia.imagePaletteSync(
      this.filePath,
      r ? Math.round(r.x) : 0,
      r ? Math.round(r.y) : 0,
      r ? Math.round(r.width) : 0,
      r ? Math.round(r.height) : 0,
      dominantCount,
    )
  }

  averageColor(): { red: number; green: number; blue: number } | null {
    const res = this.samplePalette(1)
    return res?.average ?? null
  }

  dominantColors(count: number = 6): Array<{ color: { red: number; green: number; blue: number }; fraction: number }> {
    const res = this.samplePalette(count)
    return Array.isArray(res?.dominants) ? res.dominants : []
  }

  toJPEGBase64String(_quality?: number): string {
    if (this.base64) return this.base64
    if (this.filePath) {
      return PixFileSystem?.fsReadBase64Sync(this.filePath) ?? ""
    }
    return ""
  }

  toPNGBase64String(): string {
    return this.toJPEGBase64String()
  }

  toJPEGData(quality?: number): ScriptingData | null {
    const b64 = this.toJPEGBase64String(quality)
    return b64 ? ScriptingData.fromBase64String(b64) : null
  }
}

// Capture OCR draw props passed into Canvas inside ImageRenderer
export interface CanvasRenderDescriptor {
  kind: "ocr"
  filePath: string
  bubbles: any[]
  showOverlay: boolean
  hiddenIndices?: Set<number>
  scale?: number
}

const ScriptingImageRenderer = {
  async toJPEGData(node: any, _opts?: number | { scale?: number; compressionQuality?: number }): Promise<ScriptingData | null> {
    const desc = extractCanvasDescriptor(node)
    if (desc && PixImageMedia?.renderOCRImage) {
      const filtered = desc.showOverlay
        ? (desc.bubbles || []).filter((_: any, idx: number) => !desc.hiddenIndices?.has(idx))
        : []
      const b64 = await PixImageMedia.renderOCRImage(
        desc.filePath,
        JSON.stringify(filtered),
        desc.scale ?? 1.0,
        "jpeg",
      )
      return b64 ? ScriptingData.fromBase64String(b64) : null
    }
    return null
  },
  async toUIImage(node: any, _opts?: { scale?: number; opaque?: boolean; [key: string]: any }): Promise<ScriptingUIImage | null> {
    const desc = extractCanvasDescriptor(node)
    if (desc && PixImageMedia?.renderOCRImage) {
      const filtered = desc.showOverlay
        ? (desc.bubbles || []).filter((_: any, idx: number) => !desc.hiddenIndices?.has(idx))
        : []
      const b64 = await PixImageMedia.renderOCRImage(
        desc.filePath,
        JSON.stringify(filtered),
        desc.scale ?? 1.0,
        "png",
      )
      return b64 ? ScriptingUIImage.fromBase64String(b64) : null
    }
    return null
  },
}

function extractCanvasDescriptor(node: any): CanvasRenderDescriptor | null {
  if (!node || typeof node !== "object") return null
  if (node.props?.__ocrRenderDescriptor) return node.props.__ocrRenderDescriptor
  if (typeof node.type === "function") {
    try {
      return extractCanvasDescriptor(node.type(node.props || {}))
    } catch {
      return null
    }
  }
  if (Array.isArray(node.props?.children)) {
    for (const child of node.props.children) {
      const found = extractCanvasDescriptor(child)
      if (found) return found
    }
  } else if (node.props?.children) {
    return extractCanvasDescriptor(node.props.children)
  }
  return null
}

// ---------- Dialog bridge (rendered by DialogHost in App.tsx) ----------
export type DialogRequest =
  | { kind: "alert"; title: string; message?: string; resolve: () => void }
  | { kind: "confirm"; title: string; message?: string; confirmLabel?: string; cancelLabel?: string; resolve: (ok: boolean) => void }
  | { kind: "actionSheet"; title: string; message?: string; actions: Array<{ label: string; role?: string }>; resolve: (index: number | null) => void }
  | { kind: "prompt"; title: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string; resolve: (val: string | null) => void }

type DialogListener = (req: DialogRequest | null) => void
const dialogListeners = new Set<DialogListener>()
const dialogQueue: DialogRequest[] = []
let activeDialog: DialogRequest | null = null

function pumpDialog() {
  if (!activeDialog && dialogQueue.length > 0) {
    activeDialog = dialogQueue.shift()!
    dialogListeners.forEach((l) => l(activeDialog))
  }
}

export function dismissActiveDialog() {
  activeDialog = null
  dialogListeners.forEach((l) => l(null))
  pumpDialog()
}

export function subscribeDialog(listener: DialogListener): () => void {
  dialogListeners.add(listener)
  listener(activeDialog)
  return () => dialogListeners.delete(listener)
}

export const ScriptingDialog = {
  alert(opts: { title?: string; message?: string }): Promise<void> {
    return new Promise((resolve) => {
      dialogQueue.push({
        kind: "alert",
        title: opts?.title || "提示",
        message: opts?.message,
        resolve: () => {
          dismissActiveDialog()
          resolve()
        },
      })
      pumpDialog()
    })
  },
  confirm(opts: { title?: string; message?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
    return new Promise((resolve) => {
      dialogQueue.push({
        kind: "confirm",
        title: opts?.title || "确认",
        message: opts?.message,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
        resolve: (ok) => {
          dismissActiveDialog()
          resolve(ok)
        },
      })
      pumpDialog()
    })
  },
  actionSheet(opts: { title?: string; message?: string; actions: Array<{ label: string; role?: string }> }): Promise<number | null> {
    return new Promise((resolve) => {
      dialogQueue.push({
        kind: "actionSheet",
        title: opts?.title || "",
        message: opts?.message,
        actions: opts?.actions || [],
        resolve: (idx) => {
          dismissActiveDialog()
          resolve(idx)
        },
      })
      pumpDialog()
    })
  },
  prompt(opts: { title?: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string }): Promise<string | null> {
    return new Promise((resolve) => {
      dialogQueue.push({
        kind: "prompt",
        title: opts?.title || "",
        message: opts?.message,
        defaultValue: opts?.defaultValue,
        placeholder: opts?.placeholder,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
        resolve: (val) => {
          dismissActiveDialog()
          resolve(val)
        },
      })
      pumpDialog()
    })
  },
}

// ---------- Device / AppEvents / Script ----------
const orientationListeners = new Set<() => void>()
Dimensions.addEventListener("change", () => {
  orientationListeners.forEach((fn) => {
    try {
      fn()
    } catch {}
  })
})

export const ScriptingDevice = {
  get screen() {
    const win = Dimensions.get("window")
    return { width: win.width, height: win.height, scale: win.scale }
  },
  get isLandscape(): boolean {
    const win = Dimensions.get("window")
    return win.width > win.height
  },
  get isPortrait(): boolean {
    const win = Dimensions.get("window")
    return win.height >= win.width
  },
  get isiPad(): boolean {
    const win = Dimensions.get("window")
    return Math.min(win.width, win.height) >= 600
  },
  get isiPhone(): boolean {
    return !ScriptingDevice.isiPad
  },
  get colorScheme(): "light" | "dark" {
    return Appearance.getColorScheme() === "dark" ? "dark" : "light"
  },
  systemName: "Android",
  model: Platform.OS === "android" ? "Android" : "Device",
  addOrientationListener(fn: () => void): void {
    orientationListeners.add(fn)
  },
  removeOrientationListener(fn: () => void): void {
    orientationListeners.delete(fn)
  },
}

const sceneListeners = new Set<(phase: "active" | "inactive" | "background") => void>()
AppState.addEventListener("change", (state) => {
  const phase = state === "active" ? "active" : state === "background" ? "background" : "inactive"
  sceneListeners.forEach((fn) => {
    try {
      fn(phase)
    } catch {}
  })
})

export const ScriptingAppEvents = {
  scenePhase: {
    addListener(fn: (phase: "active" | "inactive" | "background") => void) {
      sceneListeners.add(fn)
    },
    removeListener(fn: (phase: "active" | "inactive" | "background") => void) {
      sceneListeners.delete(fn)
    },
  },
}

const resumeListeners = new Set<(details: any) => void>()
const minimizeListeners = new Set<() => void>()

export function emitScriptResume(details: { resumeFromMinimized?: boolean; queryParameters?: Record<string, any>; widgetParameter?: string } = {}) {
  resumeListeners.forEach((fn) => {
    try {
      fn(details)
    } catch {}
  })
}

export const ScriptingScript = {
  name: "Pix-Scripting",
  metadata: {
    name: "Pix-Scripting",
    version: "1.8.14.4",
    description: "Liquid Glass Pixiv Client",
  },
  env: {},
  queryParameters: {} as Record<string, any>,
  widgetParameter: undefined as string | undefined,
  hasFullAccess: () => true,
  supportsMinimization: () => true,
  isMinimized: () => false,
  enableMinimize() {},
  minimize() {
    minimizeListeners.forEach((fn) => {
      try {
        fn()
      } catch {}
    })
    BackHandler.exitApp()
  },
  exit() {
    BackHandler.exitApp()
  },
  onResume(fn: (details: any) => void) {
    resumeListeners.add(fn)
  },
  onMinimize(fn: () => void) {
    minimizeListeners.add(fn)
  },
  onHomeTabEvent(_fn: any) {},
  createRunURLScheme(name: string, query?: Record<string, string>): string {
    const params = query ? new URLSearchParams(query).toString() : ""
    return `pix-scripting://run/${encodeURIComponent(name)}${params ? `?${params}` : ""}`
  },
}

// ---------- DocumentPicker & iOS Config Import hook ----------
let customPickFilesHandler: ((opts?: any) => Promise<string[] | null>) | null = null

export function setCustomPickFilesHandler(fn: ((opts?: any) => Promise<string[] | null>) | null) {
  customPickFilesHandler = fn
}

const ScriptingDocumentPicker = {
  async pickFiles(opts?: any): Promise<string[]> {
    if (customPickFilesHandler) {
      const handled = await customPickFilesHandler(opts)
      if (handled) return handled
    }
    if (!PixSystemBridge?.pickFiles) return []
    const files = await PixSystemBridge.pickFiles(["*/*"])
    return Array.isArray(files) ? files.map((f: any) => f.filePath).filter(Boolean) : []
  },
  async open(types?: string[]): Promise<string[]> {
    return ScriptingDocumentPicker.pickFiles({ types })
  },
  async pickDirectoryBookmark(_opts?: any): Promise<string | null> {
    await ScriptingDialog.alert({
      title: "Android 下载目录说明",
      message: "Android 版文件统一保存在应用专属文档目录，可在「下载与文件管理」中查看并分享到系统文件管理器。",
    })
    return null
  },
}

// ---------- ShareSheet / Pasteboard / Safari / Photos / HapticFeedback ----------
const ScriptingShareSheet = {
  async present(items: string[]): Promise<boolean> {
    if (!PixSystemBridge?.shareItems) return false
    return Boolean(await PixSystemBridge.shareItems(items || []))
  },
}

const ScriptingPasteboard = {
  async setString(text: string): Promise<void> {
    await PixSystemBridge?.copyToClipboard(String(text ?? ""))
  },
  async getString(): Promise<string> {
    return (await PixSystemBridge?.readClipboardText()) ?? ""
  },
}

const ScriptingSafari = {
  async openURL(url: string): Promise<boolean> {
    return Boolean(await PixSystemBridge?.openExternalUrl(url))
  },
  async present(url: string): Promise<void> {
    await PixSystemBridge?.openExternalUrl(url)
  },
}

const ScriptingPhotos = {
  async fetchAlbums(_opts?: any): Promise<any[]> {
    return [{ title: "Pix-Scripting", localIdentifier: "pix-scripting-album" }]
  },
  async createAlbum(title: string): Promise<any> {
    return { title, localIdentifier: `album-${title}` }
  },
  async fetchAssets(_opts?: any): Promise<any[]> {
    return []
  },
  async savePhoto(source: any, opts?: { fileName?: string }): Promise<boolean> {
    if (!PixImageMedia?.saveMediaToGallery) return false
    let filePath: string | null = null
    if (typeof source === "string") {
      filePath = source
    } else if (source instanceof ScriptingUIImage && source.filePath) {
      filePath = source.filePath
    } else if (source instanceof ScriptingData) {
      const tmp = `${dirs.temp}/save_${Date.now()}_${opts?.fileName || "photo.jpg"}`
      ScriptingFileManager.writeAsDataSync(tmp, source)
      filePath = tmp
    } else if (source && typeof source === "object" && source.filePath) {
      filePath = source.filePath
    }
    if (!filePath) return false
    await PixImageMedia.saveMediaToGallery(filePath, "image", "Pix-Scripting")
    return true
  },
  async saveVideo(videoPath: string, _opts?: { fileName?: string }): Promise<boolean> {
    if (!PixImageMedia?.saveMediaToGallery || !videoPath) return false
    await PixImageMedia.saveMediaToGallery(videoPath, "video", "Pix-Scripting")
    return true
  },
  async pickPhotos(limit: number = 1): Promise<ScriptingUIImage[]> {
    if (!PixSystemBridge?.pickImages) return []
    const items = await PixSystemBridge.pickImages(limit > 1)
    if (!Array.isArray(items)) return []
    return items
      .map((it: any) => ScriptingUIImage.fromFile(it.filePath))
      .filter((img: ScriptingUIImage | null): img is ScriptingUIImage => Boolean(img))
  },
}

const ScriptingHapticFeedback = {
  selection: () => PixSystemBridge?.triggerHaptic("selection"),
  lightImpact: () => PixSystemBridge?.triggerHaptic("light"),
  mediumImpact: () => PixSystemBridge?.triggerHaptic("medium"),
  heavyImpact: () => PixSystemBridge?.triggerHaptic("heavy"),
  softImpact: () => PixSystemBridge?.triggerHaptic("light"),
  rigidImpact: () => PixSystemBridge?.triggerHaptic("rigid"),
  notificationSuccess: () => PixSystemBridge?.triggerHaptic("success"),
  notificationWarning: () => PixSystemBridge?.triggerHaptic("warning"),
  notificationError: () => PixSystemBridge?.triggerHaptic("error"),
}

// ---------- WebViewController (mounted + headless + OAuth modal) ----------
export type WebViewControllerSink = {
  onLoadHTML: (html: string, generation: number) => Promise<boolean>
  onEvaluateJS: (script: string) => Promise<any>
}

let headlessSeq = 1

export class ScriptingWebViewController {
  shouldAllowRequest?: (request: { url: string }) => Promise<boolean> | boolean
  private handlers = new Map<string, (data: any) => void>()
  private mountedSink: WebViewControllerSink | null = null
  private pendingUrl: string | null = null
  private pendingEphemeral: boolean
  private lastOAuthCookies: string = ""
  private generation = 0
  private headlessId: string | null = null
  private headlessSub: any = null

  constructor(opts?: { ephemeral?: boolean }) {
    this.pendingEphemeral = Boolean(opts?.ephemeral)
  }

  _attachMountedSink(sink: WebViewControllerSink | null) {
    this.mountedSink = sink
  }

  _dispatchMessage(name: string, rawPayload: string) {
    const cb = this.handlers.get(name)
    if (!cb) return
    let parsed: any = rawPayload
    try {
      parsed = JSON.parse(rawPayload)
    } catch {}
    try {
      cb(parsed)
    } catch {}
  }

  async addScriptMessageHandler(name: string, handler: (data: any) => void): Promise<void> {
    this.handlers.set(name, handler)
  }

  async loadHTML(html: string): Promise<boolean> {
    const gen = ++this.generation
    if (this.mountedSink) {
      return await this.mountedSink.onLoadHTML(html, gen)
    }
    // Headless mode (e.g. epubExporter stampSeriesOnCover)
    if (!PixSystemBridge?.loadHeadlessHtml) return false
    const sid = this.headlessId ?? `hl_${Date.now()}_${headlessSeq++}`
    this.headlessId = sid
    if (!this.headlessSub) {
      this.headlessSub = DeviceEventEmitter.addListener("PixHeadlessWebMessage", (evt: any) => {
        if (evt?.sessionId === sid) {
          this._dispatchMessage(evt.name, evt.payload)
        }
      })
    }
    return Boolean(await PixSystemBridge.loadHeadlessHtml(sid, html))
  }

  async evaluateJavaScript(script: string): Promise<any> {
    if (this.mountedSink) {
      return await this.mountedSink.onEvaluateJS(script)
    }
    return null
  }

  async loadURL(url: string): Promise<void> {
    this.pendingUrl = url
  }

  async present(opts?: { navigationTitle?: string; fullscreen?: boolean }): Promise<void> {
    if (!this.pendingUrl || !PixSystemBridge?.presentOAuthWebView) return
    const result = await PixSystemBridge.presentOAuthWebView({
      url: this.pendingUrl,
      title: opts?.navigationTitle || "Pixiv 登录",
      redirectPrefix: "pixiv://account/login",
      ephemeral: this.pendingEphemeral,
    })
    if (result?.cookieHeader) {
      this.lastOAuthCookies = result.cookieHeader
    }
    if (!result?.cancelled && result?.redirectUrl && this.shouldAllowRequest) {
      await this.shouldAllowRequest({ url: result.redirectUrl })
    }
  }

  dismiss(): void {
    // Handled automatically by PixSystemBridge.presentOAuthWebView when intercepting redirect
  }

  async getAllCookies(): Promise<Array<{ name: string; value: string; domain: string; path: string }>> {
    return await this.getCookies("https://www.pixiv.net")
  }

  async getCookies(url: string): Promise<Array<{ name: string; value: string; domain: string; path: string }>> {
    if (this.lastOAuthCookies) {
      return this.lastOAuthCookies.split(";").map((part) => {
        const eq = part.indexOf("=")
        return {
          name: eq > 0 ? part.slice(0, eq).trim() : "",
          value: eq > 0 ? part.slice(eq + 1).trim() : "",
          domain: "pixiv.net",
          path: "/",
        }
      }).filter((c) => c.name.length > 0)
    }
    if (!PixSystemBridge?.getCookiesForUrl) return []
    return await PixSystemBridge.getCookiesForUrl(url)
  }

  async deleteCookie(_cookie: { name: string; domain?: string; path?: string }): Promise<void> {
    await PixSystemBridge?.clearPixivCookies?.()
  }

  dispose(): void {
    this.handlers.clear()
    this.mountedSink = null
    this.headlessSub?.remove?.()
    this.headlessSub = null
    if (this.headlessId) {
      PixSystemBridge?.disposeHeadlessWebView?.(this.headlessId)
      this.headlessId = null
    }
  }
}

// ---------- Archive / Python / Shell (Ugoira ZIP + MP4/GIF native offload) ----------
const ScriptingArchive = {
  openForMode(zipPath: string, _mode: string) {
    const entries: string[] = PixFileSystem?.listZipEntriesSync?.(zipPath) ?? []
    return {
      getEntryPaths: () => entries,
      extractToSync(entryPath: string, destPath: string) {
        const ok = PixFileSystem?.extractZipEntrySync?.(zipPath, entryPath, destPath)
        if (!ok) throw new Error(`Failed to extract ${entryPath}`)
      },
    }
  },
}

const ScriptingPython = {
  async run(_code: string): Promise<{ exitCode: number; output: string }> {
    // Fallback cleanly so ugoira.ts uses Archive.openForMode
    return { exitCode: 1, output: "Python runtime not bundled on Android" }
  },
}

const ScriptingShell = {
  async run(cmd: string, opts?: { cwd?: string; timeout?: number }): Promise<{ exitCode: number; output: string }> {
    // Intercept ffmpegExporter.ts MP4/GIF synthesis commands and route to native MediaCodec / GIF89a
    if (cmd.includes("ffmpeg") && opts?.cwd) {
      const concatMatch = cmd.match(/-i\s+"([^"]+)"/)
      const outMatch = cmd.match(/"([^"]+\.(?:mp4|gif))"/)
      if (concatMatch && outMatch) {
        const concatPath = concatMatch[1]
        const outputPath = outMatch[1]
        try {
          const concatText = ScriptingFileManager.readAsStringSync(concatPath)
          const frames: Array<{ file: string; delay: number }> = []
          let currentFile: string | null = null
          for (const line of concatText.split(/\r?\n/)) {
            const fm = line.match(/^file\s+'(.+)'$/)
            if (fm) {
              currentFile = fm[1]
              continue
            }
            const dm = line.match(/^duration\s+([0-9.]+)$/)
            if (dm && currentFile) {
              frames.push({
                file: currentFile,
                delay: Math.max(10, Math.round(parseFloat(dm[1]) * 1000)),
              })
              currentFile = null
            }
          }
          if (frames.length > 0) {
            if (outputPath.endsWith(".gif")) {
              const ok = await PixImageMedia.encodeUgoiraGif(opts.cwd, JSON.stringify(frames), outputPath)
              return { exitCode: ok ? 0 : 1, output: ok ? "OK" : "GIF encode failed" }
            } else {
              const ok = await PixImageMedia.encodeUgoiraMp4(opts.cwd, JSON.stringify(frames), outputPath)
              return { exitCode: ok ? 0 : 1, output: ok ? "OK" : "MP4 encode failed" }
            }
          }
        } catch (e: any) {
          return { exitCode: 1, output: e?.message ?? String(e) }
        }
      }
    }
    return { exitCode: 1, output: "Shell command unsupported on Android" }
  },
}

// ---------- BackgroundKeeper / Notification / LiveActivity / Widget / Assistant ----------
const ScriptingBackgroundKeeper = {
  async keepAlive(): Promise<boolean> {
    return true
  },
  async stopKeepAlive(): Promise<void> {},
}

let notifIdCounter = 100
export const ScriptingNotification = {
  async schedule(opts: { title?: string; body?: string; subtitle?: string; silent?: boolean; [key: string]: any }): Promise<void> {
    PixSystemBridge?.showNotification?.(
      ++notifIdCounter,
      opts?.title || "Pix-Scripting",
      opts?.body || opts?.subtitle || "",
      0,
      0,
      false,
    )
  },
}

export const ScriptingLiveActivity = {
  register<T = any>(_nameOrBuilder: any, _builder?: any): (initialState?: T) => any {
    return (initialState?: T) => ({
      activityId: `act_${Date.now()}`,
      async start(state: any) {
        const s = state || initialState || {}
        PixSystemBridge?.showNotification?.(
          9901,
          s.title || "正在下载",
          s.statusText || "",
          Math.round((s.progress || 0) * 100),
          100,
          true,
        )
      },
      async update(state: any) {
        PixSystemBridge?.showNotification?.(
          9901,
          state?.title || "正在下载",
          state?.statusText || "",
          Math.round((state?.progress || 0) * 100),
          100,
          !state?.isDone,
        )
      },
      async end(state: any, _opts?: any) {
        if (state?.isDone) {
          PixSystemBridge?.showNotification?.(
            9901,
            state?.title || "任务完成",
            state?.statusText || "",
            0,
            0,
            false,
          )
        } else {
          PixSystemBridge?.cancelNotification?.(9901)
        }
      },
    })
  },
  async from<T = any>(_id: string, _name?: string): Promise<any> {
    return null
  },
  async getAllActivitiesIds(): Promise<string[]> {
    return []
  },
}

export const ScriptingWidget = {
  displaySize: { width: 320, height: 160 },
  family: "systemMedium",
  isBlurMode: false,
  isTransparentBackground: false,
  isTransparentMode: false,
  parameter: "",
  present(_node: any) {},
  reloadAll() {},
}

export const ScriptingAssistant = {
  isAvailable: () => false,
  async requestStreaming() {
    throw new Error("Android 版请先在「设置 → 智能助手」配置自定义 AI 模型（OpenAI / Gemini / Claude / DeepSeek 等）")
  },
}

function createGlassInstance(style: string, tintColor?: string, isInteractive = false) {
  return {
    style,
    tintColor,
    isInteractive,
    tint(color?: string) {
      return createGlassInstance(style, color, isInteractive)
    },
    interactive(enabled: boolean = true) {
      return createGlassInstance(style, tintColor, Boolean(enabled))
    },
  }
}

export const ScriptingUIGlass = {
  regular: () => createGlassInstance("regular"),
  clear: () => createGlassInstance("clear"),
}

export const ScriptingAnimation = {
  smooth: (opts?: any) => ({ type: "smooth", ...opts }),
  spring: (opts?: any) => ({ type: "spring", ...opts }),
}

export function scriptingWithAnimation(_animOrFn: any, fn?: () => void): void {
  const callback = typeof _animOrFn === "function" ? _animOrFn : fn
  if (typeof callback === "function") {
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    } catch {}
    callback()
  }
}

export const ScriptingTransition = {
  fade: () => ({ type: "fade" }),
}

const ScriptingFontPicker = {
  async pickFont(): Promise<{ postscriptName?: string; familyName?: string } | null> {
    await ScriptingDialog.alert({
      title: "字体选择",
      message: "Android 版内置多种中文/日文文库预设字体，请直接在排版设置中选择。",
    })
    return null
  },
}

const ScriptingQuickLook = {
  async previewURLs(urls: string[]): Promise<void> {
    if (urls?.[0]) {
      await ScriptingShareSheet.present([urls[0]])
    }
  },
}

export function installHostGlobals(target: Record<string, any> = globalThis as any): void {
  target.Data = ScriptingData
  target.Crypto = ScriptingCrypto
  target.FileManager = ScriptingFileManager
  target.Keychain = ScriptingKeychain
  target.Storage = ScriptingStorage
  target.UIImage = ScriptingUIImage
  target.ImageRenderer = ScriptingImageRenderer
  target.Device = ScriptingDevice
  target.AppEvents = ScriptingAppEvents
  target.Script = ScriptingScript
  target.Dialog = ScriptingDialog
  target.DocumentPicker = ScriptingDocumentPicker
  target.ShareSheet = ScriptingShareSheet
  target.Pasteboard = ScriptingPasteboard
  target.Safari = ScriptingSafari
  target.Photos = ScriptingPhotos
  target.HapticFeedback = ScriptingHapticFeedback
  target.WebViewController = ScriptingWebViewController
  target.Archive = ScriptingArchive
  target.Python = ScriptingPython
  target.Shell = ScriptingShell
  target.BackgroundKeeper = ScriptingBackgroundKeeper
  target.Notification = ScriptingNotification
  target.Widget = ScriptingWidget
  target.Assistant = ScriptingAssistant
  target.UIGlass = ScriptingUIGlass
  target.Animation = ScriptingAnimation
  target.Transition = ScriptingTransition
  target.FontPicker = ScriptingFontPicker
  target.QuickLook = ScriptingQuickLook
  target.withAnimation = scriptingWithAnimation
  target.fetch = scriptingFetch
  target.Response = ScriptingResponse
  target.LiveActivityUI = () => null
  target.NamespaceID = class {}
  target.PHAsset = class {}
  target.PHAssetCollection = class {}
  if (typeof target.require !== "function") {
    target.require = require
  }
  // Helper for Base64 decoding inside ScriptingData
  target.__pix_atob = polyfillAtob
  target.__pix_btoa = encodeUtf8BytesToBase64
}

export {
  ScriptingFileManager,
  ScriptingKeychain,
  ScriptingStorage,
  ScriptingImageRenderer,
  ScriptingDocumentPicker,
  ScriptingShareSheet,
  ScriptingPasteboard,
  ScriptingSafari,
  ScriptingPhotos,
  ScriptingHapticFeedback,
  ScriptingArchive,
  ScriptingPython,
  ScriptingShell,
  ScriptingBackgroundKeeper,
  ScriptingFontPicker,
  ScriptingQuickLook,
}
