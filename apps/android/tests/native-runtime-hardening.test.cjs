const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadTsModule(relFromAndroid, customMocks = {}, extraGlobals = {}) {
  const androidRoot = path.resolve(__dirname, "..")
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
        if (id in customMocks) return customMocks[id]
        if (id.startsWith(".")) {
          const base = path.resolve(path.dirname(absPath), id)
          for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return load(cand)
          }
        }
        throw new Error(`Unmocked dependency "${id}" from ${absPath}`)
      },
      console,
      Uint8Array,
      Int16Array,
      Uint32Array,
      DataView,
      ArrayBuffer,
      Math,
      Date,
      Error,
      TypeError,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      JSON,
      Promise,
      Symbol,
      setTimeout,
      clearTimeout,
      encodeURIComponent,
      decodeURIComponent,
      URL,
      URLSearchParams,
      globalThis: {},
      ...extraGlobals,
    }
    ctx.globalThis = ctx
    vm.runInNewContext(js, ctx, { filename: absPath })
    return mod.exports
  }

  return load(path.resolve(androidRoot, relFromAndroid))
}

function createEventEmitter() {
  const listeners = new Map()
  return {
    addListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(fn)
      return { remove: () => listeners.get(event)?.delete(fn) }
    },
    emit(event, payload) {
      for (const fn of Array.from(listeners.get(event) || [])) fn(payload)
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

test("PolyfillTextDecoder 流式解码多字节 CJK 与 Emoji 不产生 U+FFFD 乱码", () => {
  const { PolyfillTextDecoder, encodeUtf8 } = loadTsModule("src/scripting/polyfills.ts")
  const sample = "你好世界！Pixiv小説翻訳テスト🎨✨第1章"
  const fullBytes = encodeUtf8(sample)

  // Split every 2 bytes (guaranteed to split 3-byte CJK & 4-byte emoji mid-sequence)
  const decoder = new PolyfillTextDecoder("utf-8")
  let decoded = ""
  for (let i = 0; i < fullBytes.length; i += 2) {
    decoded += decoder.decode(fullBytes.subarray(i, i + 2), { stream: true })
  }
  decoded += decoder.decode()
  assert.equal(decoded, sample)
  assert.ok(!decoded.includes("\uFFFD"))

  // BOM handling
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encodeUtf8("hello")])
  assert.equal(new PolyfillTextDecoder("utf-8").decode(withBom), "hello")
  assert.equal(new PolyfillTextDecoder("utf-8", { ignoreBOM: true }).decode(withBom), "\uFEFFhello")
})

