const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

test("SF_SYMBOL_MAP 覆盖 Pix-Scripting 中全部静态 systemName / systemImage 图标", () => {
  const pixRoot = path.resolve(__dirname, "../../../Pix-Scripting")
  const sfSource = fs.readFileSync(path.resolve(__dirname, "../src/scripting/sfSymbols.tsx"), "utf8")

  const definedSymbols = new Set()
  for (const m of sfSource.matchAll(/["']?([a-z0-9.]+)["']?\s*:\s*["']/g)) {
    definedSymbols.add(m[1])
  }

  const usedSymbols = new Set()
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const txt = fs.readFileSync(full, "utf8")
        for (const m of txt.matchAll(/system(?:Name|Image)\s*[:=]\s*"([a-z0-9.]+)"/g)) {
          usedSymbols.add(m[1])
        }
      }
    }
  }
  walk(pixRoot)

  const missing = [...usedSymbols].filter((sym) => !definedSymbols.has(sym))
  assert.deepEqual(missing, [], `Missing SF Symbols in sfSymbols.tsx: ${missing.join(", ")}`)
})

test("Android scripting/index.ts 导出 Pix-Scripting 所需全部符号", () => {
  const pixRoot = path.resolve(__dirname, "../../../Pix-Scripting")
  const indexSrc = fs.readFileSync(path.resolve(__dirname, "../src/scripting/index.ts"), "utf8")

  const needed = new Set()
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const txt = fs.readFileSync(full, "utf8")
        for (const m of txt.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']scripting["']/g)) {
          for (const part of m[1].split(",")) {
            let sym = part.trim()
            if (sym.startsWith("type ")) sym = sym.slice(5).trim()
            sym = sym.split(" as ")[0].trim()
            if (sym) needed.add(sym)
          }
        }
      }
    }
  }
  walk(pixRoot)

  const missingExports = [...needed].filter((sym) => !new RegExp(`\\b${sym}\\b`).test(indexSrc))
  assert.deepEqual(missingExports, [], `Missing scripting exports: ${missingExports.join(", ")}`)
})
