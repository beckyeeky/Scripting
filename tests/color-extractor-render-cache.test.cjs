const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function createMockUiImage(topColor, bottomColor, dominantColor) {
  return {
    width: 120,
    height: 160,
    averageColor: () => topColor,
    dominantColors: () => [
      { color: dominantColor, fraction: 0.55 },
      { color: bottomColor, fraction: 0.25 },
    ],
    croppedTo: (rect) => {
      const color = rect && rect.y > 0 ? bottomColor : topColor
      return {
        width: rect?.width ?? 60,
        height: rect?.height ?? 60,
        averageColor: () => color,
        dominantColors: () => [{ color, fraction: 0.8 }],
      }
    },
  }
}

function loadColorExtractor(files) {
  const sourcePath = path.join(__dirname, "../Pix-Scripting/src/image/colorExtractor.ts")
  const source = fs.readFileSync(sourcePath, "utf8")
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  let fromFileCalls = 0
  const mod = { exports: {} }
  const customRequire = (id) => {
    if (id === "./imageLoader") {
      return {
        cachedFilePath: (url) => (url && Object.prototype.hasOwnProperty.call(files, url) ? `/mock-cache/${encodeURIComponent(url)}` : null),
        loadImage: async (url) => (url && Object.prototype.hasOwnProperty.call(files, url) ? `/mock-cache/${encodeURIComponent(url)}` : null),
      }
    }
    throw new Error(`Unexpected module request: ${id}`)
  }

  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: customRequire,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Map,
    Math,
    Number,
    String,
    Array,
    Object,
    Promise,
    JSON,
    UIImage: {
      fromFile: (filePath) => {
        fromFileCalls += 1
        for (const [url, entry] of Object.entries(files)) {
          if (`/mock-cache/${encodeURIComponent(url)}` === filePath) {
            return entry
          }
        }
        return null
      },
    },
  }

  vm.runInNewContext(js, sandbox, { filename: sourcePath })
  return {
    api: mod.exports,
    getFromFileCalls: () => fromFileCalls,
  }
}

test("氛围色渲染缓存回归：getter 只读内存不解码，异步提取命中且并发合并", async () => {
  const validImage = createMockUiImage(
    { red: 210, green: 110, blue: 60 },
    { red: 40, green: 70, blue: 150 },
    { red: 230, green: 140, blue: 70 }
  )
  const validImageB = createMockUiImage(
    { red: 80, green: 190, blue: 140 },
    { red: 20, green: 40, blue: 90 },
    { red: 100, green: 220, blue: 170 }
  )
  const validImageSync = createMockUiImage(
    { red: 160, green: 90, blue: 210 },
    { red: 35, green: 25, blue: 70 },
    { red: 185, green: 115, blue: 235 }
  )

  const urlA = "https://regression.invalid/render-cache/illust-a.png"
  const urlB = "https://regression.invalid/render-cache/illust-b.png"
  const syncUrl = "https://regression.invalid/render-cache/illust-sync.png"
  const badUrl = "https://regression.invalid/render-cache/bad.png"
  const missingUrl = "https://regression.invalid/render-cache/missing.png"

  const { api, getFromFileCalls } = loadColorExtractor({
    [urlA]: validImage,
    [urlB]: validImageB,
    [syncUrl]: validImageSync,
    [badUrl]: null,
  })

  assert.equal(api.getCachedIllustAmbientPalette(null, false, "medium"), null)
  assert.equal(api.getCachedIllustAmbientPalette(undefined, true, "high"), null)
  assert.equal(api.getCachedIllustAmbientPalette("", false), null)
  assert.equal(getFromFileCalls(), 0, "空 URL 不得触发解码")

  assert.equal(api.getCachedIllustAmbientPalette(urlA, false, "medium"), null)
  assert.equal(api.getCachedIllustAmbientPalette(urlA, true, "high"), null)
  assert.equal(getFromFileCalls(), 0, "冷缓存渲染 getter 即使磁盘存在文件也不得同步解码")

  const filled = await api.extractIllustAmbientPalette(urlA)
  assert.ok(filled, "异步提取应返回可用色盘")
  assert.equal(getFromFileCalls(), 1, "异步提取只解码一次")

  const light = api.getCachedIllustAmbientPalette(urlA, false, "medium")
  const dark = api.getCachedIllustAmbientPalette(urlA, true, "high")
  assert.ok(light && typeof light.topColor === "string", "补全后浅色内存命中")
  assert.ok(dark && typeof dark.topColor === "string", "补全后深色内存命中")
  assert.notEqual(light.topColor, dark.topColor, "深浅色强度切片不应相同")
  assert.equal(getFromFileCalls(), 1, "内存命中后 getter 不得再次解码")

  const again = await api.extractIllustAmbientPalette(urlA)
  assert.equal(again, filled, "重复异步提取命中同一缓存对象")
  assert.equal(getFromFileCalls(), 1, "缓存命中后异步路径不得重复解码")

  const flightStart = getFromFileCalls()
  const [left, right] = await Promise.all([
    api.extractIllustAmbientPalette(urlB),
    api.extractIllustAmbientPalette(urlB),
  ])
  assert.ok(left && left === right, "同 URL 并发提取必须合并任务")
  assert.equal(getFromFileCalls(), flightStart + 1, "同 URL 并发提取只解码一次")
  assert.ok(api.getCachedIllustAmbientPalette(urlB, false, "low"), "并发完成后应写入内存缓存")

  const syncStart = getFromFileCalls()
  assert.equal(api.getCachedIllustAmbientPalette(syncUrl, false, "medium"), null)
  assert.equal(getFromFileCalls(), syncStart, "显式同步提取前 getter 仍不触发解码")
  const synced = api.extractIllustAmbientPaletteSync(syncUrl)
  assert.ok(synced, "显式同步提取应成功解码")
  assert.equal(getFromFileCalls(), syncStart + 1)
  assert.ok(api.getCachedIllustAmbientPalette(syncUrl, true, "low"), "同步提取结果应写入内存缓存")
  assert.equal(getFromFileCalls(), syncStart + 1)

  const missingStart = getFromFileCalls()
  assert.equal(api.getCachedIllustAmbientPalette(missingUrl, false), null)
  assert.equal(getFromFileCalls(), missingStart, "缺失文件 getter 不触发解码")

  const badStart = getFromFileCalls()
  assert.equal(api.getCachedIllustAmbientPalette(badUrl, false, "medium"), null)
  assert.equal(getFromFileCalls(), badStart, "损坏文件 getter 不触发解码")
  assert.equal(await api.extractIllustAmbientPalette(badUrl), null, "损坏文件异步提取应返回 null")
  assert.ok(getFromFileCalls() > badStart, "损坏文件异步提取应尝试解码")
  assert.equal(api.getCachedIllustAmbientPalette(badUrl, true, "high"), null, "失败结果不得写入内存缓存")
})
