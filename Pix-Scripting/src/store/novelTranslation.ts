import { AbortController } from "scripting"
import {
  isAIAvailable,
  translateNovelPassage,
  generateNovelTranslationContext,
  getNovelTranslationThinkingNotice,
  splitNovelPassageIntoThree,
  validateNovelTranslation,
} from "../api/aiService"
import { loadCustomAIProfile, isCustomAIConfigured, getEffectiveGeneralEndpoint } from "./customAI"
import { resolveGeneralAIConfigRoute } from "../api/aiAdapters"
import { pixivDataDirectory, resolveEffectiveUID } from "./dataDirectory"
import { recoverFile, writeTextSafely } from "./safeFile"
import type { NovelTranslationTargetLanguage } from "./novelReaderSettings"

export type TranslationDisplayMode = "original" | "translated"
export type TranslationBlockStatus = "pending" | "running" | "done" | "error"
export type TranslationContextStatus = "pending" | "running" | "ready" | "skipped" | "error"

export interface TranslationBlock {
  id: string
  original: string
  kind: "text" | "chapter"
  translation?: string
  status: TranslationBlockStatus
  error?: string
}

export interface NovelTranslationSnapshot {
  novelId: number
  targetLanguage: NovelTranslationTargetLanguage
  mode: TranslationDisplayMode
  running: boolean
  blocks: Record<string, TranslationBlock>
  done: number
  total: number
  failed: number
  phase: "idle" | "summary" | "glossary" | "translating"
  summaryStatus: TranslationContextStatus
  glossaryStatus: TranslationContextStatus
  translatedTitle?: string
  translatedCaption?: string
  summary?: string
  glossary?: string
  glossaryCount: number
  seriesGlossaryCount: number
  thinkingNotice: string
  message?: string
}

export interface NovelTranslationInput {
  novelId: number
  title: string
  caption: string
  text: string
  targetLanguage: NovelTranslationTargetLanguage
  seriesId?: number | null
  blocks: Array<{ id: string; text: string; kind?: "text" | "chapter" }>
}

interface StoredTranslation {
  version: 2
  model: string
  source: string
  titleFingerprint?: string
  captionFingerprint?: string
  seriesId?: number | null
  mode: TranslationDisplayMode
  blocks: Record<string, { source: string; translation?: string; error?: string }>
  translatedTitle?: string
  translatedCaption?: string
  summary?: string
  glossary?: string
  glossarySkipped?: boolean
}

function fingerprint(value: string): string {
  const data = Data.fromRawString(value)
  if (!data) throw new Error("无法计算小说正文指纹")
  return Crypto.sha256(data).toHexString()
}

function modelIdentity(targetLanguage: NovelTranslationTargetLanguage): string {
  if (!isCustomAIConfigured()) return targetLanguage === "zh-CN"
    ? "scripting-assistant"
    : `scripting-assistant:${targetLanguage}`
  const config = resolveGeneralAIConfigRoute(loadCustomAIProfile().general)
  // 密钥不参与指纹，也不写入缓存；翻译提示词或思考策略变更时自动失效。
  return fingerprint(JSON.stringify({ cacheVersion: 2, promptVersion: 3, thinkingPolicy: "off-v1",
    protocol: config.protocol, endpoint: getEffectiveGeneralEndpoint(config),
    model: config.model, temperature: config.temperature ?? null,
    ...(targetLanguage === "zh-CN" ? {} : { targetLanguage }) }))
}

function cacheLanguageSuffix(targetLanguage: NovelTranslationTargetLanguage): string {
  return targetLanguage === "zh-CN" ? "" : `-${targetLanguage}`
}

function novelPath(uid: string, novelId: number, targetLanguage: NovelTranslationTargetLanguage): string {
  return `${pixivDataDirectory()}/NovelTranslations/users/${uid}/${novelId}${cacheLanguageSuffix(targetLanguage)}.json`
}