test("SSE 流式请求在原生先发 chunk 后再 getReader() 时不丢帧、不悬挂且保留错误与非 2xx JSON", async () => {
  const emitter = createEventEmitter()
  let lastReqOpts = null

  const rnMock = {
    DeviceEventEmitter: emitter,
    NativeModules: {
      PixHttp: {
        async streamRequest(reqId, opts) {
          lastReqOpts = opts
          if (opts.url.includes("error-429")) {
            return {
              status: 429,
              url: opts.url,
              headers: { "content-type": "application/json" },
              isStream: false,
              bodyBase64: Buffer.from(JSON.stringify({ error: { message: "rate limited" } })).toString("base64"),
              byteLength: 35,
            }
          }
          if (opts.url.includes("mid-error")) {
            // Emit one chunk + error BEFORE promise resolves (before getReader() is called!)
            emitter.emit("PixHttpStreamChunk", {
              reqId,
              chunkBase64: Buffer.from("data: ok\n\n").toString("base64"),
              done: false,
            })
            emitter.emit("PixHttpStreamChunk", {
              reqId,
              done: true,
              error: "socket reset by peer",
            })
            return { status: 200, url: opts.url, headers: { "content-type": "text/event-stream" }, isStream: true }
          }
          // Fast native thread emits chunks AND done=true BEFORE JS awaits promise / calls getReader()
          emitter.emit("PixHttpStreamChunk", {
            reqId,
            chunkBase64: Buffer.from("data: {\"text\":\"第一段\"}\n\n").toString("base64"),
            done: false,
          })
          emitter.emit("PixHttpStreamChunk", {
            reqId,
            chunkBase64: Buffer.from("data: [DONE]\n\n").toString("base64"),
            done: false,
          })
          emitter.emit("PixHttpStreamChunk", {
            reqId,
            chunkBase64: "",
            done: true,
          })
          return { status: 200, url: opts.url, headers: { "content-type": "text/event-stream" }, isStream: true }
        },
        abortRequest() {},
      },
      PixFileSystem: {},
    },
  }

  const { scriptingFetch, isStreamCandidateRequest } = loadTsModule("src/scripting/fetchAndHttp.ts", {
    "react-native": rnMock,
  })

  // Gemini :streamGenerateContent?alt=sse must be recognized as stream candidate
  assert.equal(
    isStreamCandidateRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=k",
      "POST",
      { "Content-Type": "application/json" },
      '{"contents":[]}',
    ),
    true,
  )
  assert.equal(
    isStreamCandidateRequest("https://api.example.com/v1/chat", "POST", { accept: "Text/Event-Stream" }, "{}"),
    true,
  )

  // 1. Pre-emitted chunks + done must all be delivered in order
  const res = await scriptingFetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"contents":[]}' },
  )
  assert.equal(lastReqOpts.timeoutMs, 180_000)
  assert.ok(res.body)
  const reader = res.body.getReader()
  const collected = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    collected.push(Buffer.from(value).toString("utf8"))
  }
  assert.equal(collected.join(""), 'data: {"text":"第一段"}\n\ndata: [DONE]\n\n')
  assert.equal(emitter.listenerCount("PixHttpStreamChunk"), 0)

  // 2. Non-2xx JSON response returns readable body via res.json() and cleans up listener
  const errRes = await scriptingFetch("https://api.openai.com/v1/chat/completions?error-429", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"stream":true}',
  })
  assert.equal(errRes.ok, false)
  assert.equal(errRes.status, 429)
  assert.deepEqual(await errRes.json(), { error: { message: "rate limited" } })
  assert.equal(emitter.listenerCount("PixHttpStreamChunk"), 0)

  // 3. Queued stream error rejects read() instead of silently returning done
  const midErrRes = await scriptingFetch("https://api.openai.com/v1/chat/completions?mid-error", {
    method: "POST",
    body: '{"stream":true}',
  })
  const midReader = midErrRes.body.getReader()
  const first = await midReader.read()
  assert.equal(first.done, false)
  assert.equal(Buffer.from(first.value).toString("utf8"), "data: ok\n\n")
  await assert.rejects(() => midReader.read(), /socket reset by peer/)
})

test("ScriptingFormData 正确编码 multipart/form-data 二进制与文本字段，handleRedirect 遵守 POST->GET 与跨源剥离鉴权", async () => {
  const emitter = createEventEmitter()
  const calls = []

  const rnMock = {
    DeviceEventEmitter: emitter,
    NativeModules: {
      PixHttp: {
        async request(reqId, opts) {
          calls.push({ reqId, opts })
          if (opts.url === "https://a.example.com/start") {
            return {
              status: 302,
              url: opts.url,
              headers: { location: "https://b.example.com/final" },
              bodyBase64: "",
              byteLength: 0,
            }
          }
          return {
            status: 200,
            url: opts.url,
            headers: { "content-type": "application/json" },
            bodyBase64: Buffer.from('{"ok":true}').toString("base64"),
            byteLength: 11,
          }
        },
        abortRequest() {},
      },
      PixFileSystem: {},
    },
  }

  const { scriptingFetch, ScriptingFormData } = loadTsModule("src/scripting/fetchAndHttp.ts", {
    "react-native": rnMock,
  })
  const { ScriptingData } = loadTsModule("src/scripting/dataAndCrypto.ts")

  const form = new ScriptingFormData()
  form.append("model", "gpt-image-1")
  form.append("file", new ScriptingData(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg", "search.jpg")

  await scriptingFetch("https://saucenao.com/search.php", {
    method: "POST",
    body: form,
  })

  assert.equal(calls.length, 1)
  const formCall = calls[0].opts
  assert.match(formCall.headers["Content-Type"], /^multipart\/form-data; boundary=/)
  assert.ok(formCall.bodyBase64)
  const rawMultipart = Buffer.from(formCall.bodyBase64, "base64")
  assert.ok(rawMultipart.toString("latin1").includes('name="model"\r\n\r\ngpt-image-1'))
  assert.ok(rawMultipart.toString("latin1").includes('name="file"; filename="search.jpg"\r\nContent-Type: image/jpeg'))
  assert.ok(rawMultipart.includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))

  // Manual redirect: POST + 302 -> GET, drops body/Content-Type, strips Authorization cross-origin, distinct reqId
  calls.length = 0
  const redirRes = await scriptingFetch("https://a.example.com/start", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "PixivAndroidApp/5.0.155",
    },
    body: "a=1",
    handleRedirect: async (req) => req,
  })
  assert.equal(redirRes.status, 200)
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0].reqId, calls[1].reqId)
  assert.equal(calls[1].opts.method, "GET")
  assert.equal(calls[1].opts.body, undefined)
  assert.equal(calls[1].opts.headers.Authorization, undefined)
  assert.equal(calls[1].opts.headers["Content-Type"], undefined)
  assert.equal(calls[1].opts.headers["User-Agent"], "PixivAndroidApp/5.0.155")
})

