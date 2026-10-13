"use strict"
/**
 * 轻量语义扫描：基于 TypeScript AST 的作用域/绑定可达性检查（不做类型检查）。
 *
 * 目的：捕获「transpile 级语法检查通过、但运行期必然失败」的一类缺陷：
 *   1. USE_BEFORE_DECL —— 同一条执行流内，引用出现在块级（let/const/class）声明之前。
 *      转译输出保留 const/let，故首次执行到该引用时抛 ReferenceError（TDZ），
 *      整棵组件树渲染失败（表现为白屏），而不是局部降级。
 *   2. MISSING_IMPORT —— 引用了宿主 `scripting` 模块导出的符号，但本文件既未从
 *      "scripting" 导入、也没有任何本地声明。宿主渲染时该标识符为 undefined。
 *   3. UNKNOWN_UNBOUND —— 既不来自本文件声明/导入，也不属于官方声明的宿主全局与 JS 内建。
 *
 * 与 `scripts/syntax-check.cjs`（TypeScript transpile 级语法诊断）互补：那个只查语法，
 * 这个查绑定与作用域顺序。两者都不是完整类型检查（不做类型推导、不校验类型兼容）。
 *
 * 官方依据：https://scriptingapp.github.io/llms.txt 里的 API 页面声明形式
 * （视图与 hooks 为 `scripting` 模块导出，必须 import；工具类为 `declare const` 全局）。
 */

const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")

const SCRIPTING_MODULE = "scripting"

/**
 * 官方文档声明为「无需 import 的宿主全局」。
 * 仅收录官方文档以 declare 全局形式提供的符号；`scripting` 模块导出的视图/hooks 不在此列。
 */
const HOST_GLOBAL_NAMES = new Set([
  "Animation", "Archive", "Assistant", "BackgroundKeeper", "Browser", "BackgroundURLSession",
  "Crypto", "Data", "Device", "Dialog", "DocumentPicker", "FileManager", "FontPicker",
  "ImageRenderer", "Keychain", "LiveActivityUI", "NamespaceID", "Navigation", "PHAsset",
  "PHAssetCollection", "Pasteboard", "Photos", "Python", "QuickLook", "Safari", "ShareSheet",
  "Shell", "Script", "Storage", "Transition", "UIImage", "UIGlass", "WebViewController",
  "Widget", "withAnimation", "require",
])

/** 语言/运行时内建全局（脚本宿主基于 JavaScriptCore）。 */
const JS_GLOBAL_NAMES = new Set([
  "AbortController", "AbortSignal", "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView",
  "Date", "Error", "EvalError", "Float32Array", "Float64Array", "Function", "Infinity",
  "Int16Array", "Int32Array", "Int8Array", "Intl", "JSON", "Map", "Math", "NaN", "Number",
  "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect", "RegExp", "Set",
  "String", "Symbol", "SyntaxError", "TextDecoder", "TextEncoder", "TypeError", "URIError",
  "URL", "URLSearchParams", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray",
  "WeakMap", "WeakSet", "arguments", "atob", "btoa", "clearInterval", "clearTimeout",
  "console", "decodeURI", "decodeURIComponent", "document", "encodeURI", "encodeURIComponent",
  "escape", "eval", "fetch", "globalThis", "isFinite", "isNaN", "parseFloat", "parseInt",
  "performance", "queueMicrotask", "setInterval", "setTimeout", "structuredClone",
  "undefined", "unescape", "window",
])

function isScriptingModuleClause(node) {
  return !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === SCRIPTING_MODULE
}

function importNames(clause, target) {
  if (clause.name) target.add(clause.name.text)
  const bindings = clause.namedBindings
  if (!bindings) return
  if (ts.isNamespaceImport(bindings)) target.add(bindings.name.text)
  else for (const element of bindings.elements) target.add(element.name.text)
}

/** 文件里从 "scripting" 导入的全部绑定名。 */
function collectScriptingImports(sourceFile) {
  const names = new Set()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !isScriptingModuleClause(statement)) continue
    if (statement.importClause) importNames(statement.importClause, names)
  }
  return names
}

/** 文件里全部 import 绑定（任意模块）。 */
function collectAllImports(sourceFile) {
  const names = new Set()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (statement.importClause) importNames(statement.importClause, names)
  }
  return names
}

function bindingNames(nameNode) {
  const out = []
  if (ts.isIdentifier(nameNode)) out.push(nameNode)
  else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isBindingElement(element)) out.push(...bindingNames(element.name))
    }
  }
  return out
}

