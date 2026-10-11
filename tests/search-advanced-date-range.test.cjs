const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function loadSearchAdvancedSheet(settings = { showR18: true, showR18G: false, showAI: true }) {
  const file = path.join(__dirname, "..", "Pix-Scripting/src/ui/searchAdvancedSheet.tsx")
  const source = fs.readFileSync(file, "utf8")
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText

  const state = []
  let cursor = 0
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in state)) {
        state[index] = typeof initial === "function" ? initial() : initial
      }
      return [state[index], (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next
      }]
    },
    useMemo(factory) {
      cursor++
      return factory()
    },
    useEffect() {
      cursor++
    },
  }
  const componentNames = [
    "Button", "DatePicker", "HStack", "Image", "Label", "List",
    "NavigationStack", "Picker", "ScrollView", "Section", "Text",
    "TextField", "Toggle", "VStack",
  ]
  const scripting = Object.fromEntries(componentNames.map((name) => [name, name]))
  Object.assign(scripting, hooks)
  const React = {
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } }
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    React,
    Date,
    setTimeout,
    clearTimeout,
    require(id) {
      const mocks = {
        scripting,
        "../api/pixiv": {
          compileSearchQuery: (value) => value,
          stripBookmarkFilterFromWord: (value) => value,
        },
        "../api/session": { session: { user: null } },
        "../store/settings": { loadSettings: () => settings },
        "./components/pageChrome": { sheetTopBar: () => ({}) },
        "../platform/haptics": { triggerHaptic() {} },
      }
      if (!(id in mocks)) throw new Error(`missing test double: ${id}`)
      return mocks[id]
    },
  }, { filename: file })

  return {
    SearchAdvancedSheet: module.exports.SearchAdvancedSheet,
    normalizeSearchDateRange: module.exports.normalizeSearchDateRange,
    getDefaultAdvancedSearchParams: module.exports.getDefaultAdvancedSearchParams,
    render(props) {
      cursor = 0
      return module.exports.SearchAdvancedSheet(props)
    },
  }
}

function findAll(node, type, result = []) {
  if (!node || typeof node !== "object") return result
  if (node.type === type) result.push(node)
  for (const child of node.props?.children || []) {
    if (Array.isArray(child)) {
      for (const nested of child) findAll(nested, type, result)
    } else {
      findAll(child, type, result)
    }
  }
  return result
}

test("小说标签高级搜索启用时间范围时 DatePicker 参数始终有效", () => {
  const harness = loadSearchAdvancedSheet()
  const currentParams = {
    word: "测试标签",
    category: "novel",
    scope: "novel",
    target: "exact_match_for_tags",
    sort: "date_desc",
    mediaFilter: "all",
    bookmarkThreshold: 0,
    useDateRange: false,
    startDate: "",
    endDate: "",
    startTimestamp: 0,
    endTimestamp: 0,
  }
  const props = {
    currentParams,
    settings: { hideNovels: false },
    onApply() {},
    onCancel() {},
    lockScope: "novel",
  }

  const initial = harness.render(props)
  const toggle = findAll(initial, "Toggle").find((node) => node.props.title === "指定时间范围")
  assert.ok(toggle)
  toggle.props.onChanged(true)

  const enabled = harness.render(props)
  const pickers = findAll(enabled, "DatePicker")
  assert.equal(pickers.length, 2)
  for (const picker of pickers) {
    assert.ok(Number.isFinite(picker.props.value))
    assert.ok(picker.props.startDate <= picker.props.value,
      `${picker.props.title}: value must not precede startDate`)
    assert.ok(picker.props.value <= picker.props.endDate,
      `${picker.props.title}: value must not exceed endDate`)
  }
})

test("标签搜索默认值同时保留有效日期和全局内容筛选", () => {
  const file = path.join(__dirname, "..", "Pix-Scripting/src/ui/TagFeedPage.tsx")
  const source = fs.readFileSync(file, "utf8")
  const helpers = source.slice(source.indexOf("function formatPixivDate("), source.indexOf("export function TagFeedView("))
  const js = ts.transpileModule(`${helpers}\nmodule.exports = { defaultTagIllustAdvancedParams, defaultTagNovelAdvancedParams }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const settings of [
    { showR18: true, showR18G: true, showAI: true },
    { showR18: false, showR18G: true, showAI: false },
  ]) {
    const module = { exports: {} }
    vm.runInNewContext(js, { module, Date, loadSettings: () => settings })
    for (const makeParams of Object.values(module.exports)) {
      const params = makeParams("测试标签")
      assert.equal(params.word, "测试标签")
      assert.equal(params.useDateRange, false)
      assert.ok(Number.isFinite(params.startTimestamp) && params.startTimestamp > 0)
      assert.equal(params.endTimestamp, params.startTimestamp)
      assert.match(params.startDate, /^\d{4}-\d{2}-\d{2}$/)
      assert.equal(params.endDate, params.startDate)
      assert.equal(params.includeR18, settings.showR18)
      assert.equal(params.includeR18G, settings.showR18 && settings.showR18G)
      assert.equal(params.includeAI, settings.showAI)
    }
  }
})

test("搜索面板默认筛选读取全局设置，并接受显式设置", () => {
  const globalSettings = { showR18: false, showR18G: true, showAI: false }
  const { getDefaultAdvancedSearchParams } = loadSearchAdvancedSheet(globalSettings)
  const globalParams = getDefaultAdvancedSearchParams("novel", "测试标签")
  assert.equal(globalParams.includeR18, false)
  assert.equal(globalParams.includeR18G, false)
  assert.equal(globalParams.includeAI, false)
  assert.ok(globalParams.startTimestamp > 0)
  const explicit = getDefaultAdvancedSearchParams("illust", "测试标签", "all", {
    showR18: true, showR18G: true, showAI: true,
  })
  assert.equal(explicit.includeR18, true)
  assert.equal(explicit.includeR18G, true)
  assert.equal(explicit.includeAI, true)
})

test("时间范围归一化兼容缺失、越界和逆序时间戳", () => {
  const { normalizeSearchDateRange } = loadSearchAdvancedSheet()
  const normalize = (...args) => ({ ...normalizeSearchDateRange(...args) })
  const maxTimestamp = new Date("2026-10-03T12:00:00+08:00").getTime()
  assert.deepEqual(
    normalize(0, 0, maxTimestamp),
    { startTimestamp: maxTimestamp, endTimestamp: maxTimestamp }
  )

  const earlier = new Date("2020-01-01T00:00:00+08:00").getTime()
  const later = new Date("2025-01-01T00:00:00+08:00").getTime()
  assert.deepEqual(
    normalize(later, earlier, maxTimestamp),
    { startTimestamp: earlier, endTimestamp: later }
  )

  assert.deepEqual(
    normalize(maxTimestamp + 86400000, maxTimestamp + 86400000, maxTimestamp),
    { startTimestamp: maxTimestamp, endTimestamp: maxTimestamp }
  )
})
