const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

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
  const dir = path.dirname(absPath)

  function customRequire(specifier) {
    if (specifier.startsWith(".")) {
      const base = path.resolve(dir, specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return loadTsModule(candidate)
        }
      }
    }
    return require(specifier)
  }

  const fn = new Function("exports", "require", "module", "__filename", "__dirname", compiled)
  fn(mod.exports, customRequire, mod, absPath, dir)
  return mod.exports
}

const filterPath = path.resolve(
  __dirname,
  "../src/app/features/feeds/novelLengthFilter.ts",
)
const {
  NOVEL_LONG_FORM_MIN_TEXT_LENGTH,
  normalizeMinTextLength,
  isLongNovelFilterEnabled,
  minTextLengthForLongNovelFilter,
  formatCountWithSeparators,
  formatMinTextLengthLabel,
  matchesMinTextLength,
  filterNovelsByMinTextLength,
} = loadTsModule(filterPath)

test("长篇门槛与共享常量一致，为 8,000 字", () => {
  assert.equal(NOVEL_LONG_FORM_MIN_TEXT_LENGTH, 8000)
})

test("normalizeMinTextLength 只接受有效正数，其余视为不筛选", () => {
  assert.equal(normalizeMinTextLength(8000), 8000)
  assert.equal(normalizeMinTextLength("8000"), 8000)
  assert.equal(normalizeMinTextLength(8000.9), 8000)
  assert.equal(normalizeMinTextLength(0), 0)
  assert.equal(normalizeMinTextLength(-8000), 0)
  assert.equal(normalizeMinTextLength(Number.NaN), 0)
  assert.equal(normalizeMinTextLength(Number.POSITIVE_INFINITY), 0)
  assert.equal(normalizeMinTextLength(undefined), 0)
  assert.equal(normalizeMinTextLength(null), 0)
  assert.equal(normalizeMinTextLength(""), 0)
  assert.equal(normalizeMinTextLength("abc"), 0)
})

test("长篇开关状态与 minTextLength 双向换算", () => {
  assert.equal(isLongNovelFilterEnabled(8000), true)
  assert.equal(isLongNovelFilterEnabled(12000), true)
  assert.equal(isLongNovelFilterEnabled(7999), false)
  assert.equal(isLongNovelFilterEnabled(0), false)
  assert.equal(isLongNovelFilterEnabled(undefined), false)

  assert.equal(minTextLengthForLongNovelFilter(true), 8000)
  assert.equal(minTextLengthForLongNovelFilter(false), 0)
})

test("胶囊文案使用千分位且关闭时返回 null", () => {
  assert.equal(formatCountWithSeparators(0), "0")
  assert.equal(formatCountWithSeparators(999), "999")
  assert.equal(formatCountWithSeparators(8000), "8,000")
  assert.equal(formatCountWithSeparators(1234567), "1,234,567")

  assert.equal(formatMinTextLengthLabel(8000), "≥8,000 字")
  assert.equal(formatMinTextLengthLabel(12000), "≥12,000 字")
  assert.equal(formatMinTextLengthLabel(0), null)
  assert.equal(formatMinTextLengthLabel(undefined), null)
})

test("matchesMinTextLength 以 Pixiv text_length 为唯一依据，未知字数按 0 处理", () => {
  assert.equal(matchesMinTextLength(7999, 8000), false)
  assert.equal(matchesMinTextLength(8000, 8000), true)
  assert.equal(matchesMinTextLength(20000, 8000), true)
  assert.equal(matchesMinTextLength(undefined, 8000), false)
  assert.equal(matchesMinTextLength(null, 8000), false)

  // 关闭过滤时任何作品都保留，包括缺少字数的条目
  assert.equal(matchesMinTextLength(undefined, 0), true)
  assert.equal(matchesMinTextLength(12, undefined), true)
})

test("filterNovelsByMinTextLength 保持顺序、不移除输入，且只在开启时过滤", () => {
  const novels = [
    { id: 1, text_length: 20000 },
    { id: 2, text_length: 8000 },
    { id: 3, text_length: 7999 },
    { id: 4, text_length: undefined },
  ]

  assert.deepEqual(
    filterNovelsByMinTextLength(novels, 8000).map((n) => n.id),
    [1, 2],
  )
  assert.deepEqual(
    filterNovelsByMinTextLength(novels, 0).map((n) => n.id),
    [1, 2, 3, 4],
  )
  assert.equal(novels.length, 4)
  assert.equal(novels[3].id, 4)
})
