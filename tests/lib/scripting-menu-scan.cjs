const ts = require('typescript')
function menuTextErrors(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors = []
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Menu') {
      for (const child of node.children) {
        if (ts.isJsxText(child) && child.text.trim()) {
          const pos = tree.getLineAndCharacterOfPosition(child.getStart(tree))
          errors.push(`${filename}:${pos.line + 1}:${pos.character + 1}: Menu text ${JSON.stringify(child.text.trim())}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return errors
}
module.exports = { menuTextErrors }
