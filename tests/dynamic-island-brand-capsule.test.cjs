const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")

test("竖横屏切换时品牌胶囊保持 Hook 顺序并禁用命中测试", () => {
  const file = "Pix-Scripting/src/ui/components/DynamicIslandBrandCapsule.tsx"
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const device = { isiPad: false, isLandscape: false, model: "iPhone", systemName: "iOS", screen: { width: 393, height: 852 } }
  const hooks = []
  const scripting = { Device: device, Capsule: "Capsule", HStack: "HStack", Image: "Image", Text: "Text",
    useState: initial => { hooks.push("state"); return [initial(), () => {}] },
    useEffect: () => { hooks.push("effect") } }
  const module = { exports: {} }
  vm.runInNewContext(js, { module, exports: module.exports,
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    require: id => ({ scripting, "./glass": { appGlass: () => ({}), appThemeColor: () => "blue" },
      "../../store/settings": { onSettingsChanged: () => () => {} },
      "./brandFont": { getSessionBrandFont: () => "Helvetica" } })[id],
  })
  const render = () => { hooks.length = 0; const tree = module.exports.DynamicIslandBrandCapsule(); return { tree, hooks: [...hooks] } }
  let result = render()
  assert.equal(result.tree.props.allowsHitTesting, false)
  assert.deepEqual(result.hooks, ["state", "effect"])
  device.isLandscape = true
  result = render()
  assert.equal(result.tree, null)
  assert.deepEqual(result.hooks, ["state", "effect"])
  device.isLandscape = false
  result = render()
  assert.ok(result.tree)
  assert.deepEqual(result.hooks, ["state", "effect"])
})
