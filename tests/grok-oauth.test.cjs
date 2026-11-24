const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function compileTsModule(relPath, mocks) {
  const file = path.join(__dirname, "..", relPath)
  const source = fs.readFileSync(file, "utf8")
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const module = { exports: {} }
  const globals = {
    module,
    exports: module.exports,
    Date,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Object,
    Array,
    Promise,
    Set,
    Map,
    Error,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    console: { log() {} },
    URL,
    Data: {
      fromBase64String(b64) {
        return {
          toRawString() {
            return Buffer.from(b64, "base64").toString("utf8")
          },
        }
      },
    },
    ...(mocks.globals || {}),
    require(id) {
      if (!(id in (mocks.modules || {}))) {
        throw new Error(`missing test double: ${id}`)
      }
      return mocks.modules[id]
    },
  }
  vm.runInNewContext(js, globals, { filename: file })
  return module.exports
}

function createKeychainMock() {
  const local = new Map()
  const synced = new Map()
  return {
    get(key, opts) {
      const store = opts?.synchronizable ? synced : local
      return store.has(key) ? store.get(key) : null
    },
    set(key, val, opts) {
      const store = opts?.synchronizable ? synced : local
      store.set(key, val)
    },
    remove(key, opts) {
      const store = opts?.synchronizable ? synced : local
      store.delete(key)
    },
  }
}

test("customAI 支持 grok-oauth 预设隔离、强制 OAuth 与刷新令牌判定", () => {
  const Keychain = createKeychainMock()
  const customAI = compileTsModule("Pix-Scripting/src/store/customAI.ts", {
    globals: { Keychain },
    modules: {},
  })

  const preset = customAI.AI_PRESETS.find((p) => p.id === "grok-oauth")
  assert.ok(preset)
  assert.equal(preset.authMode, "oauth")
  assert.equal(preset.defaultEndpoint, "https://api.x.ai")

  customAI.switchCustomAIPreset("grok-oauth")
  customAI.updateCustomAIProfile({
    enabled: true,
    general: {
      preset: "grok-oauth",
      protocol: "openai-responses",
      endpoint: "",
      model: "grok-4",
      apiKey: "",
      noKeyRequired: true,
      supportsVision: true,
      oauthRefreshToken: "xai-rt-test",
      oauthExpiresAt: Date.now() + 3600_000,
      oauthAccountEmail: "user@example.com",
    },
  })

  const loaded = customAI.loadCustomAIProfile()
  assert.equal(loaded.general.noKeyRequired, false)
  assert.equal(loaded.general.oauthRefreshToken, "xai-rt-test")
  assert.equal(customAI.isCustomAIConfigured(), true)

  customAI.switchCustomAIPreset("openai")
  const openaiProfile = customAI.loadCustomAIProfile()
  assert.equal(openaiProfile.general.preset, "openai")
  assert.equal(openaiProfile.general.oauthRefreshToken, undefined)

  customAI.switchCustomAIPreset("grok-oauth")
  const restored = customAI.loadCustomAIProfile()
  assert.equal(restored.general.oauthRefreshToken, "xai-rt-test")
  assert.equal(restored.general.oauthAccountEmail, "user@example.com")
})

test("grokOAuth 完成设备码授权轮询并支持令牌过期自动刷新写回", async () => {
  const Keychain = createKeychainMock()
  const customAI = compileTsModule("Pix-Scripting/src/store/customAI.ts", {
    globals: { Keychain },
    modules: {},
  })

  const requests = []
  let pollAttempt = 0
  const jwtPayload = Buffer.from(JSON.stringify({ email: "grok@x.ai" }), "utf8")
    .toString("base64url")
  const fakeIdToken = `hdr.${jwtPayload}.sig`

  const fakeFetch = async (url, init = {}) => {
    requests.push({ url, method: init.method || "GET", body: init.body || "" })
    if (url.endsWith("/openid-configuration")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
            token_endpoint: "https://auth.x.ai/oauth2/token",
          }
        },
      }
    }
    if (url.endsWith("/device/code")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            device_code: "dev-123",
            user_code: "ABCD-EFGH",
            verification_uri: "https://accounts.x.ai/activate",
            verification_uri_complete: "https://accounts.x.ai/activate?user_code=ABCD-EFGH",
            expires_in: 900,
            interval: 1,
          }
        },
      }
    }
    if (url.endsWith("/oauth2/token")) {
      const body = String(init.body || "")
      if (body.includes("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")) {
        pollAttempt += 1
        if (pollAttempt === 1) {
          return {
            ok: false,
            status: 400,
            async json() {
              return { error: "authorization_pending" }
            },
          }
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              access_token: "xai-at-initial",
              refresh_token: "xai-rt-initial",
              expires_in: 3600,
              id_token: fakeIdToken,
            }
          },
        }
      }
      if (body.includes("grant_type=refresh_token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              access_token: "xai-at-refreshed",
              refresh_token: "xai-rt-rotated",
              expires_in: 7200,
            }
          },
        }
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const grokOAuth = compileTsModule("Pix-Scripting/src/api/grokOAuth.ts", {
    globals: {
      setTimeout: (fn) => {
        fn()
        return 1
      },
      clearTimeout() {},
    },
    modules: {
      scripting: { fetch: fakeFetch },
      "../store/customAI": customAI,
    },
  })

  const deviceSession = await grokOAuth.startGrokDeviceAuthorization()
  assert.equal(deviceSession.userCode, "ABCD-EFGH")
  assert.equal(deviceSession.verificationUri, "https://accounts.x.ai/activate")

  const tokenData = await grokOAuth.pollGrokDeviceToken(deviceSession)
  assert.equal(pollAttempt, 2)
  assert.equal(tokenData.accessToken, "xai-at-initial")
  assert.equal(tokenData.refreshToken, "xai-rt-initial")
  assert.equal(tokenData.email, "grok@x.ai")

  customAI.switchCustomAIPreset("grok-oauth")
  customAI.updateCustomAIProfile({
    enabled: true,
    general: {
      preset: "grok-oauth",
      protocol: "openai-responses",
      endpoint: "",
      model: "grok-4",
      apiKey: tokenData.accessToken,
      oauthRefreshToken: tokenData.refreshToken,
      oauthExpiresAt: Date.now() - 1000,
      oauthAccountEmail: tokenData.email,
      supportsVision: true,
    },
  })

  const freshToken = await grokOAuth.ensureFreshGrokAccessToken()
  assert.equal(freshToken, "xai-at-refreshed")
  const persisted = customAI.loadCustomAIProfile()
  assert.equal(persisted.general.apiKey, "xai-at-refreshed")
  assert.equal(persisted.general.oauthRefreshToken, "xai-rt-rotated")
  assert.ok(requests.some((r) => r.url.endsWith("/oauth2/token")))
})
