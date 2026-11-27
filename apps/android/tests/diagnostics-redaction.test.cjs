const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("../node_modules/typescript")

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

const diagnosticsPath = path.resolve(__dirname, "../src/scripting/diagnostics.ts")
const {
  redactDiagnostics,
  redactDiagnosticString,
  gatewayHost,
  buildDiagnosticSettingsSnapshot,
  buildDiagnosticsSnapshot,
  recordDiagnosticError,
  getRecentDiagnosticErrors,
  clearDiagnosticErrors,
  MAX_DIAGNOSTIC_ERRORS,
} = loadTsModule(diagnosticsPath)

test("redactDiagnostics 对敏感键名整字段脱敏，支持嵌套对象/数组/大小写", () => {
  const input = {
    version: "1.8.14.4",
    accessToken: "abc123",
    Authorization: "Bearer abc.def.ghi",
    "Set-Cookie": "PHPSESSID=secret-session",
    nested: {
      clientSecret: "shhh",
      Password: "hunter2",
      api_key: "sk-live-123",
      safe: "keep-me",
    },
    list: [
      { refresh_token: "refresh-value", name: "条目一" },
      "plain-text",
    ],
    clientCredentials: { id: "credential-id" },
  }

  assert.deepEqual(redactDiagnostics(input), {
    version: "1.8.14.4",
    accessToken: "[REDACTED]",
    Authorization: "[REDACTED]",
    "Set-Cookie": "[REDACTED]",
    nested: {
      clientSecret: "[REDACTED]",
      Password: "[REDACTED]",
      api_key: "[REDACTED]",
      safe: "keep-me",
    },
    list: [
      { refresh_token: "[REDACTED]", name: "条目一" },
      "plain-text",
    ],
    clientCredentials: "[REDACTED]",
  })
})

test("redactDiagnostics 掩码 32+ 位十六进制与上下文中的长串", () => {
  const hex = "0123456789abcdef".repeat(4)
  const shortHex = "0123456789abcdef"

  assert.equal(hex.length, 64)
  assert.equal(redactDiagnostics({ traceId: hex }).traceId, "[REDACTED]")
  assert.equal(
    redactDiagnostics({ note: `request ${hex} failed` }).note,
    "request [REDACTED] failed",
  )
  // 少于 32 位的十六进制是正常的短 id，应保留
  assert.equal(redactDiagnostics({ shortId: shortHex }).shortId, shortHex)
})

test("redactDiagnostics 掩码 32+ 位 base64 / base64url 与 Bearer 串", () => {
  const b64 = Buffer.from(
    "this is a very long secret value that must be redacted",
    "utf8",
  ).toString("base64")
  const b64url = "abcDEF012_-".repeat(4)
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureABCDEFGHIJKLMNOPQRSTUVWXYZ012345"

  assert.ok(b64.length >= 32)
  assert.equal(redactDiagnostics({ payload: b64 }).payload, "[REDACTED]")
  assert.equal(redactDiagnostics({ note: `payload ${b64}` }).note, "payload [REDACTED]")
  assert.equal(redactDiagnostics({ blob: b64url }).blob, "[REDACTED]")
  assert.equal(
    redactDiagnostics({ note: "Authorization: Bearer sk-live-abc123DEF456ghi789" }).note,
    "Authorization: Bearer [REDACTED]",
  )
  assert.equal(
    redactDiagnostics({ note: `jwt ${jwt}` }).note,
    "jwt [REDACTED]",
  )
})

test("redactDiagnostics 掩码 URL 查询参数中的 token/secret", () => {
  assert.equal(
    redactDiagnostics({
      url: "https://api.example.com/v1/items?access_token=abc123&page=2",
    }).url,
    "https://api.example.com/v1/items?access_token=[REDACTED]&page=2",
  )
  assert.equal(
    redactDiagnostics({
      url: "https://api.example.com/cb?token=deadbeef&state=ok",
    }).url,
    "https://api.example.com/cb?token=[REDACTED]&state=ok",
  )
})

test("redactDiagnostics 对无敏感字段的诊断数据原样保留", () => {
  const input = {
    app: { version: "1.8.14.4-alpha.5", build: 42, debug: false },
    system: { platform: "android", apiLevel: 34, release: "14" },
    settings: { launchPage: "discovery", showR18: false, cacheLimitMB: null },
    notes: ["启动耗时 120ms", "HTTP 200", "tags: 風景, SF"],
    timestamp: "2026-11-27T10:30:00.000Z",
    shortHex: "deadbeefdeadbeef",
    ratio: 0.85,
  }
  assert.deepEqual(redactDiagnostics(input), input)
})

test("redactDiagnostics 处理循环引用且从不抛错", () => {
  const cyclic = { name: "root", count: 1 }
  cyclic.self = cyclic
  const out = redactDiagnostics(cyclic)
  assert.equal(out.name, "root")
  assert.equal(out.count, 1)
  assert.equal(out.self, "[Circular]")
  assert.equal(redactDiagnostics(undefined), undefined)
  assert.equal(redactDiagnostics(null), null)
})

