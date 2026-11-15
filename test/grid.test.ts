import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGrid, fitGrid, maxPieceCells, binCuts } from '../src/index.ts'

test('a clean multiple of 42 has no edge track', () => {
  const g = buildGrid(42 * 5, 42 * 3, 50, 'mm')
  assert.deepEqual(g.colWidthsMm, [42, 42, 42, 42, 42])
  assert.deepEqual(g.rowDepthsMm, [42, 42, 42])
  assert.equal(g.edgeColIndex, -1)
  assert.equal(g.edgeRowIndex, -1)
})

test('a leftover of at least 9 mm becomes its own narrow edge track', () => {
  // 300 = 7 × 42 + 6 → widens; 310 = 7 × 42 + 16 → its own column.
  const g = buildGrid(310, 220, 50, 'mm')
  assert.deepEqual(g.colWidthsMm, [42, 42, 42, 42, 42, 42, 42, 16])
  assert.equal(g.edgeColIndex, 7)
  // Rows keep the leftover at the back (track 0): 220 = 5 × 42 + 10.
  assert.deepEqual(g.rowDepthsMm, [10, 42, 42, 42, 42, 42])
  assert.equal(g.edgeRowIndex, 0)
})

test('a leftover under 9 mm widens the edge cell instead', () => {
  const g = buildGrid(300, 130, 50, 'mm')
  assert.deepEqual(g.colWidthsMm, [42, 42, 42, 42, 42, 42, 48])
  assert.deepEqual(g.rowDepthsMm, [46, 42, 42])
})

test('tracks always add up to the interior', () => {
  for (const w of [43, 100, 251, 377.4, 560]) {
    const g = buildGrid(w, w, 50, 'mm')
    const sum = g.colWidthsMm.reduce((a, b) => a + b, 0)
    assert.equal(sum, Math.round(w), `width ${w}`)
  }
})

test('height units round down to whole 7 mm units', () => {
  assert.equal(fitGrid(100, 100, 50).heightUnits, 7)
  assert.equal(buildGrid(100, 100, 48.9, 'mm').heightUnits, 6)
})

test('inches convert before gridding', () => {
  const g = buildGrid(10, 10, 2, 'in')
  assert.equal(g.widthMm, 254)
  assert.equal(g.fullCols, 6)
})

test('the biggest piece on a 250 mm bed is 6 × 5 cells', () => {
  const [a, b] = maxPieceCells({ w: 250, d: 250 })
  assert.deepEqual([a, b].sort(), [5, 6])
})

test('a bin that fits the bed has no cuts; one too big splits evenly', () => {
  const bed = { w: 250, d: 250 }
  assert.deepEqual(binCuts({ w: 3, d: 3 }, bed), { x: [], y: [] })
  const big = binCuts({ w: 10, d: 3 }, bed)
  assert.deepEqual(big.x, [5])
  assert.deepEqual(big.y, [])
})