function seriesPath(uid: string, seriesId: number, targetLanguage: NovelTranslationTargetLanguage): string {
  return `${pixivDataDirectory()}/NovelTranslations/users/${uid}/series-${seriesId}${cacheLanguageSuffix(targetLanguage)}.json`
}

function readStored(path: string): StoredTranslation | null {
  try {
    recoverFile(path)
    if (!FileManager.existsSync(path)) return null
    const parsed = JSON.parse(FileManager.readAsStringSync(path, "utf-8")) as StoredTranslation
    return parsed?.version === 2 && parsed.blocks && typeof parsed.blocks === "object" ? parsed : null
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
  if (/译文质量检查失败|链接占位符/.test(value)) return value.slice(0, 160)
  return "翻译失败，请检查网络与模型设置后重试"
}

function glossaryEntries(value: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of value.split("\n")) {
    const parts = line.split(/[｜|]/).map((part) => part.trim())
    const source = parts[1]?.trim()
    if (source && parts[2] && source.length <= 100 && parts[2].length <= 100) {
      result.set(source.toLowerCase(), `${parts[0] || "名称"}｜${source}｜${parts[2]}${parts[3] ? `｜${parts[3]}` : ""}`)
    }
  }
  return result
}

function mergeGlossary(series: string, novel: string): string {
  const entries = glossaryEntries(series)
  for (const [source, line] of glossaryEntries(novel)) if (!entries.has(source)) entries.set(source, line)
  return Array.from(entries.values()).slice(0, 120).join("\n")
}

const seriesGlossaries = new Map<string, string>()
const CACHE_WRITE_WARNING = "本地译文缓存写入失败；当前会话可继续，退出后可能需要重新翻译"

export class NovelTranslationSession {
  private input: NovelTranslationInput
  private uid: string
  private model: string
  private stored: StoredTranslation
  private snapshot: NovelTranslationSnapshot
  private listeners = new Set<(snapshot: NovelTranslationSnapshot) => void>()
  private controllers = new Set<AbortController>()
  private runId = 0
  private persistent: boolean