function declarationEntries(statements, direct) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          if (!direct.has(name.text)) direct.set(name.text, name.getStart())
        }
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name) {
      // 函数/类声明在同一块内提升，位置按 -1 处理（不参与顺序判定）
      if (!direct.has(statement.name.text)) direct.set(statement.name.text, -1)
    }
  }
  return direct
}

function scopeFromStatements(statements, kind) {
  return { kind, direct: declarationEntries(statements, new Map()) }
}

function isTypeContext(node) {
  return ts.isTypeReferenceNode(node) || ts.isTypeQueryNode(node) || ts.isTypeOperatorNode(node) ||
    ts.isImportTypeNode(node) || ts.isTypeLiteralNode(node) || ts.isTypePredicateNode(node) ||
    ts.isIndexedAccessTypeNode(node) || ts.isMappedTypeNode(node) || ts.isExpressionWithTypeArguments(node) ||
    ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node) || ts.isArrayTypeNode(node) ||
    ts.isTupleTypeNode(node) || ts.isConditionalTypeNode(node) || ts.isParenthesizedTypeNode(node) ||
    ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node) || ts.isLiteralTypeNode(node) ||
    ts.isTypeParameterDeclaration(node) || ts.isDecorator(node) || ts.isThisTypeNode(node) ||
    ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node) || ts.isNamedTupleMember(node)
}

/** 判断 Identifier 是否处在「值引用」位置（排除声明名、属性名、类型位置等）。 */
function referencedName(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) || (ts.isPropertyAccessChain && ts.isPropertyAccessChain(parent))) {
    return parent.expression === node
  }
  if (ts.isElementAccessExpression(parent)) return parent.expression === node
  if (ts.isQualifiedName(parent)) return false
  if (ts.isPropertyAssignment(parent)) return false
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isBindingElement(parent)) return false
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) ||
    ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
    ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) ||
    ts.isEnumMember(parent) || ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isTypeParameterDeclaration(parent) ||
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) || ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent) || ts.isMetaProperty(parent)) return false
  if (ts.isJsxAttribute(parent)) return parent.initializer === node
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) {
    return parent.tagName === node
  }
  if (isTypeContext(parent)) return false
  if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) return parent.expression === node
  return true
}

function isJsxIntrinsic(node) {
  const parent = node.parent
  if (!parent) return false
  const isTag = (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) ||
    ts.isJsxClosingElement(parent)) && parent.tagName === node
  if (!isTag) return false
  const text = node.text
  return !!text && text[0] === text[0].toLowerCase()
}

