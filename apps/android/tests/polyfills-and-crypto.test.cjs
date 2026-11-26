const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function compileTs(relPath, mocks = {}, globals = {}) {
  const fullPath = path.join(__dirname, "..", relPath)
  const source = fs.readFileSync(fullPath, "utf8")
  const js = ts.transpileModule(source, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const ctx = {
    module,
    exports: module.exports,
    require(id) {
      if (id in mocks) return mocks[id]
      if (id === "./polyfills") return compileTs("src/scripting/polyfills.ts", mocks, globals)
      throw new Error(`Missing mock module: ${id}`)
    },
    console,
    Uint8Array,
    DataView,
    ArrayBuffer,
    TextEncoder,
    TextDecoder,
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
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    globalThis: {},
    ...globals,
  }
  ctx.globalThis = ctx
  vm.runInNewContext(js, ctx, { filename: fullPath })
  return module.exports
}

test("PolyfillURL 完整支持 protocol/origin/username/password/searchParams", () => {
  const { PolyfillURL } = compileTs("src/scripting/polyfills.ts")
  const u = new PolyfillURL("https://user:pass@app-api.pixiv.net:443/v1/illust/detail?illust_id=123&filter=for_ios#top")
  assert.equal(u.protocol, "https:")
  assert.equal(u.origin, "https://app-api.pixiv.net")
  assert.equal(u.host, "app-api.pixiv.net")
  assert.equal(u.hostname, "app-api.pixiv.net")
  assert.equal(u.username, "user")
  assert.equal(u.password, "pass")
  assert.equal(u.pathname, "/v1/illust/detail")
  assert.equal(u.searchParams.get("illust_id"), "123")
  assert.equal(u.searchParams.get("filter"), "for_ios")
  assert.equal(u.hash, "#top")

  const authRedirect = new PolyfillURL("pixiv://account/login?code=abc123&via=login")
  assert.equal(authRedirect.protocol, "pixiv:")
  assert.equal(authRedirect.host, "account")
  assert.equal(authRedirect.pathname, "/login")
  assert.equal(authRedirect.searchParams.get("code"), "abc123")
})

test("ScriptingCrypto.md5 与 Pixiv X-Client-Hash 标准一致，sha256 与 PKCE S256 一致", () => {
  const { ScriptingData, ScriptingCrypto } = compileTs("src/scripting/dataAndCrypto.ts")
  const crypto = require("node:crypto")

  const time = "2026-11-26T12:00:00+00:00"
  const salt = "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c"
  const expectedMd5 = crypto.createHash("md5").update(time + salt, "utf8").digest("hex")
  const actualMd5 = ScriptingCrypto.md5(ScriptingData.fromString(time + salt)).toHexString()
  assert.equal(actualMd5, expectedMd5)

  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  const expectedSha256 = crypto.createHash("sha256").update(verifier, "utf8").digest("base64url")
  const actualSha256 = ScriptingCrypto.sha256(ScriptingData.fromRawString(verifier))
    .toBase64String()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  assert.equal(actualSha256, expectedSha256)
})
