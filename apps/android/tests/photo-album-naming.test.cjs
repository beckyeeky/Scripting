const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const ANDROID_ROOT = path.resolve(__dirname, "..")

function transpile(absPath) {
  return ts.transpileModule(fs.readFileSync(absPath, "utf8"), {
    fileName: absPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
}

function loadNamingModule() {
  const absPath = path.resolve(ANDROID_ROOT, "src/scripting/photoAlbumNaming.ts")
  const mod = { exports: {} }
  const ctx = {
    module: mod,
    exports: mod.exports,
    require: () => {
      throw new Error("photoAlbumNaming.ts must stay dependency-free")
    },
  }
  vm.runInNewContext(transpile(absPath), ctx, { filename: absPath })
  return mod.exports
}

function loadTsModule(relFromAndroid, customMocks = {}, extraGlobals = {}) {
  const cache = new Map()

  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports
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
      ...extraGlobals,
      globalThis: {},
    }
    ctx.globalThis = ctx
    vm.runInNewContext(transpile(absPath), ctx, { filename: absPath })
    return mod.exports
  }

  return load(path.resolve(ANDROID_ROOT, relFromAndroid))
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

function loadHost(saveMediaToGallery) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pix-album-naming-"))
  const nativeFs = {
    getDirectoriesSync: () => ({ documents: tmpDir, temp: tmpDir, appGroup: tmpDir, icloud: tmpDir }),
    randomBytesBase64Sync: (len) => Buffer.alloc(len, 0xab).toString("base64"),
    fsExistsSync: (p) => fs.existsSync(p),
    fsIsDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    fsIsFileSync: (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
    fsMkdirSync: (p) => { fs.mkdirSync(p, { recursive: true }); return true },
    fsReadStringSync: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
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
    storageContainsSync: () => false,
    storageGetSync: () => null,
    storageSetSync: () => true,
    storageRemoveSync: () => true,
  }

  return loadTsModule("src/scripting/hostGlobals.ts", {
    "react-native": {
      Appearance: { getColorScheme: () => "dark" },
      AppState: { addEventListener: () => ({ remove() {} }) },
      BackHandler: { exitApp() {} },
      DeviceEventEmitter: createEventEmitter(),
      Dimensions: { get: () => ({ width: 412, height: 915, scale: 3 }), addEventListener: () => ({ remove() {} }) },
      LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } },
      Platform: { OS: "android" },
      NativeModules: {
        PixFileSystem: nativeFs,
        PixImageMedia: { saveMediaToGallery },
        PixSystemBridge: {},
      },
    },
  })
}

const {
  DEFAULT_PHOTO_ALBUM_NAME,
  MAX_ALBUM_FILE_STEM_LENGTH,
  MAX_PHOTO_ALBUM_NAME_LENGTH,
  mediaExtensionFromPath,
  resolvePhotoAlbumName,
  sanitizeAlbumFileName,
  shouldQuerySavedAssets,
  supportsAlbumSaveOptions,
} = loadNamingModule()

test("文件名清洗：保留安全名称、补全缺失扩展名", () => {
  assert.equal(sanitizeAlbumFileName("pixiv_123_p1", "jpg"), "pixiv_123_p1.jpg")
  assert.equal(sanitizeAlbumFileName("pixiv_123_p1.PNG", "jpg"), "pixiv_123_p1.png")
  assert.equal(sanitizeAlbumFileName("  ugoira_42  ", "mp4"), "ugoira_42.mp4")
})

test("文件名清洗：目录穿越与路径分隔符只保留最后一段", () => {
  assert.equal(sanitizeAlbumFileName("../../etc/passwd", "jpg"), "passwd.jpg")
  assert.equal(sanitizeAlbumFileName("..\\..\\evil.png", "jpg"), "evil.png")
  assert.equal(sanitizeAlbumFileName("/sdcard/DCIM/photo.webp", "jpg"), "photo.webp")
})

test("文件名清洗：非法字符替换为下划线并折叠", () => {
  assert.equal(sanitizeAlbumFileName("pixiv:1?p2*.jpg", "jpg"), "pixiv_1_p2.jpg")
  assert.equal(sanitizeAlbumFileName("pi\u0000xiv\n_1.jpg", "jpg"), "pi_xiv_1.jpg")
  assert.equal(sanitizeAlbumFileName('a<b>c|d"e.jpg', "jpg"), "a_b_c_d_e.jpg")
})

test("文件名清洗：空值或纯分隔符返回 null，交由原生回退源文件名", () => {
  assert.equal(sanitizeAlbumFileName(undefined, "jpg"), null)
  assert.equal(sanitizeAlbumFileName(null, "jpg"), null)
  assert.equal(sanitizeAlbumFileName("", "jpg"), null)
  assert.equal(sanitizeAlbumFileName("   ...  ", "jpg"), null)
  assert.equal(sanitizeAlbumFileName("../", "jpg"), null)
})

