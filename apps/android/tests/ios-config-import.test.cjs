const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function createTestEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pix-android-import-"))
  const keychainLocal = new Map()
  const keychainSync = new Map()

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
    copyFileSync: (a, b) => {
      fs.cpSync(a, b, { recursive: true })
    },
  }

  const Keychain = {
    get: (k, o) => (o?.synchronizable ? keychainSync.get(k) : keychainLocal.get(k)) ?? null,
    set: (k, v, o) => (o?.synchronizable ? keychainSync.set(k, v) : keychainLocal.set(k, v)),
    remove: (k, o) => (o?.synchronizable ? keychainSync.delete(k) : keychainLocal.delete(k)),
  }

  const globals = {
    FileManager,
    Keychain,
    Storage: { contains: () => false, get: () => null, set() {}, remove() {} },
    Device: { isiPad: false, isiPhone: true, colorScheme: "light" },
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise,
    setTimeout, clearTimeout, URL, URLSearchParams,
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
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "scripting") {
          return {
            Device: globals.Device,
            Script: { metadata: { version: "1.8.14.4" } },
            fetch: async () => ({}),
          }
        }
        if (id === "react-native") return { NativeModules: {} }
        if (id === "../scripting/hostGlobals") return { ScriptingFileManager: FileManager }
        if (id.startsWith(".")) {
          const base = path.resolve(path.dirname(absPath), id)
          for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return loadTs(cand)
          }
        }
        throw new Error(`Missing test dependency ${id} from ${absPath}`)
      },
    }, { filename: absPath })
    return mod.exports
  }

  const importer = loadTs(path.resolve(__dirname, "../src/import/iosConfigImporter.ts"))
  const settings = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/settings.ts"))
  const readerSettings = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/novelReaderSettings.ts"))
  const customAI = loadTs(path.resolve(__dirname, "../../../Pix-Scripting/src/store/customAI.ts"))

  return { root, importer, settings, readerSettings, customAI }
}

test("importIosConfigJson 支持直接导入 iOS 原始 settings.json 且剥离 iOS 目录书签", async () => {
  const { importer, settings } = createTestEnv()
  const iosRawSettings = {
    launchPage: "ranking",
    pageLayout: "classic",
    imageSourceMode: "custom",
    customImageBaseUrl: "https://i.pixiv.nl",
    apiGatewayMode: "custom",
    customApiBaseUrl: "https://proxy.example.com",
    showR18: true,
    downloadCustomDirectoryBookmark: "ios-bookmark-blob",
    downloadCustomDirectoryPath: "/var/mobile/Containers/Data/...",
  }

  const res = await importer.importIosConfigJson(JSON.stringify(iosRawSettings))
  assert.equal(res.detectedKind, "app-settings")
  assert.equal(res.appliedAppSettings, true)

  const loaded = settings.loadSettings()
  assert.equal(loaded.launchPage, "ranking")
  assert.equal(loaded.pageLayout, "classic")
  assert.equal(loaded.customImageBaseUrl, "https://i.pixiv.nl")
  assert.equal(loaded.customApiBaseUrl, "https://proxy.example.com")
  assert.equal(loaded.showR18, true)
  assert.equal(loaded.downloadCustomDirectoryBookmark, null)
  assert.equal(loaded.downloadCustomDirectoryPath, null)
})

test("importIosConfigJson 支持导入 iOS novel_reader_settings.json 与 CustomAIProfile", async () => {
  const { importer, readerSettings, customAI } = createTestEnv()

  const readerRes = await importer.importIosConfigJson(JSON.stringify({
    fontId: "songti",
    fontSize: 21,
    layoutDirection: "vertical",
    pageDisplayMode: "paged",
    translationTargetLanguage: "zh-TW",
  }))
  assert.equal(readerRes.detectedKind, "novel-reader-settings")
  assert.equal(readerSettings.loadNovelReaderSettings().fontSize, 21)
  assert.equal(readerSettings.loadNovelReaderSettings().translationTargetLanguage, "zh-TW")

  const aiRes = await importer.importIosConfigJson(JSON.stringify({
    enabled: true,
    syncToICloud: false,
    general: {
      preset: "deepseek-chat",
      protocol: "openai-responses",
      endpoint: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-test-token",
      supportsVision: false,
    },
    imageGen: {
      enabled: false,
      protocol: "openai-images",
      endpoint: "",
      model: "",
      apiKey: "",
      reuseGeneralKey: true,
    },
  }))
  assert.equal(aiRes.detectedKind, "custom-ai")
  assert.equal(aiRes.appliedCustomAI, true)
  assert.equal(customAI.loadCustomAIProfile().general.model, "deepseek-chat")
})

test("convertRawIosJsonFileToSyncBundlePath 可把 iOS settings.json 包装为跨设备同步包路径", () => {
  const { root, importer } = createTestEnv()
  const rawPath = path.join(root, "settings.json")
  fs.writeFileSync(rawPath, JSON.stringify({
    launchPage: "following",
    pageLayout: "appleMusic",
    imageSourceMode: "pixiv_re",
  }))
  const convertedPath = importer.convertRawIosJsonFileToSyncBundlePath(rawPath)
  const converted = JSON.parse(fs.readFileSync(convertedPath, "utf8"))
  assert.equal(converted.format, "pix-scripting-sync")
  assert.equal(converted.schemaVersion, 1)
  assert.equal(converted.appSettings.launchPage, "following")
})

test("importIosConfigJson 支持标准 pix-scripting-sync v1 跨设备同步包", async () => {
  const { importer, settings, readerSettings } = createTestEnv()
  const res = await importer.importIosConfigJson(JSON.stringify({
    format: "pix-scripting-sync",
    schemaVersion: 1,
    exportedAt: Date.now(),
    uid: "10086",
    appSettings: {
      launchPage: "ranking",
      pageLayout: "classic",
      showR18: true,
    },
    novelReaderSettings: {
      fontId: "kaiti",
      fontSize: 19,
      layoutDirection: "vertical",
    },
    blocklist: {
      blockedTags: ["spoiler"],
      blockedUsers: [{ id: 99, name: "Artist99" }],
    },
  }))
  assert.equal(res.detectedKind, "sync-bundle")
  assert.equal(res.appliedAppSettings, true)
  assert.equal(res.appliedReaderSettings, true)
  assert.equal(res.addedBlockedTags, 1)
  assert.equal(res.addedBlockedUsers, 1)
  assert.equal(settings.loadSettings().launchPage, "ranking")
  assert.equal(readerSettings.loadNovelReaderSettings().fontId, "kaiti")
})
