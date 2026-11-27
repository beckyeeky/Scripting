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
  buildCookieHostList,
  hasPixivSessionCookie,
  mergeCookieEntries,
  normalizeCookieHeader,
  normalizeCookieHost,
  parseCookiePairs,
  pickCookieHeaderFromResult,
  resolveWebCookieSyncResult,
} = loadPureModule("src/app/features/account/webCookieSync.ts")

test("normalizeCookieHost keeps only http(s) origins", () => {
  assert.equal(normalizeCookieHost("https://WWW.Pixiv.NET/path?x=1#h"), "https://www.pixiv.net")
  assert.equal(normalizeCookieHost("web-proxy.example.com/"), "https://web-proxy.example.com")
  assert.equal(normalizeCookieHost("http://127.0.0.1:8080/cookies"), "http://127.0.0.1:8080")
  assert.equal(normalizeCookieHost("pixiv://account/login"), "")
  assert.equal(normalizeCookieHost("ftp://example.com"), "")
  assert.equal(normalizeCookieHost("   "), "")
})

test("buildCookieHostList puts the configured Web origin first and dedupes Pixiv hosts", () => {
  const hosts = buildCookieHostList("https://web-proxy.example.com/", [
    "https://WWW.pixiv.net",
    "https://accounts.pixiv.net",
  ])
  assert.deepEqual(hosts, [
    "https://web-proxy.example.com",
    "https://www.pixiv.net",
    "https://accounts.pixiv.net",
    "https://app-api.pixiv.net",
  ])
})

test("buildCookieHostList falls back to Pixiv hosts for invalid Web base", () => {
  assert.deepEqual(buildCookieHostList(""), [
    "https://www.pixiv.net",
    "https://app-api.pixiv.net",
    "https://accounts.pixiv.net",
  ])
})

test("mergeCookieEntries prefers the configured origin over Pixiv hosts", () => {
  const entries = [
    { url: "https://accounts.pixiv.net", cookie: "PHPSESSID=accounts; device_token=acc" },
    { url: "https://www.pixiv.net", cookie: "PHPSESSID=www; _cfuvid=cf" },
    { url: "https://web-proxy.example.com", cookie: "PHPSESSID=proxy; proxy_only=1" },
    { url: "https://unknown.example.com", cookie: "PHPSESSID=unknown; extra=ok" },
    { url: "", cookie: "ignored=1" },
    { url: "https://www.pixiv.net", cookie: "   " },
  ]
  const header = mergeCookieEntries(entries, buildCookieHostList("https://web-proxy.example.com"))
  assert.equal(header, "PHPSESSID=proxy; proxy_only=1; _cfuvid=cf; device_token=acc; extra=ok")
})

test("mergeCookieEntries falls back to the first collected host when none is preferred", () => {
  const header = mergeCookieEntries(
    [
      { url: "https://a.example.com", cookie: "PHPSESSID=a; only_a=1" },
      { url: "https://b.example.com", cookie: "PHPSESSID=b; only_b=1" },
    ],
    [],
  )
  assert.equal(header, "PHPSESSID=a; only_a=1; only_b=1")
})

test("parseCookiePairs skips malformed segments and keeps '=' in values", () => {
  assert.deepEqual(parseCookiePairs(" a=b ; broken ; c=d=e;; =x "), [
    { name: "a", value: "b" },
    { name: "c", value: "d=e" },
  ])
})

test("normalizeCookieHeader keeps the last value and trims whitespace", () => {
  assert.equal(normalizeCookieHeader(" PHPSESSID=a ; foo=b; PHPSESSID=c "), "PHPSESSID=c; foo=b")
})

test("pickCookieHeaderFromResult prefers structured per-host cookies", () => {
  const header = pickCookieHeaderFromResult(
    {
      cookieHeader: "PHPSESSID=legacy",
      cookies: [{ url: "https://web-proxy.example.com", cookie: "PHPSESSID=proxy" }],
    },
    "https://web-proxy.example.com",
  )
  assert.equal(header, "PHPSESSID=proxy")
})

test("pickCookieHeaderFromResult falls back to the legacy header", () => {
  const header = pickCookieHeaderFromResult(
    { cookieHeader: " PHPSESSID=legacy ; foo=b " },
    "https://www.pixiv.net",
  )
  assert.equal(header, "PHPSESSID=legacy; foo=b")
})

test("closing the dialog still returns reverse-proxy cookies (P0-4 regression)", () => {
  const outcome = resolveWebCookieSyncResult(
    {
      cancelled: true,
      cookieHeader: "",
      cookies: [
        { url: "https://www.pixiv.net", cookie: "PHPSESSID=www" },
        { url: "https://web-proxy.example.com", cookie: "PHPSESSID=proxy; proxy_only=1" },
      ],
    },
    "https://web-proxy.example.com",
  )
  assert.equal(outcome.status, "synced")
  assert.equal(outcome.via, "dismiss")
  assert.equal(outcome.cookieHeader, "PHPSESSID=proxy; proxy_only=1")
  assert.equal(outcome.hasSessionCookie, true)
})

test("closing without any captured cookie stays a cancellation", () => {
  assert.deepEqual(resolveWebCookieSyncResult({ cancelled: true }, "https://www.pixiv.net"), {
    status: "cancelled",
  })
})

test("finishing without cookies is reported as empty", () => {
  assert.deepEqual(
    resolveWebCookieSyncResult({ cancelled: false, cookieHeader: "   ", cookies: [] }, "https://www.pixiv.net"),
    { status: "empty" },
  )
})

test("finishing with non-session cookies is synced but flags the missing PHPSESSID", () => {
  const outcome = resolveWebCookieSyncResult(
    { cancelled: false, cookieHeader: "foo=bar" },
    "https://www.pixiv.net",
  )
  assert.equal(outcome.status, "synced")
  assert.equal(outcome.via, "finish")
  assert.equal(outcome.hasSessionCookie, false)
})

test("hasPixivSessionCookie ignores empty values", () => {
  assert.equal(hasPixivSessionCookie("PHPSESSID=abc; foo=1"), true)
  assert.equal(hasPixivSessionCookie("PHPSESSID=; foo=1"), false)
  assert.equal(hasPixivSessionCookie(""), false)
})
