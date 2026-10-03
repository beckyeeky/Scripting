const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

function resolveFeedColumnCount(containerWidth, isLandscape, caps) {
  const fitted = Math.max(2, Math.min(6, Math.round(containerWidth / 215)))
  const cap = isLandscape ? caps.landscape : caps.portrait
  return cap > 0 ? Math.min(fitted, cap) : fitted
}

test("列数实现与测试保持同一公式", () => {
  const source = fs.readFileSync(path.join(__dirname, "../Pix-Scripting/src/ui/feedColumns.ts"), "utf8")
  assert.match(source, /Math\.max\(2, Math\.min\(6, Math\.round\(containerWidth \/ 215\)\)\)/)
  assert.match(source, /const cap = isLandscape \? caps\.landscape : caps\.portrait/)
  assert.match(source, /return cap > 0 \? Math\.min\(fitted, cap\) : fitted/)
})

const auto = { landscape: 0, portrait: 0 }

test("窄容器保持自适应列数，不被横屏上限放大", () => {
  assert.equal(resolveFeedColumnCount(393, true, { landscape: 6, portrait: 2 }), 2)
  assert.equal(resolveFeedColumnCount(320, false, auto), 2)
})

test("宽容器遵守当前朝向的最大列数", () => {
  assert.equal(resolveFeedColumnCount(1366, true, { landscape: 3, portrait: 6 }), 3)
  assert.equal(resolveFeedColumnCount(1366, false, { landscape: 3, portrait: 6 }), 6)
})

test("自动不额外限制 2 到 6 列", () => {
  assert.equal(resolveFeedColumnCount(1024, true, auto), 5)
  assert.equal(resolveFeedColumnCount(1366, false, auto), 6)
})