function scanSource(source, fileName, options = {}) {
  const hostNames = options.hostNames ?? new Set()
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX)
  const findings = []
  const scriptingImports = collectScriptingImports(sourceFile)
  const importedNames = collectAllImports(sourceFile)

  // 模块级绑定：import 视为提升（位置 -1）；顶层 const/let 保留真实位置用于顺序判定。
  const moduleBindings = new Map()
  for (const name of importedNames) moduleBindings.set(name, { position: -1, hoisted: true })
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue
    if (ts.isVariableStatement(statement)) {
      const flags = statement.declarationList.flags
      const blockScoped = (flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          if (!moduleBindings.has(name.text)) {
            moduleBindings.set(name.text, {
              position: blockScoped ? name.getStart() : -1,
              hoisted: !blockScoped,
            })
          }
        }
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name) {
      if (!moduleBindings.has(statement.name.text)) {
        moduleBindings.set(statement.name.text, { position: -1, hoisted: true })
      }
    }
  }

  const record = (name, node, kind, message) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    findings.push({ kind, name, line: line + 1, column: character + 1, message })
  }

  // 顺序判定只覆盖「同一条执行流」：模块顶层直写代码，或同一函数体内（含其嵌套块）的直写代码。
  // 一旦跨越函数边界（嵌套函数体在更晚的时机才执行），只做存在性判定，避免误报。
  const resolveReference = (name, node, scopes) => {
    let sameFlow = true
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const scope = scopes[index]
      const declared = scope.direct.get(name)
      if (declared !== undefined) {
        if (sameFlow && declared >= 0 && declared > node.getStart(sourceFile)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(declared)
          record(name, node, "USE_BEFORE_DECL", `引用早于同作用域内的块级声明（第 ${line + 1} 行）`)
        }
        return
      }
      if (scope.kind === "function") sameFlow = false
    }
    const binding = moduleBindings.get(name)
    if (binding) {
      if (sameFlow && !binding.hoisted && binding.position > node.getStart(sourceFile)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(binding.position)
        record(name, node, "USE_BEFORE_DECL", `引用早于模块级块级声明（第 ${line + 1} 行）`)
      }
      return
    }
    if (JS_GLOBAL_NAMES.has(name) || HOST_GLOBAL_NAMES.has(name)) return
    if (hostNames.has(name) && !scriptingImports.has(name)) {
      record(name, node, "MISSING_IMPORT", `宿主导出的符号未从 "${SCRIPTING_MODULE}" 导入`)
      return
    }
    record(name, node, "UNKNOWN_UNBOUND", "标识符未声明、未导入，也不是宿主全局或 JS 内建")
  }

  const visit = (node, scopes) => {
    if (node.kind === ts.SyntaxKind.Identifier) {
      if (!referencedName(node) || isJsxIntrinsic(node)) return
      resolveReference(node.text, node, scopes)
      return
    }
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) ||
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
    if (ts.isBlock(node)) {
      visitChildren(node, scopes.concat([scopeFromStatements(node.statements, "block")]))
      return
    }
    if (ts.isCaseBlock(node)) {
      const statements = []
      for (const clause of node.clauses) statements.push(...clause.statements)
      visitChildren(node, scopes.concat([scopeFromStatements(statements, "block")]))
      return
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const direct = new Map()
      if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          for (const name of bindingNames(declaration.name)) {
            if (!direct.has(name.text)) direct.set(name.text, name.getStart())
          }
        }
      }
      const next = scopes.concat([{ kind: "loop", direct }])
      if (node.initializer) visit(node.initializer, next)
      if (node.condition) visit(node.condition, next)
      if (node.incrementor) visit(node.incrementor, next)
      visit(node.statement, next)
      return
    }
    if (ts.isCatchClause(node)) {
      const direct = new Map()
      if (node.variableDeclaration) {
        for (const name of bindingNames(node.variableDeclaration.name)) direct.set(name.text, name.getStart())
      }
      visitChildren(node, scopes.concat([{ kind: "block", direct }]))
      return
    }
    if (ts.isFunctionLike(node)) {
      const direct = functionParameterScope(node)
      const next = scopes.concat([{ kind: "function", direct }])
      for (const parameter of node.parameters) visit(parameter, next)
      for (const typeParameter of node.typeParameters ?? []) visit(typeParameter, next)
      if (node.body) visit(node.body, next)
      return
    }
    if (isTypeContext(node)) return
    visitChildren(node, scopes)
  }

  const visitChildren = (node, scopes) => {
    ts.forEachChild(node, (child) => visit(child, scopes))
  }

  for (const statement of sourceFile.statements) visit(statement, [])
  return findings
}

/** 函数作用域中的绑定：形参、类型形参、函数名自身（提升）。 */
function functionParameterScope(node) {
  const direct = new Map()
  for (const parameter of node.parameters) {
    for (const name of bindingNames(parameter.name)) direct.set(name.text, -1)
  }
  for (const typeParameter of node.typeParameters ?? []) direct.set(typeParameter.name.text, -1)
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name) direct.set(node.name.text, -1)
  }
  return direct
}

/** 项目内所有曾从 "scripting" 导入过的符号名（用于判断「别处会导入、这里漏了」）。 */
function collectProjectHostSymbols(rootDir) {
  const names = new Set()
  for (const file of listSourceFiles(rootDir)) {
    const source = fs.readFileSync(file, "utf8")
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX)
    for (const name of collectScriptingImports(sourceFile)) names.add(name)
  }
  return names
}

function listSourceFiles(rootDir) {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(rootDir)
  return files.sort()
}

/** 扫描整个源码目录，返回有诊断的文件列表。 */
function scanProject(rootDir, options = {}) {
  const hostNames = options.hostNames ?? collectProjectHostSymbols(rootDir)
  const results = []
  for (const file of listSourceFiles(rootDir)) {
    const source = fs.readFileSync(file, "utf8")
    let findings
    try {
      findings = scanSource(source, file, { hostNames })
    } catch (error) {
      findings = [{
        kind: "SCAN_ERROR", name: "-", line: 0, column: 0,
        message: `扫描器异常：${error && error.message}`,
      }]
    }
    if (findings.length) results.push({ file, findings })
  }
  return results
}

module.exports = {
  HOST_GLOBAL_NAMES,
  JS_GLOBAL_NAMES,
  collectProjectHostSymbols,
  collectScriptingImports,
  listSourceFiles,
  scanProject,
  scanSource,
}
