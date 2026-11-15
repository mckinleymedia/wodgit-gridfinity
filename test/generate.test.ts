import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { loadManifold, baseplateStl, binsStl, GRID, buildBin, binHeightMm, withManifold } from '../src/index.ts'

before(() => loadManifold())

/** Triangle count from a binary STL's header. */
const triangles = (stl: Uint8Array) => new DataView(stl.buffer, stl.byteOffset).getUint32(80, true)

test('a bin is one watertight solid of the expected height', () => {
  withManifold(() => {
    const bin = buildBin([GRID, GRID], [GRID], 3)
    assert.equal(bin.status(), 'NoError')
    assert.equal(bin.genus(), 0)
    const box = bin.boundingBox()
    assert.ok(Math.abs(box.max[2] - box.min[2] - binHeightMm(3)) < 0.01, `height ${box.max[2] - box.min[2]}`)
  })
})

test('binsStl writes a well-formed binary STL', () => {
  const stl = binsStl([{ colSizes: [GRID], rowSizes: [GRID], units: 3, cxMm: 0, cyMm: 0 }])
  const n = triangles(stl)
  assert.ok(n > 100)
  assert.equal(stl.byteLength, 84 + n * 50)
})

test('a base plate bigger than the bed splits into segments', () => {
  const small = baseplateStl(200, 180, 250, 250)
  assert.equal(small.segmentCount, 1)
  const big = baseplateStl(400, 300, 250, 250)
  assert.ok(big.segmentCount >= 2, `segments ${big.segmentCount}`)
  assert.equal(big.stl.byteLength, 84 + triangles(big.stl) * 50)
})
