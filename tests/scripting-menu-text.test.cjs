const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { menuTextErrors } = require('./lib/scripting-menu-scan.cjs')
const root = path.join(__dirname, '..')
const file = 'Pix-Scripting/src/ui/NovelDetail.tsx'
test('all actual TSX Menu children have no non-empty JSX text', () => {
  const errors = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) errors.push(...menuTextErrors(fs.readFileSync(full, 'utf8'), path.relative(root, full)))
    }
  }
  walk(path.join(root, 'Pix-Scripting'))
  assert.deepEqual(errors, [])
})
test('old feature commit fails Menu text regression; fixed source passes', () => {
  const old = execFileSync('git', ['show', '131107a:' + file], { cwd: root, encoding: 'utf8' })
  assert.equal(menuTextErrors(old, file).length, 1)
  assert.match(menuTextErrors(old, file)[0], /Menu text ","/)
  assert.deepEqual(menuTextErrors(fs.readFileSync(path.join(root, file), 'utf8'), file), [])
})
test('whitespace allowed; JSX punctuation/text rejected; array separator allowed', () => {
  for (const text of [',', ';', '.', 'wrong text']) assert.equal(menuTextErrors(`<Menu><Menu />${text}<Button /></Menu>`, 'fixture.tsx').length, 1)
  assert.deepEqual(menuTextErrors('<Menu>\n <Menu />\n <Button />\n</Menu>', 'fixture.tsx'), [])
  assert.deepEqual(menuTextErrors('const toolbar = [<Menu><Button /></Menu>, <Button />]', 'fixture.tsx'), [])
})
test('actual toolbar array Menu separator is preserved', () => {
  assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /<\/Menu>\s*<\/Menu>,\s*\.\.\.\(isFullScreenPad/)
})
