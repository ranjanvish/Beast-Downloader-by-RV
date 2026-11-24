'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { sourceHash } = require('./fast-update.cjs')

test('agent source changes trigger local update detection', () => {
  const file = path.resolve(__dirname, '../../cli/BEAST-MCP.md')
  const original = fs.readFileSync(file)
  const before = sourceHash()
  try {
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n<!-- detection test -->\n')]))
    assert.notEqual(sourceHash(), before)
  } finally {
    fs.writeFileSync(file, original)
  }
  assert.equal(sourceHash(), before)
})
