const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadShareIntentModule() {
  const file = path.resolve(__dirname, "../src/app/intents/shareIntent.ts")
  const source = fs.readFileSync(file, "utf8")
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(js, { module: mod, exports: mod.exports }, { filename: file })
  return mod.exports
}

const { resolveIncomingIntent: resolveRaw } = loadShareIntentModule()

// Objects are created inside a vm realm; clone them so deepStrictEqual compares plain objects.
const resolveIncomingIntent = (intent) => JSON.parse(JSON.stringify(resolveRaw(intent)))

test("相册分享 image/* 的缓存路径会路由到以图搜图，而不是被当作配置导入", () => {
  const plan = resolveIncomingIntent({
    kind: "share",
    text: "我的配文",
    files: [
      {
        filePath: "/data/user/0/com.pixscripting/cache/shared-imports/7f3/IMG_20260101",
        name: "IMG_20260101",
        mimeType: "image/jpeg",
        size: 204800,
      },
    ],
  })

  assert.deepEqual(plan, {
    type: "share-image",
    filePath: "/data/user/0/com.pixscripting/cache/shared-imports/7f3/IMG_20260101",
    name: "IMG_20260101",
    mimeType: "image/jpeg",
  })
})

test("MIME 缺失时按图片扩展名识别（大小写不敏感）", () => {
  const plan = resolveIncomingIntent({
    kind: "share",
    files: [{ filePath: "/cache/shared-imports/a/SCAN.PNG", mimeType: "application/octet-stream" }],
  })

  assert.equal(plan.type, "share-image")
  assert.equal(plan.name, "SCAN.PNG")
})

test("多文件分享取第一个可读文件，图片优先于文本附件", () => {
  const plan = resolveIncomingIntent({
    kind: "share",
    files: [
      { filePath: "", name: "broken.jpg", mimeType: "image/jpeg" },
      { filePath: "/cache/a.jpg", name: "a.jpg", mimeType: "image/jpeg" },
      { filePath: "/cache/notes.txt", name: "notes.txt", mimeType: "text/plain" },
    ],
  })

  assert.equal(plan.type, "share-image")
  assert.equal(plan.filePath, "/cache/a.jpg")
})

test("zip / json / 文本附件保持原有导入分流", () => {
  assert.equal(
    resolveIncomingIntent({
      kind: "share",
      files: [{ filePath: "/cache/backup.zip", name: "backup.zip", mimeType: "application/zip" }],
    }).type,
    "share-archive",
  )
  assert.equal(
    resolveIncomingIntent({
      kind: "share",
      files: [{ filePath: "/cache/settings.json", name: "settings.json", mimeType: "application/json" }],
    }).type,
    "share-json",
  )
  assert.equal(
    resolveIncomingIntent({
      kind: "share",
      files: [{ filePath: "/cache/settings.json", name: "settings.json", mimeType: "application/octet-stream" }],
    }).type,
    "share-json",
  )
  assert.equal(
    resolveIncomingIntent({
      kind: "share",
      files: [{ filePath: "/cache/notes.txt", name: "notes.txt", mimeType: "text/plain" }],
    }).type,
    "share-text-file",
  )
})

test("文本分享仍交给链接 / JSON 分支处理", () => {
  assert.deepEqual(resolveIncomingIntent({ kind: "share", text: "  https://www.pixiv.net/artworks/1  ", files: [] }), {
    type: "share-text",
    text: "https://www.pixiv.net/artworks/1",
  })
})

test("不支持的附件类型给出可见提示而不是静默丢弃", () => {
  const plan = resolveIncomingIntent({
    kind: "share",
    files: [{ filePath: "/cache/doc.pdf", name: "doc.pdf", mimeType: "application/pdf" }],
  })

  assert.equal(plan.type, "share-unsupported")
  assert.match(plan.message, /application\/pdf/)
  assert.match(plan.message, /以图搜图/)
})

test("URI 读取失败时保留失败数量并生成错误提示", () => {
  const failed = resolveIncomingIntent({
    kind: "share",
    text: null,
    files: [],
    failedFileCount: 1,
  })
  assert.equal(failed.type, "share-unreadable")
  assert.match(failed.message, /无法读取分享的 1 个文件/)

  const missingPath = resolveIncomingIntent({
    kind: "share",
    files: [{ name: "IMG_1.jpg", mimeType: "image/jpeg" }],
  })
  assert.equal(missingPath.type, "share-unreadable")
  assert.match(missingPath.message, /缺少本地缓存路径/)

  const empty = resolveIncomingIntent({ kind: "share", files: [] })
  assert.equal(empty.type, "share-unreadable")
  assert.match(empty.message, /没有收到可读取的分享内容/)
})

test("深链 URL intent 与未知 intent 的分流保持稳定", () => {
  assert.deepEqual(resolveIncomingIntent({ kind: "url", url: " pix-scripting://illust/42 " }), {
    type: "url",
    url: "pix-scripting://illust/42",
  })
  assert.deepEqual(resolveIncomingIntent(null), { type: "ignore" })
  assert.deepEqual(resolveIncomingIntent({ kind: "share" }), {
    type: "share-unreadable",
    message: "没有收到可读取的分享内容，请重试。",
  })
  assert.deepEqual(resolveIncomingIntent({ kind: "unknown" }), { type: "ignore" })
})