test("文件名清洗：非法 fallback 扩展名回退 jpg", () => {
  assert.equal(sanitizeAlbumFileName("pixiv_1", ""), "pixiv_1.jpg")
  assert.equal(sanitizeAlbumFileName("pixiv_1", "tar.gz"), "pixiv_1.jpg")
  assert.equal(sanitizeAlbumFileName("pixiv_1", ".png"), "pixiv_1.png")
})

test("文件名清洗：按码点限长且不产生孤立代理项，UTF-8 字节数不超 255", () => {
  const cjk = sanitizeAlbumFileName("名".repeat(200), "jpg")
  assert.equal(cjk, `${"名".repeat(MAX_ALBUM_FILE_STEM_LENGTH)}.jpg`)
  assert.ok(Buffer.byteLength(cjk, "utf8") <= 255)

  const emoji = sanitizeAlbumFileName("🎨".repeat(200), "jpeg")
  assert.equal(emoji, `${"🎨".repeat(MAX_ALBUM_FILE_STEM_LENGTH)}.jpeg`)
  assert.ok(Buffer.byteLength(emoji, "utf8") <= 255)
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji))
})

test("扩展名推断：大小写归一、无扩展名按媒体类型回退", () => {
  assert.equal(mediaExtensionFromPath("/a/b/c.PNG", "image"), "png")
  assert.equal(mediaExtensionFromPath("file:///a/b.mp4", "video"), "mp4")
  assert.equal(mediaExtensionFromPath("/a/b/noext", "image"), "jpg")
  assert.equal(mediaExtensionFromPath("/a/b/noext", "video"), "mp4")
  assert.equal(mediaExtensionFromPath("", "image"), "jpg")
})

test("相册名回退：空值使用默认名，斜杠不会创建多级目录", () => {
  assert.equal(DEFAULT_PHOTO_ALBUM_NAME, "Pix-Scripting")
  assert.equal(resolvePhotoAlbumName(undefined), "Pix-Scripting")
  assert.equal(resolvePhotoAlbumName(null), "Pix-Scripting")
  assert.equal(resolvePhotoAlbumName("   "), "Pix-Scripting")
  assert.equal(resolvePhotoAlbumName(".."), "Pix-Scripting")
  assert.equal(resolvePhotoAlbumName("  我的相册  "), "我的相册")
  assert.equal(resolvePhotoAlbumName("../我的/相册"), "我的_相册")
  assert.equal(resolvePhotoAlbumName("A/B\\C"), "A_B_C")
  assert.equal(resolvePhotoAlbumName("Pix:::Album"), "Pix_Album")
})

test("相册名回退：超长名称按码点截断", () => {
  assert.equal(
    resolvePhotoAlbumName("相".repeat(200)),
    "相".repeat(MAX_PHOTO_ALBUM_NAME_LENGTH),
  )
  assert.ok(Buffer.byteLength(resolvePhotoAlbumName("🎨".repeat(200)), "utf8") <= 255)
})

test("去轮询判定：仅当宿主具备真实 fetchAssets 能力时才轮询", () => {
  assert.equal(shouldQuerySavedAssets({ fetchAssets: async () => [] }), true)
  assert.equal(shouldQuerySavedAssets({ supportsAssetLookup: true, fetchAssets: () => [] }), true)
  assert.equal(shouldQuerySavedAssets({ supportsAssetLookup: false, fetchAssets: async () => [] }), false)
  assert.equal(shouldQuerySavedAssets({ fetchAssets: [] }), false)
  assert.equal(shouldQuerySavedAssets({}), false)
  assert.equal(shouldQuerySavedAssets(null), false)
  assert.equal(shouldQuerySavedAssets(undefined), false)
})

test("相册保存参数：仅宿主显式支持时才附加 albumName", () => {
  assert.equal(supportsAlbumSaveOptions({ supportsAlbumOptions: true }), true)
  assert.equal(supportsAlbumSaveOptions({}), false)
  assert.equal(supportsAlbumSaveOptions(null), false)
  assert.equal(supportsAlbumSaveOptions({ supportsAlbumOptions: "true" }), false)
})

test("Android 宿主：保存图片透传清洗后的文件名与相册名", async () => {
  const calls = []
  const host = loadHost(async (...args) => {
    calls.push(args)
    return "content://media/external/images/media/1"
  })

  assert.equal(host.ScriptingPhotos.supportsAssetLookup, false)
  assert.equal(host.ScriptingPhotos.supportsAlbumOptions, true)
  assert.equal(shouldQuerySavedAssets(host.ScriptingPhotos), false)

  const ok = await host.ScriptingPhotos.savePhoto("/cache/ab12cd34ef.jpg", {
    fileName: "pixiv:123?p1",
    albumName: "../我的相册",
  })

  assert.equal(ok, true)
  assert.deepEqual(calls, [["/cache/ab12cd34ef.jpg", "image", "我的相册", "pixiv_123_p1.jpg"]])
})

