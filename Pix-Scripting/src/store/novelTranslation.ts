import { AbortController } from "scripting"
import { isAIAvailable, translateNovelPassage, generateNovelTranslationContext } from "../api/aiService"
import { loadCustomAIProfile, isCustomAIConfigured } from "./customAI"
import { pixivDataDirectory, resolveEffectiveUID } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"

export type TranslationDisplayMode = "original" | "translated"
export type TranslationBlockStatus = "pending" | "running" | "done" | "error"

export interface TranslationBlock {
  id: string
  original: string
  translation?: string
  status: TranslationBlockStatus
  error?: string
}

export interface NovelTranslationSnapshot {
  novelId: number
  mode: TranslationDisplayMode
  running: boolean
  blocks: Record<string, TranslationBlock>
  done: number
  total: number
  failed: number
  message?: string
}

export interface NovelTranslationInput {
  novelId: number
  title: string
  text: string
  seriesId?: number | null
  blocks: Array<{ id: string; text: string }>
}

interface StoredTranslation {
  version: 1
  model: string
  mode: TranslationDisplayMode
  blocks: Record<string, { source: string; translation?: string; error?: string }>
  summary?: string
  glossary?: string
}

function fingerprint(value: string): string {
  const data = Data.fromRawString(value)
  if (!data) throw new Error("无法计算小说正文指纹")
  return Crypto.sha256(data).toHexString()
}

function modelIdentity(): string {
  if (!isCustomAIConfigured()) return "scripting-assistant"
  const config = loadCustomAIProfile().general
  return `${config.protocol}|${config.endpoint}|${config.model}`
}

function novelPath(uid: string, novelId: number): string {
  return `${pixivDataDirectory()}/NovelTranslations/users/${uid}/${novelId}.json`
}

function seriesPath(uid: string, seriesId: number): string {
  return `${pixivDataDirectory()}/NovelTranslations/users/${uid}/series-${seriesId}.json`
}

function readStored(path: string): StoredTranslation | null {
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) return null
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8")) as StoredTranslation
    return parsed?.version === 1 && parsed.blocks && typeof parsed.blocks === "object" ? parsed : null
  } catch {
    return null
  }
}

function cleanError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  // 供应商报错偶尔包含请求头，持久化前只保留简短、安全的类别。
  if (/401|403|unauthorized|api.?key|鉴权/i.test(value)) return "模型鉴权失败，请检查智能助手设置"
  if (/429|rate.limit|限流/i.test(value)) return "模型限流，请稍后重试"
  if (/timeout|超时|abort/i.test(value)) return "请求超时，请重试"
  return "翻译失败，请检查网络与模型设置后重试"
}

function glossaryEntries(value: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of value.split("\n")) {
    const parts = line.split("｜")
    const source = parts[1]?.trim()
    if (source && parts[2]?.trim()) result.set(source.toLowerCase(), line.trim())
  }
  return result
}

function mergeGlossary(series: string, novel: string): string {
  const entries = glossaryEntries(series)
  for (const [source, line] of glossaryEntries(novel)) entries.set(source, line)
  return Array.from(entries.values()).join("\n")
}

export class NovelTranslationSession {
  private input: NovelTranslationInput
  private uid: string
  private model: string
  private stored: StoredTranslation
  private snapshot: NovelTranslationSnapshot
  private listeners = new Set<(snapshot: NovelTranslationSnapshot) => void>()
  private controllers = new Set<AbortController>()
  private runId = 0

  constructor(input: NovelTranslationInput) {
    this.input = input
    this.uid = resolveEffectiveUID()
    this.model = modelIdentity()
    const saved = readStored(novelPath(this.uid, input.novelId))
    this.stored = saved?.model === this.model ? saved : {
      version: 1, model: this.model, mode: saved?.mode ?? "original", blocks: {},
    }
    this.snapshot = this.hydrate()
  }

