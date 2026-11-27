const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
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

function loadTsModule(relFromAndroid, customMocks = {}) {
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
      decodeURIComponent,
      encodeURIComponent,
      globalThis: {},
    }
    ctx.globalThis = ctx
    vm.runInNewContext(transpile(absPath), ctx, { filename: absPath })
    return mod.exports
  }

  return load(path.resolve(ANDROID_ROOT, relFromAndroid))
}

const plain = (value) => JSON.parse(JSON.stringify(value))

function loadNaming() {
  return loadTsModule("src/scripting/exportDirectoryNaming.ts")
}

const {
  DEFAULT_EXPORT_DIRECTORY_LABEL,
  MAX_EXPORT_FILE_NAME_LENGTH,
  displayNameFromTreeUri,
  evaluateExportDirectoryStatus,
  exportDeliveryMessage,
  fileNameFromPath,
  nextAvailableFileName,
  sanitizeExportFileName,
} = loadNaming()

test("重名递增：目标名冲突时按 (1)/(2) 递增并保留扩展名", () => {
  assert.equal(nextAvailableFileName("pixiv_123_p1.jpg", []), "pixiv_123_p1.jpg")
  assert.equal(nextAvailableFileName("pixiv_123_p1.jpg", ["pixiv_123_p1.jpg"]), "pixiv_123_p1 (1).jpg")
  assert.equal(
    nextAvailableFileName("pixiv_123_p1.jpg", ["pixiv_123_p1.jpg", "pixiv_123_p1 (1).jpg"]),
    "pixiv_123_p1 (2).jpg",
  )
  assert.equal(
    nextAvailableFileName("PIXIV_123_P1.JPG", ["pixiv_123_p1.jpg"]),
    "PIXIV_123_P1 (1).jpg",
  )
})

test("重名递增：多扩展名只对最后一段扩展名加序号", () => {
  assert.equal(nextAvailableFileName("archive.tar.gz", ["archive.tar.gz"]), "archive.tar (1).gz")
  assert.equal(
    nextAvailableFileName("archive.tar.gz", ["archive.tar.gz", "archive.tar (1).gz"]),
    "archive.tar (2).gz",
  )
})

test("重名递增：无扩展名补全 bin，目录穿越名只保留最后一段", () => {
  assert.equal(nextAvailableFileName("notes", []), "notes.bin")
  assert.equal(nextAvailableFileName("notes", ["notes.bin"]), "notes (1).bin")
  assert.equal(nextAvailableFileName("../../etc/passwd", []), "passwd.bin")
  assert.equal(nextAvailableFileName("..\\..\\evil.png", []), "evil.png")
})

test("重名递增：非法字符替换后仍能正确加序号", () => {
  assert.equal(sanitizeExportFileName("pixiv:1?p2*.jpg"), "pixiv_1_p2.jpg")
  assert.equal(nextAvailableFileName("pixiv:1?p2*.jpg", ["pixiv_1_p2.jpg"]), "pixiv_1_p2 (1).jpg")
})

test("重名递增：超长文件名截断后总长不超上限且保留序号与扩展名", () => {
  const desired = `${"名".repeat(300)}.txt`
  const first = nextAvailableFileName(desired, [])
  assert.ok(Array.from(first).length <= MAX_EXPORT_FILE_NAME_LENGTH)
  assert.ok(first.endsWith(".txt"))

  const second = nextAvailableFileName(desired, [first])
  assert.ok(Array.from(second).length <= MAX_EXPORT_FILE_NAME_LENGTH)
  assert.ok(second.endsWith(" (1).txt"))
  assert.notEqual(first, second)
})

test("文件名清洗：空值回退 export.bin，非法扩展名回退 bin", () => {
  assert.equal(sanitizeExportFileName(""), "export.bin")
  assert.equal(sanitizeExportFileName("   ...  "), "export.bin")
  assert.equal(sanitizeExportFileName("file.verylongextension"), "file.bin")
})