  constructor(input: NovelTranslationInput) {
    const targetLanguage = input.targetLanguage ?? "zh-CN"
    this.input = { ...input, targetLanguage }
    this.uid = resolveEffectiveUID()
    this.model = modelIdentity(targetLanguage)
    this.persistent = isCustomAIConfigured()
    const saved = this.persistent ? readStored(novelPath(this.uid, input.novelId, targetLanguage)) : null
    const source = fingerprint(input.text)
    const titleFingerprint = fingerprint(input.title)
    const captionFingerprint = fingerprint(input.caption ?? "")
    const sameTitle = saved?.titleFingerprint === titleFingerprint
    // 旧缓存没有简介指纹：首次升级时保留昂贵的正文译文，并补生成标题/简介；之后简介变化会正常失效。
    const sameCaption = !saved?.captionFingerprint || saved.captionFingerprint === captionFingerprint
    const sameSeries = (saved?.seriesId ?? null) === (input.seriesId ?? null)
    const sameContext = saved?.source === source && sameTitle && sameCaption
    this.stored = saved?.model === this.model ? { ...saved, source, titleFingerprint, captionFingerprint,
      seriesId: input.seriesId ?? null,
      blocks: sameTitle && sameCaption ? saved.blocks : {},
      translatedTitle: sameContext ? saved.translatedTitle : undefined,
      translatedCaption: sameContext ? saved.translatedCaption : undefined,
      summary: sameContext ? saved.summary : undefined,
      glossary: saved.source === source && sameTitle && sameSeries ? saved.glossary : undefined,
      glossarySkipped: saved.source === source && sameTitle && sameSeries ? saved.glossarySkipped : undefined } : {
      version: 2, model: this.model, source, titleFingerprint, captionFingerprint, seriesId: input.seriesId ?? null,
      mode: saved?.mode ?? "original", blocks: {},
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
        kind: item.kind ?? "text",
        translation: valid ? saved.translation : undefined,
        status: valid && saved.translation ? "done" : valid && saved.error ? "error" : "pending",
        error: valid ? saved.error : undefined,
      }
    }
    this.stored.blocks = Object.fromEntries(Object.values(blocks).map((block) => [block.id, {
      source: fingerprint(block.original), translation: block.translation, error: block.error,
    }]))
    const seriesKey = this.input.seriesId ? `${this.uid}:${this.model}:${this.input.seriesId}` : ""
    const seriesFile = this.input.seriesId && this.persistent
      ? readStored(seriesPath(this.uid, this.input.seriesId, this.input.targetLanguage)) : null
    const inherited = seriesKey
      ? seriesGlossaries.get(seriesKey) ?? (seriesFile?.model === this.model ? seriesFile.glossary ?? "" : "")
      : ""
    const glossary = mergeGlossary(inherited, this.stored.glossary ?? "")
    const needsGlossary = this.input.text.length >= 500 || Boolean(this.input.seriesId)
    return this.count({ novelId: this.input.novelId, targetLanguage: this.input.targetLanguage,
      mode: this.stored.mode, running: false, blocks,
      done: 0, total: 0, failed: 0, phase: "idle",
      summaryStatus: this.stored.summary && this.stored.translatedTitle &&
        (!this.input.caption || this.stored.translatedCaption) ? "ready" : "pending",
      glossaryStatus: glossary ? "ready" : needsGlossary && !this.stored.glossarySkipped ? "pending" : "skipped",
      translatedTitle: this.stored.translatedTitle, translatedCaption: this.stored.translatedCaption,
      summary: this.stored.summary, glossary, glossaryCount: glossaryEntries(glossary).size,
      seriesGlossaryCount: glossaryEntries(inherited).size,
      thinkingNotice: getNovelTranslationThinkingNotice() })
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
    if (!this.persistent) return
    try {
      writeTextSafely(novelPath(this.uid, this.input.novelId, this.input.targetLanguage), JSON.stringify(this.stored))
    } catch {
      this.snapshot = { ...this.snapshot, message: CACHE_WRITE_WARNING }
    }
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
    const wasRunning = this.snapshot.running
    this.runId += 1
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    for (const block of Object.values(this.snapshot.blocks)) if (block.status === "running") block.status = "pending"
    this.snapshot = { ...this.snapshot, running: false, phase: "idle", message: undefined,
      summaryStatus: this.snapshot.summaryStatus === "running" ? "pending" : this.snapshot.summaryStatus,
      glossaryStatus: this.snapshot.glossaryStatus === "running" ? "pending" : this.snapshot.glossaryStatus }
    if (wasRunning) this.persist()
    this.publish()
  }

  clear(): void {
    this.pause()
    this.stored = { version: 2, model: this.model, source: fingerprint(this.input.text),
      titleFingerprint: fingerprint(this.input.title),
      captionFingerprint: fingerprint(this.input.caption ?? ""),
      seriesId: this.input.seriesId ?? null, mode: "original", blocks: {} }
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
    const needsContext = this.snapshot.summaryStatus !== "ready" ||
      this.snapshot.glossaryStatus === "pending" || this.snapshot.glossaryStatus === "error"
    if (targets.length === 0 && !needsContext) return
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
      if (targets.length > 0) {
        this.snapshot = { ...this.snapshot, phase: "translating" }
        this.publish()
      }
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
            const options = { title: this.input.title, summary: context.summary, glossary: context.glossary,
              signal: controller.signal, targetLanguage: this.input.targetLanguage, kind: block.kind }
            let translation: string
            try {
              translation = await translateNovelPassage(block.original, options)
            } catch (initialError) {
              if (run !== this.runId || controller.signal.aborted) return
              const errorText = initialError instanceof Error ? initialError.message : String(initialError)
              const retryable = block.kind === "text" && block.original.length >= 60 &&
                !/401|403|unauthorized|api.?key|鉴权|429|rate.limit|限流|timeout|超时|abort/i.test(errorText)
              const split = retryable ? splitNovelPassageIntoThree(block.original) : null
              if (!split) throw initialError
              const translatedParts: string[] = []
              for (const part of split.parts) {
                if (run !== this.runId || controller.signal.aborted) return
                // 子段直达单块翻译接口，不再进入本层失败拆分，保证原块最多三分一次。
                translatedParts.push(await translateNovelPassage(part, options))
              }
              translation = translatedParts[0] + split.separators[0] +
                translatedParts[1] + split.separators[1] + translatedParts[2]
              validateNovelTranslation(block.original, translation,
                this.input.targetLanguage, block.kind)
            }
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
        this.snapshot = { ...this.snapshot, running: false, phase: "idle" }
        this.persist()
        this.publish()
      }
    }
  }

  async retry(blockId: string): Promise<void> { await this.start([blockId]) }

  private async getContext(signal: { aborted: boolean; addEventListener?: any; removeEventListener?: any }): Promise<{ summary?: string; glossary?: string }> {
    const needsGlossary = this.input.text.length >= 500 || Boolean(this.input.seriesId)
    const seriesKey = this.input.seriesId ? `${this.uid}:${this.model}:${this.input.seriesId}` : ""
    const seriesFile = this.input.seriesId && this.persistent
      ? readStored(seriesPath(this.uid, this.input.seriesId, this.input.targetLanguage)) : null
    const inherited = seriesKey
      ? seriesGlossaries.get(seriesKey) ?? (seriesFile?.model === this.model ? seriesFile.glossary ?? "" : "")
      : ""
    if (!this.stored.summary || !this.stored.translatedTitle ||
      (this.input.caption && !this.stored.translatedCaption)) {
      this.snapshot = { ...this.snapshot, phase: "summary", summaryStatus: "running" }
      this.publish()
      try {
        const context = await generateNovelTranslationContext(this.input.title, this.input.caption, this.input.text, {
          summary: true, glossary: false, targetLanguage: this.input.targetLanguage,
        }, signal)
        if (signal.aborted) return {}
        if (!context.summary || !context.translatedTitle ||
          (this.input.caption && !context.translatedCaption)) throw new Error("标题、简介或摘要为空")
        this.stored.translatedTitle = context.translatedTitle
        this.stored.translatedCaption = context.translatedCaption
        this.stored.summary = context.summary
        this.snapshot = { ...this.snapshot, translatedTitle: context.translatedTitle,
          translatedCaption: context.translatedCaption, summary: context.summary, summaryStatus: "ready" }
        this.persist(); this.publish()
      } catch {
        if (signal.aborted) return {}
        this.snapshot = { ...this.snapshot, summaryStatus: "error" }
        this.publish()
      }
    }
    if (needsGlossary && !this.stored.glossary && !this.stored.glossarySkipped && !signal.aborted) {
      this.snapshot = { ...this.snapshot, phase: "glossary", glossaryStatus: "running" }
      this.publish()
      try {
        const context = await generateNovelTranslationContext(this.input.title, this.input.caption, this.input.text, {
          summary: false, glossary: true, knownGlossary: inherited,
          targetLanguage: this.input.targetLanguage,
        }, signal)
        if (signal.aborted) return {}
        const normalized = mergeGlossary("", context.glossary ?? "")
        if (!normalized && !/^(?:无|没有|none|no terms?)[。.!\s]*$/i.test(context.glossary?.trim() ?? "")) {
          throw new Error("术语表格式无效")
        }
        this.stored.glossary = normalized || undefined
        this.stored.glossarySkipped = !normalized
        this.snapshot = { ...this.snapshot, glossaryStatus: normalized || inherited ? "ready" : "skipped" }
        this.persist(); this.publish()
      } catch {
        if (signal.aborted) return {}
        this.snapshot = { ...this.snapshot, glossaryStatus: "error" }
        this.publish()
      }
    }
    let latestInherited = inherited
    let glossary = mergeGlossary(inherited, this.stored.glossary ?? "")
    if (this.input.seriesId) {
      const path = seriesPath(this.uid, this.input.seriesId, this.input.targetLanguage)
      // 其他章节可能在摘要/术语生成期间写入了新词，提交前重新读取并合并。
      const latestSeriesFile = this.persistent ? readStored(path) : null
      latestInherited = seriesGlossaries.get(seriesKey)
        ?? (latestSeriesFile?.model === this.model ? latestSeriesFile.glossary ?? "" : "")
      glossary = mergeGlossary(latestInherited, this.stored.glossary ?? "")
      if (glossary) {
        seriesGlossaries.set(seriesKey, glossary)
        if (this.persistent) {
          try {
            writeTextSafely(path, JSON.stringify({ version: 2, model: this.model,
              source: "series", seriesId: this.input.seriesId, mode: "original", blocks: {}, glossary }))
          } catch {
            this.snapshot = { ...this.snapshot, message: CACHE_WRITE_WARNING }
          }
        }
      }
    }
    if (signal.aborted) return {}
    this.snapshot = { ...this.snapshot, translatedTitle: this.stored.translatedTitle,
      translatedCaption: this.stored.translatedCaption, summary: this.stored.summary, glossary,
      glossaryCount: glossaryEntries(glossary).size,
      seriesGlossaryCount: glossaryEntries(latestInherited).size,
      glossaryStatus: glossary ? "ready" : this.snapshot.glossaryStatus }
    this.publish()
    return { summary: this.stored.summary, glossary }
  }
}