  private hydrate(): NovelTranslationSnapshot {
    const blocks: Record<string, TranslationBlock> = {}
    for (const item of this.input.blocks) {
      const source = fingerprint(item.text)
      const saved = this.stored.blocks[item.id]
      const valid = saved?.source === source
      blocks[item.id] = {
        id: item.id,
        original: item.text,
        translation: valid ? saved.translation : undefined,
        status: valid && saved.translation ? "done" : valid && saved.error ? "error" : "pending",
        error: valid ? saved.error : undefined,
      }
    }
    this.stored.blocks = Object.fromEntries(Object.values(blocks).map((block) => [block.id, {
      source: fingerprint(block.original), translation: block.translation, error: block.error,
    }]))
    return this.count({ novelId: this.input.novelId, mode: this.stored.mode, running: false, blocks, done: 0, total: 0, failed: 0 })
  }

  private count(snapshot: NovelTranslationSnapshot): NovelTranslationSnapshot {
    const blocks = Object.values(snapshot.blocks)
    return { ...snapshot, total: blocks.length, done: blocks.filter((b) => b.status === "done").length,
      failed: blocks.filter((b) => b.status === "error").length }
  }

  private publish(): void {
    this.snapshot = this.count({ ...this.snapshot, blocks: { ...this.snapshot.blocks } })
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private persist(): void {
    this.stored.mode = this.snapshot.mode
    writeTextSafely(novelPath(this.uid, this.input.novelId), JSON.stringify(this.stored))
  }

  getSnapshot(): NovelTranslationSnapshot { return this.snapshot }

  subscribe(listener: (snapshot: NovelTranslationSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  setMode(mode: TranslationDisplayMode): void {
    this.snapshot = { ...this.snapshot, mode }
    this.persist()
    this.publish()
  }

  pause(): void {
    this.runId += 1
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    for (const block of Object.values(this.snapshot.blocks)) if (block.status === "running") block.status = "pending"
    this.snapshot = { ...this.snapshot, running: false, message: undefined }
    this.persist()
    this.publish()
  }

  clear(): void {
    this.pause()
    this.stored = { version: 1, model: this.model, mode: "original", blocks: {} }
    this.snapshot = this.hydrate()
    this.publish()
  }

  async start(onlyIds?: string[]): Promise<void> {
    if (this.snapshot.running) return
    if (!isAIAvailable()) {
      this.snapshot = { ...this.snapshot, message: "请先在设置中配置智能助手" }
      this.publish()
      return
    }
    const targets = Object.values(this.snapshot.blocks).filter((b) =>
      onlyIds ? onlyIds.includes(b.id) : b.status !== "done"
    )
    if (targets.length === 0) return
    const run = ++this.runId
    this.snapshot = { ...this.snapshot, running: true, message: undefined }
    this.publish()
    try {
      const contextController = new AbortController()
      this.controllers.add(contextController)
      let context: { summary?: string; glossary?: string }
      try {
        context = await this.getContext(contextController.signal)
      } finally {
        this.controllers.delete(contextController)
      }
      if (run !== this.runId || contextController.signal.aborted) return
      let cursor = 0
      const worker = async () => {
        while (run === this.runId && cursor < targets.length) {
          const block = targets[cursor++]
          const controller = new AbortController()
          this.controllers.add(controller)
          block.status = "running"
          block.error = undefined
          this.publish()
          try {
            const translation = await translateNovelPassage(block.original, {
              title: this.input.title, summary: context.summary, glossary: context.glossary,
              signal: controller.signal,
            })
            if (run !== this.runId || controller.signal.aborted) return
            if (!translation.trim()) throw new Error("empty translation")
            block.translation = translation.trim()
            block.status = "done"
            this.stored.blocks[block.id] = { source: fingerprint(block.original), translation: block.translation }
          } catch (error) {
            if (run !== this.runId || controller.signal.aborted) return
            block.status = "error"
            block.error = cleanError(error)
            this.stored.blocks[block.id] = { source: fingerprint(block.original), error: block.error }
          } finally {
            this.controllers.delete(controller)
            if (run === this.runId) {
              this.persist()
              this.publish()
            }
          }
        }
      }
      await Promise.all([worker(), worker()])
    } catch (error) {
      if (run === this.runId) this.snapshot = { ...this.snapshot, message: cleanError(error) }
    } finally {
      if (run === this.runId) {
        this.snapshot = { ...this.snapshot, running: false }
        this.persist()
        this.publish()
      }
    }
  }

  async retry(blockId: string): Promise<void> { await this.start([blockId]) }

  private async getContext(signal: { aborted: boolean; addEventListener?: any; removeEventListener?: any }): Promise<{ summary?: string; glossary?: string }> {
    const needsContext = this.input.text.length >= 2500
    if (needsContext && (!this.stored.summary || !this.stored.glossary)) {
      try {
        const context = await generateNovelTranslationContext(this.input.title, this.input.text, {
          summary: !this.stored.summary, glossary: !this.stored.glossary,
        }, signal)
        if (signal.aborted) return {}
        if (context.summary) this.stored.summary = context.summary
        if (context.glossary) this.stored.glossary = context.glossary
        this.persist()
      } catch {
        // 上下文生成失败不妨碍逐段翻译。
      }
    }
    let glossary = this.stored.glossary ?? ""
    if (this.input.seriesId) {
      const path = seriesPath(this.uid, this.input.seriesId)
      const saved = readStored(path)
      glossary = mergeGlossary(saved?.model === this.model ? saved.glossary ?? "" : "", glossary)
      if (glossary) writeTextSafely(path, JSON.stringify({ version: 1, model: this.model, mode: "original", blocks: {}, glossary }))
    }
    return { summary: this.stored.summary, glossary }
  }
}

const sessions = new Map<string, NovelTranslationSession>()
const resumeAfterMinimize = new Set<NovelTranslationSession>()

export function getNovelTranslationSession(input: NovelTranslationInput): NovelTranslationSession {
  const key = `${resolveEffectiveUID()}:${input.novelId}:${modelIdentity()}:${fingerprint(input.text)}`
  let session = sessions.get(key)
  if (!session) {
    session = new NovelTranslationSession(input)
    sessions.set(key, session)
  }
  return session
}

export function pauseAllNovelTranslations(): void {
  for (const session of sessions.values()) {
    if (session.getSnapshot().running) {
      resumeAfterMinimize.add(session)
      session.pause()
    }
  }
}

export function resumeMinimizedNovelTranslations(): void {
  for (const session of resumeAfterMinimize) void session.start()
  resumeAfterMinimize.clear()
}

/** 登录账号或文本模型变化后，停止旧请求并丢弃其内存视图；磁盘缓存仍按账号和模型隔离。 */
export function discardNovelTranslationSessions(): void {
  for (const session of sessions.values()) session.pause()
  sessions.clear()
  resumeAfterMinimize.clear()
}

export function novelTranslationCacheUsage(): { count: number; bytes: number } {
  const dir = `${pixivDataDirectory()}/NovelTranslations/users/${resolveEffectiveUID()}`
  if (!FileManager.existsSync(dir)) return { count: 0, bytes: 0 }
  let count = 0
  let bytes = 0
  for (const name of FileManager.readDirectorySync(dir, false)) {
    if (!/^(?:\d+|series-\d+)\.json(?:\.bak)?$/.test(name)) continue
    const path = `${dir}/${name}`
    if (FileManager.isDirectorySync(path)) continue
    count += 1
    bytes += FileManager.statSync(path).size || 0
  }
  return { count, bytes }
}

export function clearNovelTranslationCache(): void {
  const uid = resolveEffectiveUID()
  for (const [key, session] of sessions) {
    if (key.startsWith(`${uid}:`)) {
      session.clear()
      sessions.delete(key)
      resumeAfterMinimize.delete(session)
    }
  }
  const dir = `${pixivDataDirectory()}/NovelTranslations/users/${uid}`
  if (!FileManager.existsSync(dir)) return
  for (const name of FileManager.readDirectorySync(dir, false)) {
    if (!/^(?:\d+|series-\d+)\.json(?:\.bak)?$/.test(name)) continue
    const path = `${dir}/${name}`
    if (!FileManager.isDirectorySync(path)) FileManager.removeSync(path)
  }
}
