/**
 * 逐文件 TypeScript/TSX 语法诊断（transpile 级）：
 * 报告语法错误（含位置），不做类型检查（仓库无 tsconfig，AGENTS.md 已说明限度）。
 */
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const root = path.join(__dirname, "..")
const entries = process.argv.slice(2)
const files = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full)
    else if (/\.tsx?$/.test(name)) files.push(full)
  }
}
for (const entry of entries.length ? entries : ["Pix-Scripting"]) {
  const full = path.join(root, entry)
  if (fs.statSync(full).isDirectory()) walk(full)
  else files.push(full)
}

let failed = 0
for (const file of files) {
  const source = fs.readFileSync(file, "utf8")
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  const diagnostics = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  )
  const syntactics = diagnostics.filter((d) => (d.code >= 1000 && d.code < 2000) || d.code >= 17000)
  if (syntactics.length > 0) {
    failed += 1
    for (const d of syntactics.slice(0, 5)) {
      const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null
      console.log(`${path.relative(root, file)}:${pos ? pos.line + 1 : "?"}:${pos ? pos.character + 1 : "?"} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    }
  }
}
console.log(`诊断文件 ${files.length} 个，语法错误文件 ${failed} 个`)
process.exit(failed === 0 ? 0 : 1)
