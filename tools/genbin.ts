/**
 * Node CLI runner for the gridfinity bin generator (regression harness).
 * Uses the SAME geometry core as the app (src/bin.ts).
 *
 *   npx tsx tools/genbin.ts <nx> <ny> <units> <out.stl> [edgeColMm] [edgeRowMm]
 *
 * The optional trailing args make the LAST column / row a custom track of that mm
 * width (for exercising wide edge bins).
 */
import { writeFileSync } from 'node:fs'
import Module from 'manifold-3d'
import { setApi, buildBin, manifoldToStl, GRID } from '../src/bin.ts'

const wasm = await Module()
wasm.setup()
setApi(wasm)

const nx = Number(process.argv[2] || 2)
const ny = Number(process.argv[3] || 4)
const units = Number(process.argv[4] || 7)
const out = process.argv[5] || `tools/out/bin-${nx}-${ny}-${units}.stl`
const edgeColMm = process.argv[6] ? Number(process.argv[6]) : GRID
const edgeRowMm = process.argv[7] ? Number(process.argv[7]) : GRID

const colSizes = Array.from({ length: nx }, (_, i) => (i === nx - 1 ? edgeColMm : GRID))
const rowSizes = Array.from({ length: ny }, (_, j) => (j === ny - 1 ? edgeRowMm : GRID))

const man = buildBin(colSizes, rowSizes, units)
console.error(`genus=${man.genus()} vol=${man.volume().toFixed(1)} area=${man.surfaceArea().toFixed(1)}`)
writeFileSync(out, manifoldToStl(man, `bin_${nx}_${ny}_${units}`))
console.error(`wrote ${out}`)