test("redactDiagnosticString 对短字符串与普通文本保持原样", () => {
  assert.equal(redactDiagnosticString(""), "")
  assert.equal(redactDiagnosticString("HTTP 404"), "HTTP 404")
  assert.equal(redactDiagnosticString("short-token-id"), "short-token-id")
  assert.equal(redactDiagnosticString("0123456789abcdef"), "0123456789abcdef")
})

test("关键设置快照只保留白名单，网关仅导出 host，不泄露代理凭证", () => {
  const snapshot = buildDiagnosticSettingsSnapshot({
    launchPage: "ranking",
    showR18: true,
    apiGatewayMode: "custom",
    customApiBaseUrl: "https://user:pass@proxy.example.com:8443/api?token=topsecret",
    customOauthBaseUrl: "",
    customImageBaseUrl: "https://img.example.com/some/path",
    downloadCustomDirectoryPath: "/home/alice/private",
    unrelatedSecret: "do-not-export",
  })

  assert.equal(snapshot.launchPage, "ranking")
  assert.equal(snapshot.showR18, true)
  assert.equal(snapshot.apiGatewayMode, "custom")
  assert.equal(snapshot.customApiBaseUrl, undefined)
  assert.equal(snapshot.downloadCustomDirectoryPath, undefined)
  assert.equal(snapshot.unrelatedSecret, undefined)
  assert.equal(snapshot.network.customApiHost, "proxy.example.com:8443")
  assert.equal(snapshot.network.customOauthHost, null)
  assert.equal(snapshot.network.customImageHost, "img.example.com")

  const json = JSON.stringify(snapshot)
  assert.equal(json.includes("user:pass"), false)
  assert.equal(json.includes("topsecret"), false)
  assert.equal(json.includes("alice"), false)
})

test("gatewayHost 只返回 host，并容忍缺少 scheme 的地址", () => {
  assert.equal(gatewayHost("https://a:b@proxy.example.com/x?y=z"), "proxy.example.com")
  assert.equal(gatewayHost("proxy.example.com:9000/api"), "proxy.example.com:9000")
  assert.equal(gatewayHost(""), null)
  assert.equal(gatewayHost(null), null)
  assert.equal(gatewayHost("http://[::1]:8080/x"), "[::1]:8080")
})

test("buildDiagnosticsSnapshot 输出前统一脱敏", () => {
  const snapshot = buildDiagnosticsSnapshot({
    generatedAt: "2026-11-27T00:00:00.000Z",
    app: {
      versionName: "1.8.14.4",
      versionCode: 123,
      applicationId: "com.pixscripting.preview",
    },
    system: { platform: "android", apiLevel: 34, release: "14" },
    settings: {
      launchPage: "ranking",
      customApiBaseUrl: "https://user:pass@proxy.example.com/api?token=abc",
      cookie: "PHPSESSID=should-not-leak",
    },
    ai: { configured: true, apiKey: "sk-secret-value", model: "gpt-test" },
    recentErrors: [
      {
        kind: "http",
        code: "HTTP_401",
        message: "Authorization: Bearer abc.def.ghi",
        at: "2026-11-27T00:00:00.000Z",
      },
    ],
  })

  assert.equal(snapshot.generatedAt, "2026-11-27T00:00:00.000Z")
  assert.equal(snapshot.app.versionName, "1.8.14.4")
  assert.equal(snapshot.app.versionCode, 123)
  assert.equal(snapshot.settings.launchPage, "ranking")
  assert.equal(snapshot.settings.customApiBaseUrl, undefined)
  assert.equal(snapshot.settings.cookie, undefined)
  assert.equal(snapshot.settings.network.customApiHost, "proxy.example.com")
  assert.equal(snapshot.ai.configured, true)
  assert.equal(snapshot.ai.model, "gpt-test")
  assert.equal(snapshot.ai.apiKey, "[REDACTED]")
  assert.equal(snapshot.recentErrors[0].message, "Authorization: Bearer [REDACTED]")

  const json = JSON.stringify(snapshot)
  assert.equal(json.includes("user:pass"), false)
  assert.equal(json.includes("PHPSESSID"), false)
  assert.equal(json.includes("sk-secret-value"), false)
})

test("错误环形缓冲最多保留 MAX 条并返回副本", () => {
  clearDiagnosticErrors()
  const total = MAX_DIAGNOSTIC_ERRORS + 5
  for (let i = 0; i < total; i += 1) {
    recordDiagnosticError({
      kind: "http",
      code: `E${i}`,
      message: `message ${i}`,
      at: `2026-11-27T00:00:${String(i).padStart(2, "0")}.000Z`,
    })
  }

  const entries = getRecentDiagnosticErrors()
  assert.equal(entries.length, MAX_DIAGNOSTIC_ERRORS)
  assert.equal(entries[0].code, "E5")
  assert.equal(entries[entries.length - 1].code, `E${total - 1}`)

  entries[0].code = "MUTATED"
  assert.equal(getRecentDiagnosticErrors()[0].code, "E5")

  recordDiagnosticError({ kind: "ai", code: "LONG", message: "x".repeat(1000) })
  const latest = getRecentDiagnosticErrors().at(-1)
  assert.equal(latest.kind, "ai")
  assert.ok(latest.message.length <= 401)

  clearDiagnosticErrors()
  assert.deepEqual(getRecentDiagnosticErrors(), [])
})
