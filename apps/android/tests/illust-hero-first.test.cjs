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

const { splitHeroFirst, HERO_FIRST_MAX_COLUMNS } = loadPureModule(
  "src/app/components/illustHero.ts",
)

const ITEMS = [{ id: 1 }, { id: 2 }, { id: 3 }]

test("开启首图大卡片时把首条作品提升为大卡，其余进入瀑布流", () => {
  const { hero, rest } = splitHeroFirst(ITEMS, true, 2)
  assert.deepEqual(hero, { id: 1 })
  assert.deepEqual(rest, [{ id: 2 }, { id: 3 }])
  assert.equal(ITEMS.length, 3)
})

test("关闭开关时不会产生大卡，列表保持原顺序", () => {
  const { hero, rest } = splitHeroFirst(ITEMS, false, 2)
  assert.equal(hero, null)
  assert.deepEqual(rest, ITEMS)
})

test("3 列及以上宽屏保持均等网格（与 iOS 行为一致）", () => {
  assert.equal(HERO_FIRST_MAX_COLUMNS, 2)
  for (const columns of [3, 4, 5, 6]) {
    const { hero, rest } = splitHeroFirst(ITEMS, true, columns)
    assert.equal(hero, null)
    assert.deepEqual(rest, ITEMS)
  }
})

test("空列表或非法列数不产生大卡", () => {
  assert.deepEqual(splitHeroFirst([], true, 2), { hero: null, rest: [] })
  assert.equal(splitHeroFirst(ITEMS, true, 0).hero, null)
  assert.equal(splitHeroFirst(ITEMS, true, -1).hero, null)
})

test("只有一条作品时大卡独占，瀑布流为空数组", () => {
  const { hero, rest } = splitHeroFirst([ITEMS[0]], true, 1)
  assert.deepEqual(hero, { id: 1 })
  assert.deepEqual(rest, [])
})