test("URI 权限状态：未配置/缺少写授权/目录不可达都判定为需处理", () => {
  assert.equal(evaluateExportDirectoryStatus(null, null), "none")
  assert.equal(evaluateExportDirectoryStatus({ uri: "" }, { writeGranted: true }), "none")
  assert.equal(evaluateExportDirectoryStatus({ uri: "   " }, null), "none")

  assert.equal(
    evaluateExportDirectoryStatus(
      { uri: "content://com.android.externalstorage.documents/tree/primary%3ADownload" },
      { writeGranted: true, reachable: true },
    ),
    "ready",
  )
  assert.equal(
    evaluateExportDirectoryStatus(
      { uri: "content://com.android.externalstorage.documents/tree/primary%3ADownload" },
      { writeGranted: false, reachable: true },
    ),
    "revoked",
  )
  assert.equal(
    evaluateExportDirectoryStatus(
      { uri: "content://com.android.externalstorage.documents/tree/primary%3ADownload" },
      { writeGranted: true, reachable: false },
    ),
    "revoked",
  )
  assert.equal(
    evaluateExportDirectoryStatus({ uri: "file:///sdcard/Pix" }, { writeGranted: true }),
    "revoked",
  )
  assert.equal(
    evaluateExportDirectoryStatus({ uri: "CONTENT://provider/tree/primary%3APix" }, { writeGranted: true }),
    "ready",
  )
})

test("tree URI 显示名兜底：取 volume 之后最后一段路径并解码", () => {
  assert.equal(
    displayNameFromTreeUri("content://com.android.externalstorage.documents/tree/primary%3ADownload%2FPix-Scripting"),
    "Pix-Scripting",
  )
  assert.equal(
    displayNameFromTreeUri("content://com.android.externalstorage.documents/tree/primary%3ADownload"),
    "Download",
  )
  assert.equal(displayNameFromTreeUri(""), "")
  assert.equal(fileNameFromPath("/data/user/0/app/cache/ugoira_42.mp4"), "ugoira_42.mp4")
  assert.equal(fileNameFromPath("content://x/y/report.epub?x=1"), "report.epub")
})

test("导出提示：SAF 成功给出目录与文件名，失败提示回退位置并引导重新选择", () => {
  const ok = exportDeliveryMessage({ mode: "saf", directoryName: "Pix", fileName: "a.txt" })
  assert.equal(ok.tone, "success")
  assert.ok(ok.text.includes("Pix"))
  assert.ok(ok.text.includes("a.txt"))

  const revoked = exportDeliveryMessage({ mode: "fallback", reason: "revoked" }, "系统相册")
  assert.equal(revoked.tone, "error")
  assert.ok(revoked.text.includes("系统相册"))
  assert.ok(revoked.text.includes("重新选择"))

  const failed = exportDeliveryMessage({ mode: "fallback", reason: "write-failed" })
  assert.equal(failed.tone, "error")
  assert.ok(failed.text.includes("写入失败"))

  assert.equal(exportDeliveryMessage({ mode: "fallback", reason: "not-configured" }), null)
  assert.equal(DEFAULT_EXPORT_DIRECTORY_LABEL, "默认（应用专属目录）")
})

function loadDelivery(bridge, shareCalls) {
  return loadTsModule("src/scripting/exportDirectory.ts", {
    "react-native": { NativeModules: { PixSystemBridge: bridge } },
    "./hostGlobals": {
      ScriptingShareSheet: {
        present: async (items) => {
          shareCalls.push(items)
          return true
        },
      },
    },
  })
}

const TREE_URI = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2FPix"

