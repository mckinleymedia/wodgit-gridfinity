/**
 * Node CLI runner for the baseplate generator (regression harness).
 * Uses the SAME geometry core as the app (src/baseplate.ts); only the
 * manifold-3d instantiation differs (Node vs browser WASM loading).
 *
 *   npx tsx tools/gen.ts <plateWxH> <bedWxH> <out.stl>
 *   npx tsx tools/gen.ts plan <plateWxH> <bedWxH>
 */
import { writeFileSync } from 'node:fs'
import Module from 'manifold-3d'
import { setApi, buildPlate, planPlate, manifoldToStl } from '../src/baseplate.ts'

const wasm = await Module()
wasm.setup()
setApi(wasm)

if (process.argv[2] === 'plan') {
  const [px, py] = (process.argv[3] || '320x320').split('x').map(Number)
  const [bx, by] = (process.argv[4] || '250x220').split('x').map(Number)
  const p = planPlate([px, py], [bx, by])
  console.log('globalTrace.x', p.globalTrace[0])
  console.log('globalTrace.y', p.globalTrace[1])
  console.log('platePadding [N,E,S,W]', p.platePadding.map((x: number) => +x.toFixed(3)))
  console.log('planX', p.planX, 'plansY', p.plansY)
  console.log(`segments: ${p.segments.length}`)
  for (const s of p.segments) {
    console.log(` seg(${s.sx},${s.sy}) idx=${s.globalSegmentIndex} pos=[${s.pos.map((x: number) => x.toFixed(2))}] size=[${s.size.map((x: number) => x.toFixed(2))}] conn[NESW]=${s.connector.map((c: boolean) => c ? 1 : 0).join('')}`)
  }
  process.exit(0)
}

const [px, py] = (process.argv[2] || '220x190').split('x').map(Number)
const [bx, by] = (process.argv[3] || '250x220').split('x').map(Number)
const out = process.argv[4] || `tools/out/port-${px}x${py}.stl`
const man = buildPlate([px, py], [bx, by])
console.error(`genus=${man.genus()} vol=${man.volume().toFixed(1)} area=${man.surfaceArea().toFixed(1)}`)
writeFileSync(out, manifoldToStl(man))
console.error(`wrote ${out}`)
