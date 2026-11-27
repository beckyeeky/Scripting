const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("../node_modules/typescript")

// 纯逻辑模块不依赖 react-native / Scripting 宿主，可直接转译后在 vm 里执行。
function loadTsModule(absPath) {
  const source = fs.readFileSync(absPath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absPath,
  }).outputText

  const mod = { exports: {} }
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", compiled)
  fn(mod.exports, require, mod, absPath, path.dirname(absPath))
  return mod.exports
}

const guardPath = path.resolve(__dirname, "../src/app/settings/privacyScreenGuard.ts")
const guard = loadTsModule(guardPath)

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get(key) {
      return data.has(key) ? data.get(key) : null
    },
    set(key, value) {
      data.set(key, value)
    },
    remove(key) {
      data.delete(key)
    },
  }
}

function makeBridge() {
  const calls = []
  return {
    calls,
    setSecureScreen(enabled) {
      calls.push(enabled)
    },
  }
}

test("privacyScreenGuard：键名稳定且默认关闭", () => {
  assert.equal(guard.PRIVACY_SCREEN_GUARD_KEY, "pix_privacy_screen_guard_v1")
  assert.equal(guard.DEFAULT_PRIVACY_SCREEN_GUARD, false)

  assert.equal(guard.readPrivacyScreenGuard(null), false)
  assert.equal(guard.readPrivacyScreenGuard(undefined), false)
  assert.equal(guard.readPrivacyScreenGuard(makeStorage()), false)
})

test("privacyScreenGuard：写入后读回，storage 异常不抛出", () => {
  const storage = makeStorage()
  assert.equal(guard.writePrivacyScreenGuard(storage, true), true)
  assert.equal(storage.get(guard.PRIVACY_SCREEN_GUARD_KEY), true)
  assert.equal(guard.readPrivacyScreenGuard(storage), true)

  guard.writePrivacyScreenGuard(storage, false)
  assert.equal(guard.readPrivacyScreenGuard(storage), false)

  const broken = {
    get() {
      throw new Error("get failed")
    },
    set() {
      throw new Error("set failed")
    },
    remove() {
      throw new Error("remove failed")
    },
  }
  assert.equal(guard.readPrivacyScreenGuard(broken), false)
  assert.equal(guard.writePrivacyScreenGuard(broken, true), false)
})

test("privacyScreenGuard：只把明确的「开」值解析为开启", () => {
  for (const value of [true, 1, "true", " TRUE "]) {
    assert.equal(guard.normalizePrivacyScreenGuard(value), true, `expected ${String(value)} true`)
  }
  for (const value of [false, 0, "false", "0", "", null, undefined, {}, "yes"]) {
    assert.equal(guard.normalizePrivacyScreenGuard(value), false, `expected ${String(value)} false`)
  }
})

test("privacyScreenGuard：开关变化先持久化再向 bridge 下发精确布尔", () => {
  const storage = makeStorage()
  const bridge = makeBridge()

  assert.equal(guard.setPrivacyScreenGuard(storage, bridge, true), true)
  assert.deepEqual(bridge.calls, [true])
  assert.equal(storage.get(guard.PRIVACY_SCREEN_GUARD_KEY), true)

  guard.setPrivacyScreenGuard(storage, bridge, false)
  assert.deepEqual(bridge.calls, [true, false])
  assert.equal(storage.get(guard.PRIVACY_SCREEN_GUARD_KEY), false)
})

test("privacyScreenGuard：启动恢复按已存设置下发，缺省也显式关闭", () => {
  const enabledBridge = makeBridge()
  const enabledStorage = makeStorage({ [guard.PRIVACY_SCREEN_GUARD_KEY]: true })
  assert.equal(guard.restorePrivacyScreenGuard(enabledStorage, enabledBridge), true)
  assert.deepEqual(enabledBridge.calls, [true])

  const freshBridge = makeBridge()
  assert.equal(guard.restorePrivacyScreenGuard(makeStorage(), freshBridge), false)
  assert.deepEqual(freshBridge.calls, [false])
})

test("privacyScreenGuard：bridge 缺失或抛错不阻塞设置保存", () => {
  const storage = makeStorage()
  assert.equal(guard.setPrivacyScreenGuard(storage, null, true), false)
  assert.equal(guard.readPrivacyScreenGuard(storage), true)

  const throwing = {
    setSecureScreen() {
      throw new Error("no active activity")
    },
  }
  assert.equal(guard.applyPrivacyScreenGuard(throwing, true), false)
  assert.equal(guard.restorePrivacyScreenGuard(storage, undefined), true)
})

test("privacyScreenGuard：恢复默认设置清空键并关闭遮罩", () => {
  const storage = makeStorage({ [guard.PRIVACY_SCREEN_GUARD_KEY]: true })
  const bridge = makeBridge()

  guard.resetPrivacyScreenGuard(storage, bridge)
  assert.equal(storage.get(guard.PRIVACY_SCREEN_GUARD_KEY), null)
  assert.deepEqual(bridge.calls, [false])
  assert.equal(guard.readPrivacyScreenGuard(storage), false)
})

const kotlinDir = path.resolve(__dirname, "../android/app/src/main/java/com/pixscripting")
const secureScreenKt = fs.readFileSync(path.join(kotlinDir, "PixSecureScreen.kt"), "utf8")
const bridgeKt = fs.readFileSync(path.join(kotlinDir, "PixSystemBridgeModule.kt"), "utf8")
const mainActivityKt = fs.readFileSync(path.join(kotlinDir, "MainActivity.kt"), "utf8")

test("Kotlin：FLAG_SECURE 只随开关加/清，不触碰其它 Window flag", () => {
  assert.match(secureScreenKt, /window\.addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/)
  assert.match(secureScreenKt, /window\.clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/)

  const flags = secureScreenKt.match(/WindowManager\.LayoutParams\.FLAG_[A-Z_]+/g) ?? []
  assert.deepEqual([...new Set(flags)], ["WindowManager.LayoutParams.FLAG_SECURE"])
})

test("Kotlin：setSecureScreen 可排队，Activity 创建/回前台时补应用", () => {
  assert.match(bridgeKt, /@ReactMethod\s+fun setSecureScreen\(enabled: Boolean\)/)
  assert.match(bridgeKt, /PixSecureScreen\.setDesired\(enabled\)/)
  // Activity 尚未创建时只记录期望值，不直接抛错
  assert.match(bridgeKt, /val activity = currentActivity \?: return/)
  // OAuth 登录 WebView 是独立 Window，需要单独继承遮罩
  assert.match(bridgeKt, /PixSecureScreen\.requested\(\) == true/)

  assert.match(mainActivityKt, /override fun onCreate\([\s\S]*?PixSecureScreen\.applyPending\(this\)/)
  assert.match(mainActivityKt, /override fun onResume\(\)[\s\S]*?PixSecureScreen\.applyPending\(this\)/)
})

test("接线：设置页开关写入并下发，App 启动时恢复", () => {
  const settingsTsx = fs.readFileSync(
    path.resolve(__dirname, "../src/app/features/account/SettingsScreen.tsx"),
    "utf8",
  )
  assert.match(settingsTsx, /value=\{privacyScreenGuard\}/)
  assert.match(settingsTsx, /updatePrivacyScreenGuard\(enabled\)/)
  assert.match(settingsTsx, /clearPrivacyScreenGuard\(\)/)

  const appTsx = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8")
  assert.match(appTsx, /syncPrivacyScreenGuardOnLaunch\(\)/)
})