test("deliverExportFile：目录可用时写入 SAF 并返回实际去重文件名", async () => {
  const shareCalls = []
  let writeArgs = null
  const bridge = {
    getExportDirectory: async () => ({
      uri: TREE_URI,
      name: "Pix",
      writeGranted: true,
      reachable: true,
    }),
    writeToExportDirectory: async (sourcePath, fileName) => {
      writeArgs = [sourcePath, fileName]
      return { name: "novel (1).epub", directoryName: "Pix" }
    },
  }
  const mod = loadDelivery(bridge, shareCalls)

  const result = await mod.deliverExportFile("/cache/novel.epub", { fallback: "share" })

  assert.deepEqual(plain(result), { mode: "saf", fileName: "novel (1).epub", directoryName: "Pix" })
  assert.deepEqual(writeArgs, ["/cache/novel.epub", "novel.epub"])
  assert.equal(shareCalls.length, 0)
})

test("deliverExportFile：授权撤销时回退分享并返回 revoked，不静默丢文件", async () => {
  const shareCalls = []
  const bridge = {
    getExportDirectory: async () => ({
      uri: TREE_URI,
      name: "Pix",
      writeGranted: false,
      reachable: false,
    }),
    writeToExportDirectory: async () => {
      throw new Error("should not be called")
    },
  }
  const mod = loadDelivery(bridge, shareCalls)

  const result = await mod.deliverExportFile("/cache/novel.epub", { fallback: "share" })

  assert.deepEqual(plain(result), { mode: "fallback", reason: "revoked" })
  assert.deepEqual(plain(shareCalls), [["/cache/novel.epub"]])
})

test("deliverExportFile：写入抛错回退默认位置，返回 write-failed", async () => {
  const shareCalls = []
  const bridge = {
    getExportDirectory: async () => ({
      uri: TREE_URI,
      name: "Pix",
      writeGranted: true,
      reachable: true,
    }),
    writeToExportDirectory: async () => {
      throw new Error("disk full")
    },
  }
  const mod = loadDelivery(bridge, shareCalls)

  const result = await mod.deliverExportFile("/cache/ugoira.mp4", { fallback: "none" })
  assert.deepEqual(plain(result), { mode: "fallback", reason: "write-failed" })
  assert.equal(shareCalls.length, 0)

  const message = mod.exportDeliveryMessage(result, "系统相册")
  assert.equal(message.tone, "error")
  assert.ok(message.text.includes("系统相册"))
})

test("deliverExportFile：未选择目录时保持既有分享行为", async () => {
  const shareCalls = []
  const bridge = {
    getExportDirectory: async () => null,
  }
  const mod = loadDelivery(bridge, shareCalls)

  const result = await mod.deliverExportFile("/cache/report.txt", { fallback: "share" })

  assert.deepEqual(plain(result), { mode: "fallback", reason: "not-configured" })
  assert.deepEqual(plain(shareCalls), [["/cache/report.txt"]])
  assert.equal(mod.exportDeliveryMessage(result), null)
})

test("Kotlin 原生桥接：包含 SAF 目录持久化、授权检查与重名写入实现", () => {
  const kotlin = fs.readFileSync(
    path.resolve(
      __dirname,
      "../android/app/src/main/java/com/pixscripting/PixSystemBridgeModule.kt",
    ),
    "utf8",
  )
  assert.ok(kotlin.includes("fun pickDirectory(promise: Promise)"))
  assert.ok(kotlin.includes("ACTION_OPEN_DOCUMENT_TREE"))
  assert.ok(kotlin.includes("takePersistableUriPermission"))
  assert.ok(kotlin.includes("fun getExportDirectory(promise: Promise)"))
  assert.ok(kotlin.includes("fun clearExportDirectory(promise: Promise)"))
  assert.ok(kotlin.includes("fun writeToExportDirectory(sourcePath: String, fileName: String?, promise: Promise)"))
  assert.ok(kotlin.includes("persistedUriPermissions"))
  assert.ok(kotlin.includes("DocumentsContract.createDocument"))
  assert.ok(kotlin.includes("DocumentsContract.deleteDocument"))
  assert.ok(kotlin.includes("E_SAF_DIR_REVOKED"))
  assert.ok(kotlin.includes("EXPORT_DIR_MAX_NAME_LENGTH = 80"))
  assert.ok(kotlin.includes("fun uniqueExportName"))
})