test("hostGlobals: hotTextCache 目录级失效、Storage JSON 往返、CSPRNG、Insets 与 OAuth 回调前缀", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pix-host-test-"))
  const storageMap = new Map()
  let capturedOAuthOpts = null
  let capturedBarStyle = null
  let readDiskCount = 0

  const nativeFs = {
    getDirectoriesSync: () => ({ documents: tmpDir, temp: tmpDir, appGroup: tmpDir, icloud: tmpDir }),
    randomBytesBase64Sync: (len) => Buffer.alloc(len, 0xab).toString("base64"),
    fsExistsSync: (p) => fs.existsSync(p),
    fsIsDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    fsIsFileSync: (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
    fsMkdirSync: (p) => { fs.mkdirSync(p, { recursive: true }); return true },
    fsReadStringSync: (p) => {
      if (!fs.existsSync(p)) return null
      readDiskCount++
      return fs.readFileSync(p, "utf8")
    },
    fsWriteStringSync: (p, c) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, c, "utf8")
      return true
    },
    fsReadBase64Sync: (p) => (fs.existsSync(p) ? fs.readFileSync(p).toString("base64") : null),
    fsWriteBase64Sync: (p, b) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, Buffer.from(b, "base64"))
      return true
    },
    fsWriteFromFileSync: (s, d) => { fs.copyFileSync(s, d); return true },
    fsReaddirSync: (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []),
    fsStatSync: (p) => {
      const st = fs.statSync(p)
      return { size: st.size, mtimeMs: st.mtimeMs, modificationDate: st.mtimeMs, isDirectory: st.isDirectory(), isFile: st.isFile() }
    },
    fsRemoveSync: (p) => { fs.rmSync(p, { recursive: true, force: true }); return true },
    fsRenameSync: (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); return true },
    fsCopySync: (a, b) => { fs.cpSync(a, b, { recursive: true }); return true },
    storageContainsSync: (k) => storageMap.has(k),
    storageGetSync: (k) => storageMap.get(k) ?? null,
    storageSetSync: (k, v) => { storageMap.set(k, v); return true },
    storageRemoveSync: (k) => { storageMap.delete(k); return true },
  }

  const rnMock = {
    Appearance: { getColorScheme: () => "dark" },
    AppState: { addEventListener: () => ({ remove() {} }) },
    BackHandler: { exitApp() {} },
    DeviceEventEmitter: createEventEmitter(),
    Dimensions: { get: () => ({ width: 412, height: 915, scale: 3 }), addEventListener: () => ({ remove() {} }) },
    LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } },
    Platform: { OS: "android" },
    NativeModules: {
      PixFileSystem: nativeFs,
      PixImageMedia: {
        encodeImageToBase64Sync: () => Buffer.from("jpeg-bytes").toString("base64"),
      },
      PixSystemBridge: {
        getWindowInsetsSync: () => ({ top: 38, bottom: 24, left: 0, right: 0, imeBottom: 280 }),
        setSystemBarStyle: (isDark) => { capturedBarStyle = isDark },
        presentOAuthWebView: async (opts) => {
          capturedOAuthOpts = opts
          return { cancelled: false, redirectUrl: "https://proxy.example.com/web/v1/users/auth/pixiv/callback?code=xyz", cookieHeader: "PHPSESSID=123" }
        },
      },
    },
  }

  try {
    const host = loadTsModule("src/scripting/hostGlobals.ts", { "react-native": rnMock })
    host.installHostGlobals(globalThis)

    // 1. Directory copyFileSync must invalidate nested JSON entries in hotTextCache
    const dirA = path.join(tmpDir, "srcDir")
    const dirB = path.join(tmpDir, "destDir")
    const fileB = path.join(dirB, "history.json")
    host.ScriptingFileManager.writeAsStringSync(fileB, '{"v":1}')
    assert.equal(host.ScriptingFileManager.readAsStringSync(fileB), '{"v":1}')
    const readsBefore = readDiskCount

    fs.mkdirSync(dirA, { recursive: true })
    fs.writeFileSync(path.join(dirA, "history.json"), '{"v":2}', "utf8")
    host.ScriptingFileManager.copyFileSync(dirA, dirB)
    assert.equal(host.ScriptingFileManager.readAsStringSync(fileB), '{"v":2}')
    assert.equal(readDiskCount, readsBefore + 1)

    // 2. .tmp. files must NOT be served from hotTextCache (so safeFile verifies disk)
    const tmpFile = path.join(tmpDir, "settings.json.tmp.123")
    host.ScriptingFileManager.writeAsStringSync(tmpFile, '{"a":1}')
    const readsBeforeTmp = readDiskCount
    assert.equal(host.ScriptingFileManager.readAsStringSync(tmpFile), '{"a":1}')
    assert.equal(readDiskCount, readsBeforeTmp + 1)

    // 3. Storage JSON round-trip + legacy plain string compatibility
    host.ScriptingStorage.set("obj", { nested: true, count: 42 })
    assert.deepEqual(JSON.parse(JSON.stringify(host.ScriptingStorage.get("obj"))), { nested: true, count: 42 })
    storageMap.set("legacy", "plain-text")
    assert.equal(host.ScriptingStorage.get("legacy"), "plain-text")

    // 4. CSPRNG via native randomBytesBase64Sync when globalThis.crypto absent
    const symKey = globalThis.Crypto.generateSymmetricKey(256)
    assert.equal(symKey.length, 32)
    assert.equal(symKey.toUint8Array()[0], 0xab)

    // 5. Window insets & system bar bridge
    assert.deepEqual(JSON.parse(JSON.stringify(host.getNativeWindowInsetsSync())), { top: 38, bottom: 24, left: 0, right: 0, imeBottom: 280 })
    host.setNativeSystemBarStyle(true)
    assert.equal(capturedBarStyle, true)

    // 6. OAuth WebViewController passes default + custom callback prefixes & dark mode
    const wv = new host.ScriptingWebViewController({ ephemeral: true })
    let seenRedirect = null
    wv.shouldAllowRequest = (req) => {
      seenRedirect = req.url
      return false
    }
    await wv.loadURL("https://proxy.example.com/web/v1/login?code_challenge=abc")
    await wv.present({ navigationTitle: "Pixiv 登录" })
    assert.ok(capturedOAuthOpts.redirectPrefixes.includes("https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback"))
    assert.ok(capturedOAuthOpts.redirectPrefixes.includes("https://proxy.example.com/web/v1/users/auth/pixiv/callback"))
    assert.ok(capturedOAuthOpts.redirectPrefixes.includes("pixiv://account/login"))
    assert.equal(capturedOAuthOpts.isDark, true)
    assert.equal(seenRedirect, "https://proxy.example.com/web/v1/users/auth/pixiv/callback?code=xyz")
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("iosConfigImporter: ZIP 备份正确导入 NovelReader/settings.json、NovelTranslations 并立即刷新内存缓存；组合 JSON 先应用网关再登录再写账号数据", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pix-importer-hardening-"))
  const keychainLocal = new Map()
  const keychainSync = new Map()
  let clearedHostCaches = 0
  let refreshedWithGateway = null

  const FileManager = {
    documentsDirectory: root,
    temporaryDirectory: `${root}/tmp`,
    appGroupDocumentsDirectory: `${root}/group`,
    iCloudDocumentsDirectory: root,
    isiCloudEnabled: false,
    existsSync: (p) => fs.existsSync(p),
    isDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    isFileSync: (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
    createDirectorySync: (p) => fs.mkdirSync(p, { recursive: true }),
    readAsStringSync: (p) => fs.readFileSync(p, "utf8"),
    writeAsStringSync: (p, c) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, c, "utf8")
    },
    readDirectorySync: (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []),
    statSync: (p) => ({ size: fs.statSync(p).size }),
    removeSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    renameSync: (a, b) => {
      fs.mkdirSync(path.dirname(b), { recursive: true })
      fs.renameSync(a, b)
    },
    copyFileSync: (a, b) => fs.cpSync(a, b, { recursive: true }),
  }

  // Create a fake extracted backup fixture that unzipArchive will copy into destDir
  const zipFixture = path.join(root, "fake-backup-tree")
  fs.mkdirSync(path.join(zipFixture, "Pix-Scripting/Settings"), { recursive: true })
  fs.mkdirSync(path.join(zipFixture, "Pix-Scripting/NovelReader"), { recursive: true })
  fs.mkdirSync(path.join(zipFixture, "Pix-Scripting/NovelTranslations/users/777"), { recursive: true })
  fs.mkdirSync(path.join(zipFixture, "Pix-Scripting/History/users/777"), { recursive: true })
  fs.writeFileSync(
    path.join(zipFixture, "Pix-Scripting/Settings/settings.json"),
    JSON.stringify({ launchPage: "following", pageLayout: "classic", showR18: true }),
  )
  // Real iOS path is NovelReader/settings.json!
  fs.writeFileSync(
    path.join(zipFixture, "Pix-Scripting/NovelReader/settings.json"),
    JSON.stringify({ fontId: "hiragino_mincho", fontSize: 22, layoutDirection: "vertical" }),
  )
  fs.writeFileSync(
    path.join(zipFixture, "Pix-Scripting/NovelTranslations/users/777/999.json"),
    JSON.stringify({ title: "Translated" }),
  )
  fs.writeFileSync(
    path.join(zipFixture, "Pix-Scripting/History/users/777/search_history.json"),
    JSON.stringify({
      illust: [{ query: "初音ミク", searchedAt: Date.now() }],
      novel: [],
      user: [],
      updatedAt: Date.now(),
    }),
  )

  const globals = {
    FileManager,
    Keychain: {
      get: (k, o) => (o?.synchronizable ? keychainSync.get(k) : keychainLocal.get(k)) ?? null,
      set: (k, v, o) => (o?.synchronizable ? keychainSync.set(k, v) : keychainLocal.set(k, v)),
      remove: (k, o) => (o?.synchronizable ? keychainSync.delete(k) : keychainLocal.delete(k)),
    },
    Storage: { contains: () => false, get: () => null, set() {}, remove() {} },
    Device: { isiPad: false, isiPhone: true, colorScheme: "light" },
    Data: { fromString: (s) => ({ toHexString: () => s }), fromRawString: (s) => ({ toHexString: () => s }) },
    Crypto: { md5: () => ({ toHexString: () => "deadbeef" }) },
    console: { log() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
  }

  const moduleCache = new Map()
  function loadTs(absPath) {
    if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports
    const source = fs.readFileSync(absPath, "utf8")
    const js = ts.transpileModule(source, {
      fileName: absPath,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const mod = { exports: {} }
    moduleCache.set(absPath, mod)
    vm.runInNewContext(js, {
      ...globals,
      JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
      setTimeout, clearTimeout,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "scripting") {
          return {
            Device: globals.Device,
            Script: { metadata: { version: "1.8.14.4" } },
            fetch: async (url) => {
              refreshedWithGateway = url
              return {
                status: 200,
                ok: true,
                data: async () => ({
                  toRawString: () => JSON.stringify({
                    access_token: "acc_777",
                    refresh_token: "ref_777",
                    expires_in: 3600,
                    user: { id: "777", name: "User777", account: "u777", is_premium: false },
                  }),
                }),
              }
            },
          }
        }
        if (id === "react-native") {
          return {
            NativeModules: {
              PixFileSystem: {
                unzipArchive: async (_zipPath, destDir) => {
                  fs.cpSync(zipFixture, destDir, { recursive: true })
                  return true
                },
              },
            },
          }
        }
        if (id === "../scripting/hostGlobals") {
          return {
            ScriptingFileManager: FileManager,
            clearHostFileCaches: () => { clearedHostCaches++ },
          }
        }
        if (id.startsWith(".")) {
          const base = path.resolve(path.dirname(absPath), id)
          for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return loadTs(cand)
          }
        }
        throw new Error(`Missing test dep ${id} from ${absPath}`)
      },
    }, { filename: absPath })
    return mod.exports
  }

  try {
    const importer = loadTs(path.resolve(__dirname, "../src/import/iosConfigImporter.ts"))
    const readerSettings = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/novelReaderSettings.ts"))
    const searchHistory = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/searchHistory.ts"))
    const blocklist = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/blocklist.ts"))
    const { session } = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/api/session.ts"))

    // 1. Combined JSON with custom OAuth gateway + refreshToken + blocklist:
    //    must apply gateway BEFORE refreshing token, and write blocklist under newly logged-in UID 777!
    const combinedRes = await importer.importIosConfigJson(JSON.stringify({
      format: "pix-scripting-sync",
      schemaVersion: 1,
      exportedAt: Date.now(),
      uid: "777",
      appSettings: {
        apiGatewayMode: "custom",
        customOauthBaseUrl: "https://custom-oauth.example.com",
      },
      refreshToken: "old_refresh_token",
      blocklist: { blockedTags: ["ai-spam"], blockedUsers: [] },
    }))
    assert.equal(combinedRes.appliedAuthSession, true)
    assert.equal(refreshedWithGateway, "https://custom-oauth.example.com/auth/token")
    assert.equal(session.userID, 777)
    assert.ok(blocklist.loadBlocklist().blockedTags.includes("ai-spam"))
    // Verify blocklist was written under users/777 (not anonymous)
    assert.ok(fs.existsSync(path.join(root, "Pix-Scripting/Blocklist/users/777/blocklist.json")))

    // 2. Warm searchHistory memory cache with empty state BEFORE ZIP import
    assert.deepEqual(Array.from(searchHistory.getSearchHistory("illust")), [])

    // 3. Import ZIP backup -> must load NovelReader/settings.json, restore NovelTranslations & History,
    //    AND immediately refresh in-memory searchHistory cache without restart!
    const zipRes = await importer.importIosZipBackup(path.join(root, "backup.zip"))
    assert.equal(zipRes.detectedKind, "ios-zip-backup")
    assert.equal(zipRes.appliedAppSettings, true)
    assert.equal(zipRes.appliedReaderSettings, true)
    assert.equal(readerSettings.loadNovelReaderSettings().fontId, "hiragino_mincho")
    assert.equal(readerSettings.loadNovelReaderSettings().fontSize, 22)
    assert.ok(zipRes.restoredOfflineDirs.includes("NovelTranslations"))
    assert.ok(zipRes.restoredOfflineDirs.includes("History"))
    assert.ok(clearedHostCaches > 0)
    // Immediate in-memory reload without restart:
    assert.deepEqual(Array.from(searchHistory.getSearchHistory("illust")), ["初音ミク"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Kotlin 原生桥接包含 Edge-to-Edge Insets、FORCE_DARK_OFF、OAuth 回调拦截与 file:// 分享规范化", () => {
  const ktDir = path.resolve(__dirname, "../android/app/src/main/java/com/pixscripting")
  const mainAct = fs.readFileSync(path.join(ktDir, "MainActivity.kt"), "utf8")
  const sysBridge = fs.readFileSync(path.join(ktDir, "PixSystemBridgeModule.kt"), "utf8")
  const webMgr = fs.readFileSync(path.join(ktDir, "PixWebViewManager.kt"), "utf8")
  const httpMod = fs.readFileSync(path.join(ktDir, "PixHttpModule.kt"), "utf8")

  assert.ok(mainAct.includes("WindowCompat.setDecorFitsSystemWindows(window, false)"))
  assert.ok(mainAct.includes("PixInsetsChanged"))
  assert.ok(mainAct.includes("WindowInsetsCompat.Type.displayCutout()"))
  assert.ok(mainAct.includes("WindowInsetsCompat.Type.ime()"))

  assert.ok(sysBridge.includes("fun getWindowInsetsSync()"))
  assert.ok(sysBridge.includes("fun setSystemBarStyle(isDark: Boolean)"))
  assert.ok(sysBridge.includes("/web/v1/users/auth/pixiv/callback"))
  assert.ok(sysBridge.includes("removeAllCookies {"))
  assert.ok(sysBridge.includes("wv.canGoBack()"))
  assert.ok(sysBridge.includes("normalizeFilePath(raw)"))

  assert.ok(webMgr.includes("FORCE_DARK_OFF"))
  assert.ok(webMgr.includes("isAlgorithmicDarkeningAllowed = false"))
  assert.ok(webMgr.includes("requestDisallowInterceptTouchEvent"))
  assert.ok(webMgr.includes("onRenderProcessGone"))
  assert.ok(webMgr.includes('"evaluateJS"'))
  assert.ok(webMgr.includes("topEvalResult"))

  assert.ok(httpMod.includes("GZIPInputStream"))
  assert.ok(httpMod.includes("InflaterInputStream"))
  assert.ok(httpMod.includes("maybePruneBlobs"))
})
