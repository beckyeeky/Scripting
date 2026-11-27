const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

function loadPureModule(relPath) {
  const filename = path.resolve(__dirname, "..", relPath)
  const source = fs.readFileSync(filename, "utf8")
  const js = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  const run = new Function("module", "exports", "require", js)
  run(mod, mod.exports, require)
  return mod.exports
}

const {
  normalizeApplicationId,
  normalizeVersionName,
  normalizeVersionCode,
  resolveAppMetadata,
  formatVersionNameLabel,
  formatVersionCodeLabel,
  formatApplicationIdLabel,
  formatAppVersionLabel,
} = loadPureModule("src/app/features/account/appMetadata.ts")

const NATIVE_BRIDGE = {
  applicationId: "com.pixscripting.preview",
  versionName: "1.8.14.4-alpha.4",
  versionCode: 4,
}

test("优先采用原生 BuildConfig 的真实包名、版本名与构建号", () => {
  const meta = resolveAppMetadata(NATIVE_BRIDGE, "1.8.14.4")
  assert.deepEqual(meta, {
    applicationId: "com.pixscripting.preview",
    versionName: "1.8.14.4-alpha.4",
    versionCode: 4,
    source: "native",
  })
  assert.equal(formatVersionNameLabel(meta), "v1.8.14.4-alpha.4")
  assert.equal(formatVersionCodeLabel(meta), "4")
  assert.equal(formatApplicationIdLabel(meta), "com.pixscripting.preview")
  assert.equal(formatAppVersionLabel(meta), "v1.8.14.4-alpha.4 (4)")
})

test("bridge 不可用时回退到 JS 单一版本来源，包名与构建号显示未知", () => {
  const meta = resolveAppMetadata(null, "1.8.14.4")
  assert.deepEqual(meta, {
    applicationId: null,
    versionName: "1.8.14.4",
    versionCode: null,
    source: "fallback",
  })
  assert.equal(formatApplicationIdLabel(meta), "未知")
  assert.equal(formatVersionCodeLabel(meta), "未知")
  assert.equal(formatAppVersionLabel(meta), "v1.8.14.4")
})

test("bridge 返回空对象或错误类型时不产生假包名与假版本号", () => {
  for (const raw of [{}, "oops", 42, [], undefined]) {
    const meta = resolveAppMetadata(raw, "1.8.14.4")
    assert.equal(meta.applicationId, null)
    assert.equal(meta.versionName, "1.8.14.4")
    assert.equal(meta.versionCode, null)
    assert.equal(meta.source, "fallback")
  }

  const noFallback = resolveAppMetadata(undefined, undefined)
  assert.equal(noFallback.versionName, "未知")
  assert.equal(formatVersionNameLabel(noFallback), "v未知")
})

test("normalizeApplicationId 只接受点分 Java 包名", () => {
  assert.equal(normalizeApplicationId(" com.pixscripting.preview "), "com.pixscripting.preview")
  assert.equal(normalizeApplicationId("com.pixscripting"), "com.pixscripting")
  assert.equal(normalizeApplicationId("single"), null)
  assert.equal(normalizeApplicationId("com.1pixscripting"), null)
  assert.equal(normalizeApplicationId("com..pixscripting"), null)
  assert.equal(normalizeApplicationId(""), null)
  assert.equal(normalizeApplicationId(null), null)
})

test("normalizeVersionName 去空白并拒绝空串", () => {
  assert.equal(normalizeVersionName(" 1.8.14.4-alpha.4 "), "1.8.14.4-alpha.4")
  assert.equal(normalizeVersionName("   "), null)
  assert.equal(normalizeVersionName(4), null)
})

test("normalizeVersionCode 只接受正整数", () => {
  assert.equal(normalizeVersionCode(4), 4)
  assert.equal(normalizeVersionCode("7"), 7)
  assert.equal(normalizeVersionCode(9.8), 9)
  assert.equal(normalizeVersionCode(0), null)
  assert.equal(normalizeVersionCode(-3), null)
  assert.equal(normalizeVersionCode("abc"), null)
  assert.equal(normalizeVersionCode(undefined), null)
})