test("Android 宿主：保存视频透传文件名，空相册名回退默认", async () => {
  const calls = []
  const host = loadHost(async (...args) => {
    calls.push(args)
    return "content://media/external/video/media/2"
  })

  const ok = await host.ScriptingPhotos.saveVideo("/cache/hash.mp4", {
    fileName: "ugoira_42",
    albumName: undefined,
  })

  assert.equal(ok, true)
  assert.deepEqual(calls, [["/cache/hash.mp4", "video", "Pix-Scripting", "ugoira_42.mp4"]])
})

test("Android 宿主：原生保存失败仍以 reject 抛出，不被吞成 false", async () => {
  const host = loadHost(async () => {
    throw new Error("disk full")
  })

  await assert.rejects(
    () => host.ScriptingPhotos.savePhoto("/cache/a.jpg", { fileName: "pixiv_1" }),
    /disk full/,
  )
})

function albumMocks(settings) {
  return {
    "../store/settings": {
      loadSettings: () => settings,
      getDownloadImageQuality: () => "large",
    },
    "../image/imageLoader": { cachedFilePath: () => null, imageUrlOf: () => "" },
    "./downloadHelper": {
      fetchImageBinaryWithRetry: async () => null,
      runConcurrentTasks: async () => {},
    },
    "../platform/pro": { isScriptingProUser: () => false },
    "./backgroundTaskManager": {
      acquireGlobalKeepAlive: async () => {},
      releaseGlobalKeepAlive: async () => {},
    },
  }
}

test("photoAlbum：Android 能力标记下不轮询 fetchAssets，并透传文件名与设置中的相册名", async () => {
  let fetchCalls = 0
  const saveCalls = []
  const Photos = {
    supportsAssetLookup: false,
    supportsAlbumOptions: true,
    fetchAssets: async () => { fetchCalls++; return [] },
    fetchAlbums: async () => { throw new Error("Android 不应查询相簿") },
    createAlbum: async () => { throw new Error("Android 不应创建相簿") },
    savePhoto: async (source, opts) => { saveCalls.push([source, opts]); return true },
    saveVideo: async () => true,
  }
  const mocks = albumMocks({ downloadPhotoAlbumName: "我的相册" })
  const album = loadTsModule("../../Pix-Scripting/src/downloader/photoAlbum.ts", mocks, { Photos })

  const ok = await album.saveImageToPixivAlbum("/cache/a.jpg", "pixiv_1_p1")

  assert.equal(ok, true)
  assert.equal(fetchCalls, 0)
  assert.equal(saveCalls.length, 1)
  assert.equal(saveCalls[0][0], "/cache/a.jpg")
  assert.deepEqual(Object.keys(saveCalls[0][1]), ["fileName", "albumName"])
  assert.equal(saveCalls[0][1].fileName, "pixiv_1_p1")
  assert.equal(saveCalls[0][1].albumName, "我的相册")
})

test("photoAlbum：iOS 式宿主保持原有轮询与归类，保存参数不新增 albumName", async () => {
  let fetchCalls = 0
  const added = []
  const saveCalls = []
  const albumCollection = {
    title: "Pix-Scripting",
    localIdentifier: "album-1",
    addAssets: async (assets) => { added.push(...assets.map((a) => a.localIdentifier)) },
  }
  const Photos = {
    fetchAssets: async () => {
      fetchCalls++
      return fetchCalls === 1 ? [] : [{ localIdentifier: "new-asset-1" }]
    },
    fetchAlbums: async () => [albumCollection],
    createAlbum: async () => albumCollection,
    savePhoto: async (source, opts) => { saveCalls.push([source, opts]); return true },
    saveVideo: async () => true,
  }
  const mocks = albumMocks({ downloadPhotoAlbumName: "Pix-Scripting" })
  const album = loadTsModule("../../Pix-Scripting/src/downloader/photoAlbum.ts", mocks, { Photos })

  const ok = await album.saveImageToPixivAlbum("/cache/a.jpg", "pixiv_1_p1")

  assert.equal(ok, true)
  assert.equal(fetchCalls, 2)
  assert.equal(saveCalls.length, 1)
  assert.equal(saveCalls[0][0], "/cache/a.jpg")
  assert.deepEqual(Object.keys(saveCalls[0][1]), ["fileName"])
  assert.equal(saveCalls[0][1].fileName, "pixiv_1_p1")
  assert.deepEqual(added, ["new-asset-1"])
})