const sessions = new Map<string, NovelTranslationSession>()
const resumeAfterMinimize = new Set<NovelTranslationSession>()

export function getNovelTranslationSession(input: NovelTranslationInput): NovelTranslationSession {
  const owner = `${resolveEffectiveUID()}:${input.novelId}:`
  const key = `${owner}${modelIdentity(input.targetLanguage ?? "zh-CN")}:${input.seriesId ?? 0}:${fingerprint(input.title)}:${fingerprint(input.caption ?? "")}:${fingerprint(input.text)}:${fingerprint(JSON.stringify(input.blocks))}`
  let session = sessions.get(key)
  if (!session) {
    // 同一本小说的新原文或新模型不得与旧请求同时写入同一个缓存文件。
    for (const [oldKey, oldSession] of sessions) {
      if (oldKey.startsWith(owner)) {
        oldSession.pause()
        sessions.delete(oldKey)
        resumeAfterMinimize.delete(oldSession)
      }
    }
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
  seriesGlossaries.clear()
}

export function novelTranslationCacheUsage(): { count: number; bytes: number } {
  const dir = `${pixivDataDirectory()}/NovelTranslations/users/${resolveEffectiveUID()}`
  if (!FileManager.existsSync(dir)) return { count: 0, bytes: 0 }
  let count = 0
  let bytes = 0
  for (const name of FileManager.readDirectorySync(dir, false)) {
    if (!/^(?:\d+|series-\d+)(?:-[A-Za-z-]+)?\.json(?:\.bak)?$/.test(name)) continue
    const path = `${dir}/${name}`
    if (FileManager.isDirectorySync(path)) continue
    count += 1
    bytes += FileManager.statSync(path).size || 0
  }
  return { count, bytes }
}

export function clearNovelTranslationCache(): void {
  const uid = resolveEffectiveUID()
  for (const key of seriesGlossaries.keys()) if (key.startsWith(`${uid}:`)) seriesGlossaries.delete(key)
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
    if (!/^(?:\d+|series-\d+)(?:-[A-Za-z-]+)?\.json(?:\.bak)?$/.test(name)) continue
    const path = `${dir}/${name}`
    if (!FileManager.isDirectorySync(path)) FileManager.removeSync(path)
  }
}
