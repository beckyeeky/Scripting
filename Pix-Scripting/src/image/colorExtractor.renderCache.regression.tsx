import { Script } from "scripting"
import { cacheFilePath, cachedFilePath } from "./imageLoader"
import {
  extractIllustAmbientPalette,
  extractIllustAmbientPaletteSync,
  getCachedIllustAmbientPalette,
} from "./colorExtractor"

// 64x64 双色 PNG。只用于把真实文件放进图片缓存，让同步解码路径有机会被误触发。
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUklEQVR42u3PMQ0AAAgDMORMDv6DGCRw8TWpgdYkr9LzqgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgtz4AEtrelWcgAAAABJRU5ErkJggg=="

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function installFromFileSpy(): { count: () => number; restore: () => void } {
  const api = UIImage as any
  const original = api.fromFile
  if (typeof original !== "function") {
    throw new Error("UIImage.fromFile 不可用，无法观察解码")
  }
  let calls = 0
  api.fromFile = (path: string) => {
    calls += 1
    return original.call(UIImage, path)
  }
  return {
    count: () => calls,
    restore: () => {
      api.fromFile = original
    },
  }
}

function plantPng(url: string): string {
  const path = cacheFilePath(url)
  const data = Data.fromBase64String(PNG_BASE64)
  if (!data) throw new Error("测试 PNG 无法解码为 Data")
  FileManager.writeAsDataSync(path, data)
  if (cachedFilePath(url) !== path) {
    throw new Error("测试图片没有进入可读取的本地缓存: " + url)
  }
  return path
}

async function run(): Promise<void> {
  const created: string[] = []
  const spy = installFromFileSpy()
  try {
    const emptyAt = spy.count()
    assert(getCachedIllustAmbientPalette(null, false, "medium") === null, "null URL 应返回 null")
    assert(getCachedIllustAmbientPalette(undefined, true, "high") === null, "undefined URL 应返回 null")
    assert(getCachedIllustAmbientPalette("", false) === null, "空 URL 应返回 null")
    assert(spy.count() === emptyAt, "空 URL 触发了 UIImage.fromFile")

    const url = "https://regression.invalid/render-cache/illust-a.png"
    created.push(plantPng(url))
    const cold = spy.count()
    // 与 useIllustAmbient 的渲染期读取相同：初始化与 synchronousPalette 都只应查内存。
    assert(
      getCachedIllustAmbientPalette(url, false, "medium") === null,
      "本地已有图片时，冷缓存渲染 getter 仍应返回 null"
    )
    assert(
      getCachedIllustAmbientPalette(url, true, "high") === null,
      "渲染 getter 的第二次内存读取不应解码"
    )
    assert(
      spy.count() === cold,
      "渲染 getter 调用了同步解码，fromFile 增加 " + String(spy.count() - cold)
    )

    // 与 useIllustAmbient effect 相同：先读内存，未命中再走已有异步提取。
    assert(getCachedIllustAmbientPalette(url, false, "medium") === null, "effect 的内存读取不应解码")
    const filled = await extractIllustAmbientPalette(url)
    assert(filled != null, "异步提取没有补全可解码的本地图片")
    assert(spy.count() === cold + 1, "异步补全应只解码一次，实际增加 " + String(spy.count() - cold))

    const light = getCachedIllustAmbientPalette(url, false, "medium")
    const dark = getCachedIllustAmbientPalette(url, true, "high")
    assert(light != null && typeof light.topColor === "string", "补全后浅色内存读取失败")
    assert(dark != null && typeof dark.topColor === "string", "补全后深色内存读取失败")
    assert(light.topColor !== dark.topColor, "深浅色强度切片不应相同")
    assert(spy.count() === cold + 1, "内存命中后又发生了同步解码")

    const again = await extractIllustAmbientPalette(url)
    assert(again === filled, "已补全的 URL 再次异步提取应返回同一缓存对象")
    assert(spy.count() === cold + 1, "内存命中后异步路径又解码了")

    const url2 = "https://regression.invalid/render-cache/illust-b.png"
    created.push(plantPng(url2))
    const flightAt = spy.count()
    const first = extractIllustAmbientPalette(url2)
    const second = extractIllustAmbientPalette(url2)
    const [left, right] = await Promise.all([first, second])
    assert(left != null && left === right, "在途任务没有返回同一色盘")
    assert(
      spy.count() === flightAt + 1,
      "并发异步提取没有合并解码，fromFile 增加 " + String(spy.count() - flightAt)
    )
    assert(getCachedIllustAmbientPalette(url2, false, "low") != null, "在途任务完成后内存缓存仍为空")

    const syncUrl = "https://regression.invalid/render-cache/illust-sync.png"
    created.push(plantPng(syncUrl))
    const syncAt = spy.count()
    assert(getCachedIllustAmbientPalette(syncUrl, false, "medium") === null, "显式同步 API 存在时，渲染 getter 仍只能查内存")
    assert(spy.count() === syncAt, "渲染 getter 误调用了同步解码")
    const synced = extractIllustAmbientPaletteSync(syncUrl)
    assert(synced != null, "显式同步提取没能解码已缓存文件，测试图片可能无效")
    assert(spy.count() === syncAt + 1, "显式同步提取没有解码")
    assert(getCachedIllustAmbientPalette(syncUrl, true, "low") != null, "显式同步提取没有写入渲染 getter 读取的内存缓存")
    assert(spy.count() === syncAt + 1, "同步提取写入后，渲染 getter 又解码了一次")

    const missing = "https://regression.invalid/render-cache/missing.png"
    const missingAt = spy.count()
    assert(cachedFilePath(missing) === null, "不存在的测试 URL 不应有本地文件")
    assert(getCachedIllustAmbientPalette(missing, false) === null, "无文件时渲染 getter 应返回 null")
    assert(spy.count() === missingAt, "无文件时渲染 getter 仍调用了 fromFile")

    const badUrl = "https://regression.invalid/render-cache/bad.png"
    const badPath = cacheFilePath(badUrl)
    FileManager.writeAsStringSync(badPath, "not-an-image", "utf-8")
    created.push(badPath)
    const badAt = spy.count()
    assert(getCachedIllustAmbientPalette(badUrl, false, "medium") === null, "损坏文件不应被渲染 getter 解码")
    assert(spy.count() === badAt, "损坏文件的渲染 getter 调用了 fromFile")
    assert(await extractIllustAmbientPalette(badUrl) === null, "损坏文件的异步提取应失败")
    assert(spy.count() > badAt, "损坏文件的异步路径没有尝试解码")
    assert(getCachedIllustAmbientPalette(badUrl, true, "high") === null, "失败的异步提取不应留下内存色盘")

    finish(spy, created, null)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    finish(spy, created, message)
  }
}

function finish(
  spy: { restore: () => void },
  created: string[],
  error: string | null
): void {
  spy.restore()
  for (const path of created) {
    try {
      if (FileManager.existsSync(path)) FileManager.removeSync(path)
    } catch (cleanupError) {
      console.log("cleanup failed " + path + " " + String(cleanupError))
    }
  }
  if (error) {
    console.log("RENDER_CACHE_REGRESSION_FAIL " + error)
    Script.exit({ ok: false, error })
    return
  }
  console.log("RENDER_CACHE_REGRESSION_OK")
  Script.exit({ ok: true })
}

run()
