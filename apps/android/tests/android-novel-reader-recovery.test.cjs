const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function createTsLoader() {
  const cache = new Map()

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const js = ts.transpileModule(source, {
      fileName: absPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText

    const mod = { exports: {} }
    cache.set(absPath, mod)
    const ctx = {
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id.startsWith(".")) {
          const base = path.resolve(path.dirname(absPath), id)
          for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return load(cand)
          }
        }
        throw new Error(`Unexpected require "${id}" from ${absPath}`)
      },
      console,
      Math,
      Date,
      Error,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      JSON,
      parseInt,
    }
    vm.runInNewContext(js, ctx, { filename: absPath })
    return mod.exports
  }

  return load
}

const loadTs = createTsLoader()
const ANDROID_ROOT = path.resolve(__dirname, "..")

function loadRecovery() {
  return loadTs(path.resolve(ANDROID_ROOT, "src/app/features/novel/novelReaderRecovery.ts"))
}

function loadHtmlBuilder() {
  return loadTs(path.resolve(ANDROID_ROOT, "src/app/features/novel/novelHtmlBuilder.ts"))
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const DEFAULT_SETTINGS = {
  fontId: "songti",
  customFontPostscriptName: null,
  fontWeight: "regular",
  fontSize: 18,
  lineSpacingLevel: "normal",
  layoutDirection: "horizontal",
  pageDisplayMode: "continuous",
  translationTargetLanguage: "zh-CN",
}

test("shouldRebuildAfterCrash 只对渲染进程回收重建，普通加载失败不重建", () => {
  const recovery = loadRecovery()
  const state = { attempts: 0, lastAttemptAt: 0 }

  const success = recovery.shouldRebuildAfterCrash(
    { success: true, crashed: false },
    state,
    10_000,
  )
  assert.equal(success.rebuild, false)
  assert.equal(success.attempt, 0)
  assert.deepEqual(plain(success.state), { attempts: 0, lastAttemptAt: 0 })

  const plainFailure = recovery.shouldRebuildAfterCrash(
    { success: false, crashed: false },
    state,
    10_000,
  )
  assert.equal(plainFailure.rebuild, false)
  assert.equal(plainFailure.exhausted, false)
})

test("shouldRebuildAfterCrash 连续崩溃按上限重建，超出后返回 exhausted", () => {
  const recovery = loadRecovery()
  let state = { attempts: 0, lastAttemptAt: 0 }

  const first = recovery.shouldRebuildAfterCrash({ crashed: true }, state, 1_000)
  assert.equal(first.rebuild, true)
  assert.equal(first.attempt, 1)
  assert.deepEqual(plain(first.state), { attempts: 1, lastAttemptAt: 1_000 })
  state = first.state

  const second = recovery.shouldRebuildAfterCrash({ crashed: true }, state, 2_000)
  assert.equal(second.rebuild, true)
  assert.equal(second.attempt, 2)
  assert.equal(second.exhausted, false)
  state = second.state

  const third = recovery.shouldRebuildAfterCrash({ crashed: true }, state, 3_000)
  assert.equal(third.rebuild, false)
  assert.equal(third.exhausted, true)
  assert.equal(third.attempt, 2)
  assert.deepEqual(plain(third.state), { attempts: 2, lastAttemptAt: 2_000 })
})

test("nextRecoveryAttempt 在重试窗口过后重置预算，避免旧计数永久阻塞", () => {
  const recovery = loadRecovery()
  const exhausted = { attempts: 2, lastAttemptAt: 5_000 }

  const withinWindow = recovery.nextRecoveryAttempt(exhausted, 5_500, { windowMs: 1_000 })
  assert.equal(withinWindow.allowed, false)
  assert.equal(withinWindow.attempts, 2)

  const afterWindow = recovery.nextRecoveryAttempt(exhausted, 6_001, { windowMs: 1_000 })
  assert.equal(afterWindow.allowed, true)
  assert.equal(afterWindow.attempts, 1)
  assert.equal(afterWindow.lastAttemptAt, 6_001)
})

test("nextRecoveryAttempt 支持自定义上限并把非法计数归零", () => {
  const recovery = loadRecovery()

  const zeroBudget = recovery.nextRecoveryAttempt(
    { attempts: 0, lastAttemptAt: 0 },
    100,
    { maxAttempts: 0 },
  )
  assert.equal(zeroBudget.allowed, false)
  assert.equal(zeroBudget.attempts, 0)

  const dirty = recovery.nextRecoveryAttempt(
    { attempts: -3, lastAttemptAt: Number.NaN },
    200,
    { maxAttempts: 1.9 },
  )
  assert.equal(dirty.allowed, true)
  assert.equal(dirty.attempts, 1)
  assert.equal(dirty.lastAttemptAt, 200)
})

test("recoveryAnchorFromProgress 保留阅读块与文本锚点，并收敛非法进度", () => {
  const recovery = loadRecovery()

  const anchor = recovery.recoveryAnchorFromProgress({
    page: 7.9,
    chunkId: " chunk-12 ",
    offset: 42.8,
    quote: "  这是崩溃前读到的最后一段  ",
  })
  assert.deepEqual(plain(anchor), {
    chunkId: "chunk-12",
    page: 7,
    offset: 42,
    quote: "这是崩溃前读到的最后一段",
  })

  const fallback = recovery.recoveryAnchorFromProgress({
    page: Number.NaN,
    chunkId: "   ",
    offset: -10,
    quote: "   ",
  })
  assert.deepEqual(plain(fallback), { chunkId: null, page: 1, offset: 0 })
  assert.equal("quote" in fallback, false)
})

test("恢复锚点被 buildNovelReaderHtml 写入初始跳转与 owner generation", () => {
  const recovery = loadRecovery()
  const builder = loadHtmlBuilder()
  const chunks = builder.parseNovelToChunks(
    ["[chapter: 第一章]", "第一段。", "[newpage]", "第二段，崩溃前读到这里。"].join("\n"),
    undefined,
  )
  const anchor = recovery.recoveryAnchorFromProgress({
    page: 2,
    chunkId: "chunk-3",
    offset: 4,
    quote: "第二段，崩溃前读到这里。",
  })

  const html = builder.buildNovelReaderHtml({
    novelId: 123,
    title: "测试小说",
    chunks,
    settings: DEFAULT_SETTINGS,
    readerTheme: "light",
    systemIsDark: false,
    ownerGeneration: 9,
    initialChunkId: anchor.chunkId,
    initialPage: anchor.page,
    initialAnchor: anchor,
  })

  assert.ok(html.includes('"chunkId":"chunk-3"'))
  assert.ok(html.includes('"page":2'))
  assert.ok(html.includes('"offset":4'))
  assert.ok(html.includes('"quote":"第二段，崩溃前读到这里。"'))
  assert.ok(html.includes("var targetChunkId = \"chunk-3\";"))
  assert.ok(html.includes("var novelOwnerId = 9;"))
  assert.ok(html.includes("window.NovelReaderRuntime.jumpToAnchor(payload)"))
})

test("NovelReaderScreen / PixNativeWebView 接线 crashed 事件、remount 与恢复提示", () => {
  const screen = fs.readFileSync(
    path.resolve(ANDROID_ROOT, "src/app/features/novel/NovelReaderScreen.tsx"),
    "utf8",
  )
  assert.ok(screen.includes("onLoadComplete={(gen, success, crashed) =>"))
  assert.ok(screen.includes("rebuildReaderAfterCrash(false)"))
  assert.ok(screen.includes("key={webViewEpoch}"))
  assert.ok(screen.includes("initialHtml={activeHtml}"))
  assert.ok(screen.includes("htmlGeneration={activeGeneration}"))
  assert.ok(screen.includes("正在恢复阅读位置"))
  assert.ok(screen.includes("重试恢复"))
  assert.ok(screen.includes("recordNovelProgress(props.novelId, anchor.page, anchor.chunkId ?? undefined, true"))

  const webview = fs.readFileSync(
    path.resolve(ANDROID_ROOT, "src/app/features/novel/PixNativeWebView.tsx"),
    "utf8",
  )
  assert.ok(webview.includes("const crashed = Boolean(evt.crashed)"))
  assert.ok(webview.includes("onLoadComplete?.(gen, success, crashed)"))
})
