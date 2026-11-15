// @ts-nocheck — faithful port of GridFlock's OpenSCAD CSG geometry; manifold-3d's
// encapsulated objects are untyped, and the public API is typed in generate.ts.
/**
 * Clean-room port of GridFlock's gridfinity baseplate geometry, built on
 * manifold-3d CSG. Mirrors gridflock.scad + gridfinity-rebuilt-openscad's
 * baseplate cutter. Units: mm; plate is centered on the origin, sitting on Z=0.
 *
 * The manifold API (Manifold / CrossSection / Mesh) is injected via setApi() so
 * this same geometry runs both in the browser and in Node (the regression harness,
 * tools/gen.ts) — one source of truth.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaults } from './defaults'
import { binaryStl } from './stl'

// Manifold's runtime API, injected at init. Typed loosely — manifold-3d's
// encapsulated classes have no TS types we depend on here.
let Manifold: any
let CrossSection: any
let Mesh: any

export function setApi(api: any): void {
  Manifold = api.Manifold
  CrossSection = api.CrossSection
  Mesh = api.Mesh
}

// ---- constants (from gridfinity-baseplate.scad / gridflock.scad) ----
export const GRID = defaults.grid // BASEPLATE_DIMENSIONS
const OUTER_D = 8 // BASEPLATE_OUTER_DIAMETER
const OUTER_R = OUTER_D / 2 // 4
const PROFILE_MAX_X = 2.85 // _BASEPLATE_PROFILE[3].x = 0.7 + 2.15
const INNER_R = OUTER_R - PROFILE_MAX_X // 1.15
const INNER_D = INNER_R * 2 // 2.3
const PROFILE_H = 4.65 // _profile_height_raw
const BASEPLATE_HEIGHT = 5
const PLATE_CORNER_R = 4 // plate_corner_radius
const FN = 40 // $fn=40
const EPS = 1e-3

// _BASEPLATE_PROFILE points [x, z] (radial, height)
const BASE_PROFILE = [
  [0, 0],
  [0.7, 0.7],
  [0.7, 0.7 + 1.8], // 2.5
  [0.7 + 2.15, 0.7 + 1.8 + 2.15], // [2.85, 4.65]
]

const N = 0, E = 1, S = 2, W = 3

// ---- 2D helpers ----
/** Rounded rectangle CrossSection centered at origin. */
function roundedRectCS(w, h, r) {
  if (r <= 1e-9) return CrossSection.square([w, h], true)
  const iw = w - 2 * r, ih = h - 2 * r
  const base = CrossSection.square([Math.max(iw, 1e-6), Math.max(ih, 1e-6)], true)
  return base.offset(r, 'Round', 2, FN)
}

/** A thin slab (height EPS) of a rounded rect at a given z (its bottom). */
function slab(w, h, r, z) {
  return roundedRectCS(w, h, r).extrude(EPS).translate([0, 0, z])
}

const SEG_PER_CORNER = FN / 4 // 10, matching $fn=40

/** CCW boundary loop of a rounded rectangle centered at origin: array of [x,y]. */
function roundedRectLoop(w, h, r) {
  const hw = w / 2 - r, hh = h / 2 - r
  const corners = [
    [hw, -hh, -90], // SE
    [hw, hh, 0], // NE
    [-hw, hh, 90], // NW
    [-hw, -hh, 180], // SW
  ]
  const pts = []
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= SEG_PER_CORNER; s++) {
      const a = (a0 + (90 * s) / SEG_PER_CORNER) * Math.PI / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/**
 * Build a closed manifold by lofting a stack of rounded-rect cross-sections
 * (levels: [{w,h,r,z}], increasing z), with flat top/bottom caps. All levels
 * must have the same boundary point count. Produces slice-clean geometry with
 * no CSG-union seams (hence no degenerate slivers).
 */
function solidLoft(levels) {
  const loops = levels.map((L) => roundedRectLoop(L.w, L.h, L.r))
  const P = loops[0].length
  const verts = []
  for (let i = 0; i < levels.length; i++) {
    for (let k = 0; k < P; k++) verts.push(loops[i][k][0], loops[i][k][1], levels[i].z)
  }
  // center points for caps
  const botC = verts.length / 3
  verts.push(0, 0, levels[0].z)
  const topC = verts.length / 3
  verts.push(0, 0, levels[levels.length - 1].z)

  const tris = []
  const idx = (lvl, k) => lvl * P + k
  // side walls (outward-facing): boundary is CCW seen from +z
  for (let i = 0; i < levels.length - 1; i++) {
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P
      const a = idx(i, k), b = idx(i, k2), c = idx(i + 1, k2), d = idx(i + 1, k)
      tris.push(a, b, c, a, c, d)
    }
  }
  // bottom cap (facing -z): wind so normal points down
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P
    tris.push(botC, idx(0, k2), idx(0, k))
  }
  // top cap (facing +z)
  const T = levels.length - 1
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P
    tris.push(topC, idx(T, k), idx(T, k2))
  }
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  return Manifold.ofMesh(mesh)
}

// ---- socket cutter (baseplate_cutter + gridflock cutter() z-placement) ----
/**
 * The negative of a single cell's gridfinity socket, positioned so subtracting
 * it from a slab spanning z=[0, PROFILE_H] yields the correct open-center
 * chamfered socket. size = [sx, sy] cell dimensions in mm.
 *
 * Reproduces sweep_rounded(inner_dimensions){_baseplate_cutter_polygon(5)} plus
 * the central through-cube, built for BASEPLATE_HEIGHT=5, then shifted down 0.35
 * (matching gridflock cutter(): translate by profile_h - cutter_h - (5 - cutter_h)).
 */
function socketCutter(sx, sy) {
  const idx = sx - OUTER_D, idy = sy - OUTER_D // inner_dimensions (path rect)
  const clearance = BASEPLATE_HEIGHT - PROFILE_H // 0.35

  // Filled rounded-rect cross-sections along the profile (cutter-space z 0..5),
  // capped => a single solid loft equal to sweep_rounded + center fill. The
  // bottom sits below the plate and the top pokes above it (clean, non-coplanar).
  // profile radial px -> cross-section roundedRect(idx+2px, idy+2px, r=px).
  const lvl = (px, z) => ({ w: idx + 2 * px, h: idy + 2 * px, r: px, z })
  const levels = [
    lvl(INNER_R, 0), // below plate after shift
    lvl(INNER_R, clearance), // [1.15, 0.35]
    lvl(BASE_PROFILE[1][0] + INNER_R, BASE_PROFILE[1][1] + clearance), // [1.85, 1.05]
    lvl(BASE_PROFILE[2][0] + INNER_R, BASE_PROFILE[2][1] + clearance), // [1.85, 2.85]
    lvl(PROFILE_MAX_X + INNER_R, PROFILE_H + clearance), // [4.0, 5.0]
    lvl(PROFILE_MAX_X + INNER_R, PROFILE_H + clearance + 0.2), // top cap above plate
  ]
  return solidLoft(levels).translate([0, 0, -clearance]) // socket sits in plate z=[0, 4.65]
}

// ---- filler / trace ----
function computeGlobalTraceFraction(fraction, lengthNorm) {
  const scaled = Math.floor(lengthNorm * fraction)
  const whole = Math.floor(scaled / fraction)
  const part = scaled - whole * fraction
  const t = []
  for (let i = 0; i < whole; i++) t.push(1)
  for (let i = 0; i < part; i++) t.push(1 / fraction)
  return t
}

function cumulate(trace) {
  const c = [0]
  for (let i = 0; i < trace.length; i++) c.push(c[c.length - 1] + trace[i])
  return c
}

// ---- segment planning (ports gridflock.scad main() planning) ----
function sumSub(vec, until) { let s = 0; for (let i = 0; i < until; i++) s += vec[i]; return s }

function segmentsPerAxis(trace, bedNorm, startPad = 0, endPad = 0) {
  // Mirrors gridflock's index_assignments: assignments[i] is the [segI, segSize]
  // state BEFORE processing cell i. split_last checks the pre-last-cell state.
  let segI = 0, segSize = startPad
  const assignments = []
  for (let i = 0; i < trace.length; i++) {
    assignments.push([segI, segSize])
    const beginNew = segSize + trace[i] > bedNorm
    if (beginNew) segI++
    segSize = (beginNew ? 0 : segSize) + trace[i]
  }
  const last = assignments[trace.length - 1]
  const splitLast = last[1] + trace[trace.length - 1] + endPad > bedNorm
  return last[0] + (splitLast ? 2 : 1)
}

function planAxisIdeal(trace, bedNorm, startPad = 0, endPad = 0) {
  const c = cumulate(trace)
  const totalSize = c[trace.length] + startPad + endPad // separate_edge_padding=false -> padding_unless_separate = identity
  const segCount = segmentsPerAxis(trace, bedNorm, startPad, endPad)
  const avg = totalSize / segCount
  const assignments = []
  for (let i = 0; i < trace.length; i++) {
    const center = c[i] + trace[i] / 2 + startPad
    const normIx = center / avg
    assignments.push((normIx % 1 === 0 ? normIx - 1 : Math.floor(normIx)))
  }
  const plan = []
  for (let i = 0; i < segCount; i++) plan.push(assignments.filter((a) => a === i).length)
  return plan
}

function planAxisIncrementalVars(trace, bedNorm, startPad = 0, endPad = 0, forceFirst) {
  const c = cumulate(trace)
  if (c[trace.length] + startPad + endPad <= bedNorm) return [trace.length, -1, -1]
  const mid = Math.floor(bedNorm)
  const computeEnd = (first) => { const e = (trace.length - first) % mid; return e === 0 ? mid : e }
  const firstP = forceFirst === undefined ? Math.floor(bedNorm - startPad) : forceFirst
  const endP = computeEnd(firstP)
  const shift = (endP === 1 && trace[trace.length - 1] < 1) ||
    (c[trace.length] - c[trace.length - endP] + endPad) > bedNorm
  const first = shift ? firstP - 1 : firstP
  const end = computeEnd(first)
  return [first, mid, end]
}

function varsToIncremental(trace, vars, startPad = 0, endPad = 0) {
  const axisNorm = trace.length
  const [first, mid, end] = vars
  if (mid === -1) return [first]
  const out = []
  let i = 0, pos = 0
  while (pos < axisNorm) {
    out.push(i === 0 ? first : (pos + mid >= axisNorm ? end : mid))
    i++
    pos = first + mid * (i - 1)
  }
  return out
}

function scorePlanB(planA, planB) {
  const tooSmallStart = planB[0] === 1, tooSmallEnd = planB[2] === 1
  return (tooSmallStart ? 20 : 0) + (tooSmallEnd ? 20 : 0) - Math.abs(planA[0] - planB[0]) - Math.abs(planA[2] - planB[2])
}
function leastIndex(vec) { let bi = 0; for (let i = 1; i < vec.length; i++) if (vec[i] < vec[bi]) bi = i; return bi }

function planAxisStaggered(trace, bedNorm, startPad = 0, endPad = 0) {
  const planVars = (forceFirst) => planAxisIncrementalVars(trace, bedNorm, startPad, endPad, forceFirst)
  const planSize = (vars) => vars[1] === -1 ? 1 : (trace.length - vars[0] - vars[2]) / vars[1] + 2
  const planA1 = planVars(undefined)
  const planA2 = (planA1[1] === -1 || planA1[2] >= 2 || planA1[0] <= 2) ? planA1 : planVars(planA1[0] - 1)
  if (planA1[1] <= 1) {
    const p = varsToIncremental(trace, planA1, startPad, endPad)
    return [p, p]
  }
  const planBShift1 = planVars(planA2[0] - 1)
  const scores = []
  let shift = 1, plan = planBShift1, bestSize = planSize(plan)
  while (shift < planA2[0] && planSize(plan) <= bestSize) {
    scores.push(scorePlanB(planA2, plan))
    shift++
    plan = planVars(planA2[0] - shift)
  }
  const bestShift = leastIndex(scores) + 1
  return [
    varsToIncremental(trace, planA2, startPad, endPad),
    varsToIncremental(trace, planVars(planA2[0] - bestShift), startPad, endPad),
  ]
}

// ---- outline (segment_rectangle, all connectors=false for single segment) ----
function segmentRectangleCS(sx, sy, connector) {
  // rectangle centered, with rounded corners where no adjacent connector.
  const r = PLATE_CORNER_R
  const rect = CrossSection.square([sx, sy], true)
  if (!connector[N] && !connector[E] && !connector[S] && !connector[W]) {
    // all rounded -> offset trick
    const inner = CrossSection.square([sx - 2 * r, sy - 2 * r], true)
    return inner.offset(r, 'Round', 2, FN)
  }
  // General case: punch each corner where both adjacent sides lack a connector.
  let cs = rect
  const hx = sx / 2, hy = sy / 2
  const punch = (cx, cy) => {
    // remove the square corner region beyond the rounding circle
    const sq = CrossSection.square([r, r], false) // corner-anchored
      .translate([cx < 0 ? cx : cx - r, cy < 0 ? cy : cy - r])
    const disk = CrossSection.circle(r, FN).translate([cx < 0 ? cx + r : cx - r, cy < 0 ? cy + r : cy - r])
    return sq.subtract(disk)
  }
  if (!connector[S] && !connector[W]) cs = cs.subtract(punch(-hx, -hy))
  if (!connector[N] && !connector[W]) cs = cs.subtract(punch(-hx, hy))
  if (!connector[S] && !connector[E]) cs = cs.subtract(punch(hx, -hy))
  if (!connector[N] && !connector[E]) cs = cs.subtract(punch(hx, hy))
  return cs
}

// ---- puzzle connectors (intersection puzzle, fit=1 -> *_tight only) ----
// Raw svgelements-reified points (0..256 space) from puzzle.svg via extract_paths.py.
const MALE_TIGHT = [[0.0, 128.0001668], [125.94833692621266, 23.119993648202463], [130.096339131571, 22.474290086771106], [105.302706822411, 89.13037534786902], [108.51534140886999, 106.27532568985332], [125.01776291355998, 103.90732260405332], [142.86098616547997, 81.58089350996333], [155.97780325830996, 80.20169171269333], [165.76021600599998, 92.61770789229332], [165.76021600599998, 137.60017931]]
const FEMALE_TIGHT = [[128.0001668, 31.44004097025], [109.63534286837, 85.760111756], [112.86734708007, 97.14252658868999], [125.84016398525002, 95.56492453287999], [136.24337754192, 81.71530648512], [146.24019056900002, 76.33609947535], [153.46259998069002, 76.5760997881], [168.26171366575988, 93.43436495649817], [167.86097074354242, 137.5644448634336], [45.95142628037433, 137.5716768728578], [46.8772226868012, 31.454358748907822]]

function toMm(p) { return [(p[0] - 128) / 32, (p[1] - 128) / 32] }
function polyCS(points) {
  let cs = CrossSection.ofPolygons([points], 'Positive')
  if (cs.area() < 0) cs = CrossSection.ofPolygons([points.slice().reverse()], 'Positive')
  return cs
}

function puzzleMale0() { return polyCS(MALE_TIGHT.map(toMm)) }
function puzzleFemale0() {
  // mirror([1,0]) applied to the mm points (x -> -x)
  return polyCS(FEMALE_TIGHT.map(toMm).map(([x, y]) => [-x, y]))
}
function puzzleMale(positive) {
  const base = positive ? puzzleMale0() : puzzleMale0().hull()
  const disk = CrossSection.circle(4, FN).translate([-4, -4])
  return base.subtract(disk)
}
function puzzleFemale(positive) {
  const f = puzzleFemale0()
  return positive ? f.hull().subtract(f) : f
}

// ---- cell ----
function cellManifold(ux, uy) {
  const sx = GRID * ux, sy = GRID * uy
  const block = Manifold.cube([sx, sy, PROFILE_H], true).translate([0, 0, PROFILE_H / 2])
  return block.subtract(socketCutter(sx, sy))
}

function cellAxisPosition(dimension, size, trace, paddingStart, index) {
  const c = cumulate(trace)
  const startPosNorm = index < 0 ? index
    : index >= trace.length ? c[trace.length] + (index - trace.length)
    : c[index]
  const ownSizeNorm = (index < 0 || index >= trace.length) ? 1 : trace[index]
  return -size / 2 + paddingStart + (startPosNorm + ownSizeNorm / 2) * dimension
}

// ---- intersection puzzle connector placement (ports segment_intersection_connectors) ----
function navCorner(seg, size, index, diry, dirx) {
  const tx = (index[0] < 0 || index[0] >= seg.traceX.length) ? 1 : seg.traceX[index[0]]
  const ty = (index[1] < 0 || index[1] >= seg.traceY.length) ? 1 : seg.traceY[index[1]]
  const cx = cellAxisPosition(GRID, size[0], seg.traceX, seg.padding[W], index[0]) + (dirx === W ? -1 : 1) * GRID * tx / 2
  const cy = cellAxisPosition(GRID, size[1], seg.traceY, seg.padding[S], index[1]) + (diry === S ? -1 : 1) * GRID * ty / 2
  return [cx, cy]
}
function place(shape, ops, trans) {
  let s = shape
  for (const op of ops) s = op[0] === 'rot' ? s.rotate(op[1]) : s.mirror(op[1])
  return s.translate(trans)
}

/** Union CrossSection of all intersection-puzzle connectors for one pass. */
function intersectionConnectors(positive, seg, size) {
  const male = puzzleMale(positive)
  const female = puzzleFemale(positive)
  const con = seg.connector
  const lastx = seg.traceX.length - 1, lasty = seg.traceY.length - 1
  const parts = []
  const add = (shape, ops, index, diry, dirx) => parts.push(place(shape, ops, navCorner(seg, size, index, diry, dirx)))

  // ops are listed in application order (rotate before mirror), matching OpenSCAD's inner->outer nesting.
  for (let ix = 0; ix <= lastx; ix++) {
    const skipFirst = ix === 0 && con[W]
    const skipLast = ix === lastx && con[E]
    if (con[S]) {
      if (!skipFirst) add(female, [['rot', -90], ['mir', [1, 0]]], [ix, 0], S, W)
      if (!skipLast) add(female, [['rot', -90]], [ix, 0], S, E)
    }
    if (con[N]) {
      if (!skipFirst) add(male, [['rot', 90]], [ix, lasty], N, W)
      if (!skipLast) add(male, [['rot', 90], ['mir', [1, 0]]], [ix, lasty], N, E)
    }
  }
  for (let iy = 0; iy <= lasty; iy++) {
    if (con[W]) {
      add(female, [['rot', 180]], [0, iy], S, W)
      add(female, [['rot', 180], ['mir', [0, 1]]], [0, iy], N, W)
    }
    if (con[E]) {
      add(male, [['mir', [0, 1]]], [lastx, iy], S, E)
      add(male, [], [lastx, iy], N, E)
    }
  }
  let cs = parts.length ? parts[0] : null
  for (let i = 1; i < parts.length; i++) cs = cs.add(parts[i])

  // Corner blocks: add the "other half" connectors at segment corners, clipped to the segment bounds.
  const bmin = [-size[0] / 2, -size[1] / 2]
  const bmax = [size[0] / 2, size[1] / 2]
  const clipX = CrossSection.square([bmax[0] - bmin[0], size[1] + 40], false).translate([bmin[0], -size[1] / 2 - 20])
  const clipY = CrossSection.square([size[0] + 40, bmax[1] - bmin[1]], false).translate([-size[0] / 2 - 20, bmin[1]])
  const cornerX = []
  if (!con[W]) {
    if (con[S]) cornerX.push(place(female, [['rot', -90]], navCorner(seg, size, [0, 0], S, W)))
    if (con[N]) cornerX.push(place(male, [['rot', 90], ['mir', [1, 0]]], navCorner(seg, size, [0, lasty], N, W)))
  }
  if (!con[E]) {
    if (con[S]) cornerX.push(place(female, [['rot', -90], ['mir', [1, 0]]], navCorner(seg, size, [lastx, 0], S, E)))
    if (con[N]) cornerX.push(place(male, [['rot', 90]], navCorner(seg, size, [lastx, lasty], N, E)))
  }
  const cornerY = []
  if (!con[S]) {
    if (con[W]) cornerY.push(place(female, [['rot', 180], ['mir', [0, 1]]], navCorner(seg, size, [0, 0], S, W)))
    if (con[E]) cornerY.push(place(male, [], navCorner(seg, size, [lastx, 0], S, E)))
  }
  if (!con[N]) {
    if (con[W]) cornerY.push(place(female, [['rot', 180]], navCorner(seg, size, [0, lasty], N, W)))
    if (con[E]) cornerY.push(place(male, [['mir', [0, 1]]], navCorner(seg, size, [lastx, lasty], N, E)))
  }
  if (cornerX.length) {
    let u = cornerX[0]; for (let i = 1; i < cornerX.length; i++) u = u.add(cornerX[i])
    u = u.intersect(clipX)
    cs = cs ? cs.add(u) : u
  }
  if (cornerY.length) {
    let u = cornerY[0]; for (let i = 1; i < cornerY.length; i++) u = u.add(cornerY[i])
    u = u.intersect(clipY)
    cs = cs ? cs.add(u) : u
  }
  return cs
}

// ---- edge puzzle connector (default; simpler + fewer manifold issues) ----
// GridFlock: edge_puzzle_dim=[10,2.5] head, edge_puzzle_dim_c=[3,1.2] neck,
// gap=0.15, count=1, N/E male, S/W female. Male tab 2.0mm tall, female 2.25mm.
const EDGE_DIM: [number, number] = [10, 2.5]
const EDGE_DIM_C: [number, number] = [3, 1.2]
const EDGE_GAP = 0.15
const EDGE_H_FEMALE = 2.25
const EDGE_H_MALE = EDGE_H_FEMALE - 0.25 // 2.0
const EDGE_MALE_DIR = [true, true, false, false] // N,E male; S,W female
// How far a male tab's neck sinks into its own piece. The tab is otherwise flush
// with the piece edge, joined only face-to-face — and when the edge coordinate
// carries float noise (a wide cell's fractional trace), that face misses by a
// hair and the tab exports as a loose part. Overlapping makes the join solid.
const EDGE_EMBED = 0.3

/** Rounded bar: rectangle with semicircle caps on both x-ends (round_bar_x). */
function roundBarX(sx: number, sy: number): any {
  let cs = CrossSection.square([sx - sy, sy], false).translate([sy / 2, 0])
  cs = cs.add(CrossSection.circle(sy / 2, FN).translate([sy / 2, sy / 2]))
  cs = cs.add(CrossSection.circle(sy / 2, FN).translate([sx - sy / 2, sy / 2]))
  return cs
}
/** Negative rounded bar: rectangle with the end circles cut out (round_bar_x_neg). */
function roundBarXNeg(sx: number, sy: number): any {
  let cs = CrossSection.square([sx + sy, sy], false).translate([-sy / 2, 0])
  cs = cs.subtract(CrossSection.circle(sy / 2, FN).translate([-sy / 2, sy / 2]))
  cs = cs.subtract(CrossSection.circle(sy / 2, FN).translate([sx + sy / 2, sy / 2]))
  return cs
}

/** One cell-edge's edge-puzzle 2D shape (south-edge orientation), or null. */
function edgePuzzle(positive: boolean, male: boolean): any {
  const [dcx, dcy] = EDGE_DIM_C, [dx, dy] = EDGE_DIM, g = EDGE_GAP
  if (male) {
    if (!positive) return null
    let cs = roundBarXNeg(dcx, dcy).translate([-dcx / 2, -dcy])
    cs = cs.add(roundBarX(dx, dy).translate([-dx / 2, -dcy - dy]))
    cs = cs.add(CrossSection.square([dcx, EDGE_EMBED], false).translate([-dcx / 2, 0]))
    return cs
  }
  if (positive) return null
  let cs = roundBarXNeg(dcx + g * 2, dcy - g).translate([-dcx / 2 - g, 0])
  cs = cs.add(roundBarX(dx + g, dy + g).translate([-dx / 2 - g, dcy - g]))
  return cs
}

/** Translate to a cell edge midpoint (navigate_edge). */
function navEdge(seg, size, index, dir): [number, number] {
  const tx = (index[0] < 0 || index[0] >= seg.traceX.length) ? 1 : seg.traceX[index[0]]
  const ty = (index[1] < 0 || index[1] >= seg.traceY.length) ? 1 : seg.traceY[index[1]]
  // Along its edge, a connector sits where it would on a standard 42 mm cell. A
  // wide cell's extra runs off its far (+x / +y) end, so pull the connector back
  // from the wide cell's middle to half a cell from its near gridline.
  const wide = (t) => -(t - Math.min(t, 1)) * GRID / 2
  const cx = cellAxisPosition(GRID, size[0], seg.traceX, seg.padding[W], index[0]) +
    (dir === W ? -GRID * tx / 2 : dir === E ? GRID * tx / 2 : wide(tx))
  const cy = cellAxisPosition(GRID, size[1], seg.traceY, seg.padding[S], index[1]) +
    (dir === S ? -GRID * ty / 2 : dir === N ? GRID * ty / 2 : wide(ty))
  return [cx, cy]
}

/** Union CrossSection of edge-puzzle connectors for one pass (segment_edge_connectors). */
function edgeConnectors(positive: boolean, seg, size): any {
  const con = seg.connector
  const lastx = seg.traceX.length - 1, lasty = seg.traceY.length - 1
  const parts: any[] = []
  const put = (male: boolean, ops, index, dir) => {
    const shape = edgePuzzle(positive, male)
    if (shape) parts.push(place(shape, ops, navEdge(seg, size, index, dir)))
  }
  // A cell too thin along the seam for a tab (a narrow edge cell) gets none.
  const roomy = (t: number) => t * GRID >= defaults.connectorMin
  for (let ix = 0; ix <= lastx; ix++) {
    if (!roomy(seg.traceX[ix])) continue
    if (con[S]) put(EDGE_MALE_DIR[S], [], [ix, 0], S)
    if (con[N]) put(EDGE_MALE_DIR[N], [['mir', [0, 1]]], [ix, lasty], N)
  }
  for (let iy = 0; iy <= lasty; iy++) {
    if (!roomy(seg.traceY[iy])) continue
    if (con[W]) put(EDGE_MALE_DIR[W], [['rot', 90], ['mir', [1, 0]]], [0, iy], W)
    if (con[E]) put(EDGE_MALE_DIR[E], [['rot', 90]], [lastx, iy], E)
  }
  if (!parts.length) return null
  let cs = parts[0]
  for (let i = 1; i < parts.length; i++) cs = cs.add(parts[i])
  return cs
}

/** Neighboring cells just outside the segment edges, to clip male tabs to fit. */
function overlapCells(seg, size): any {
  const con = seg.connector
  const lastx = seg.traceX.length - 1, lasty = seg.traceY.length - 1
  const cells: any[] = []
  const put = (ux, uy, index) => {
    const px = cellAxisPosition(GRID, size[0], seg.traceX, seg.padding[W], index[0])
    const py = cellAxisPosition(GRID, size[1], seg.traceY, seg.padding[S], index[1])
    cells.push(cellManifold(ux, uy).translate([px, py, 0]))
  }
  for (let ix = 0; ix <= lastx; ix++) {
    if (con[S]) put(seg.traceX[ix], 1, [ix, -1])
    if (con[N]) put(seg.traceX[ix], 1, [ix, lasty + 1])
  }
  for (let iy = 0; iy <= lasty; iy++) {
    if (con[W]) put(1, seg.traceY[iy], [-1, iy])
    if (con[E]) put(1, seg.traceY[iy], [lastx + 1, iy])
  }
  if (!cells.length) return null
  let u = cells[0]
  for (let i = 1; i < cells.length; i++) u = u.add(cells[i])
  return u
}

// Connector style for the current build: 'edge' (default), 'intersection', or 'none'.
let CONNECTOR_MODE = 'edge'

// ---- build one segment ----
export function buildSegmentPublic(traceX, traceY, padding, connector) {
  return buildSegment(traceX, traceY, padding, connector)
}
function buildSegment(traceX, traceY, padding, connector) {
  const seg = { traceX, traceY, padding, connector }
  const cx = cumulate(traceX), cy = cumulate(traceY)
  const sizeX = GRID * cx[traceX.length] + padding[E] + padding[W]
  const sizeY = GRID * cy[traceY.length] + padding[N] + padding[S]
  const size = [sizeX, sizeY]
  const hasConn = connector[N] || connector[E] || connector[S] || connector[W]

  // One solid slab (cells + any padding) with every cell's socket cut out of it.
  // Not a union of per-cell blocks: those only meet face to face, and a wide
  // cell's fractional trace puts float noise in the cell edges, so neighbouring
  // blocks can miss by a hair and the piece falls apart along cell lines.
  const cutters = []
  for (let ix = 0; ix < traceX.length; ix++) {
    for (let iy = 0; iy < traceY.length; iy++) {
      const px = cellAxisPosition(GRID, sizeX, traceX, padding[W], ix)
      const py = cellAxisPosition(GRID, sizeY, traceY, padding[S], iy)
      cutters.push(socketCutter(GRID * traceX[ix], GRID * traceY[iy]).translate([px, py, 0]))
    }
  }
  let inner = Manifold.cube([sizeX, sizeY, PROFILE_H], true).translate([0, 0, PROFILE_H / 2])
  for (const c of cutters) inner = inner.subtract(c)

  // outline (rounded corners; square where an adjacent edge has a connector)
  let outlineCS = segmentRectangleCS(sizeX, sizeY, connector)
  const intersectionMode = hasConn && CONNECTOR_MODE === 'intersection'
  if (intersectionMode) {
    const neg = intersectionConnectors(false, seg, size)
    if (neg) outlineCS = outlineCS.subtract(neg)
  }
  let solid = inner.intersect(outlineCS.extrude(PROFILE_H))

  if (intersectionMode) {
    // full-height male tabs + female frames
    const pos = intersectionConnectors(true, seg, size)
    if (pos && !pos.isEmpty()) solid = solid.add(pos.extrude(PROFILE_H))
  } else if (hasConn && CONNECTOR_MODE === 'edge') {
    // Edge puzzle: short bottom features. Cut female sockets, add male tabs
    // (clipped to the neighboring cell footprint so they mate cleanly, plus this
    // piece's own footprint so each tab's embedded neck survives and joins it).
    const female = edgeConnectors(false, seg, size)
    if (female && !female.isEmpty()) solid = solid.subtract(female.extrude(EDGE_H_FEMALE))
    const male = edgeConnectors(true, seg, size)
    if (male && !male.isEmpty()) {
      let tab = male.extrude(EDGE_H_MALE)
      const clip = overlapCells(seg, size)
      // This piece's footprint, grown by the embed so it overlaps the neighbour
      // cells (rather than meeting them face to face) and the clip stays one region.
      const own = Manifold.cube([sizeX + 2 * EDGE_EMBED, sizeY + 2 * EDGE_EMBED, PROFILE_H], true).translate([0, 0, PROFILE_H / 2])
      if (clip) tab = tab.intersect(clip.add(own))
      if (!tab.isEmpty()) solid = solid.add(tab)
    }
  }
  return solid
}

// ---- top-level plate: assemble all planned segments ----
export function buildPlate(plateSize /* [x,y] mm */, bedSize /* [x,y] */, opts = {}) {
  CONNECTOR_MODE = opts.connector || 'edge'
  const plan = planPlate(plateSize, bedSize, opts)
  let out = null
  for (const s of plan.segments) {
    let m = buildSegment(s.traceX, s.traceY, s.padding, s.connector)
    m = m.translate([s.pos[0], s.pos[1], 0])
    out = out ? out.add(m) : m
  }
  return out
}

/** Build a single segment given its plan entry (for debugging one piece). */
export function buildOneSegment(plateSize, bedSize, segIndex = 0, opts = {}) {
  const plan = planPlate(plateSize, bedSize, opts)
  const s = plan.segments[segIndex]
  return buildSegment(s.traceX, s.traceY, s.padding, s.connector)
}

// ---- plate planner (ports main() segment layout) ----
export function planPlate(plateSize, bedSize, opts = {}) {
  const fraction = opts.fillerFraction || [2, 2]
  const alignment = opts.alignment || [0.5, 0.5]
  const mode = opts.connector || 'edge' // 'edge' | 'intersection' | 'none'
  // `opts.globalTrace` (per axis: array of cell sizes as fractions of GRID) drives
  // the plate directly — the app's interior tracks, where the leftover is folded
  // into a wide right/back edge cell, not GridFlock's whole/half-cell + centered
  // padding. When it sums to plateSize/GRID there is no filler padding at all.
  const globalTrace = opts.globalTrace ?? [
    computeGlobalTraceFraction(fraction[0], plateSize[0] / GRID),
    computeGlobalTraceFraction(fraction[1], plateSize[1] / GRID),
  ]
  const gtc = [cumulate(globalTrace[0]), cumulate(globalTrace[1])]
  const padSum = [
    plateSize[0] - gtc[0][globalTrace[0].length] * GRID,
    plateSize[1] - gtc[1][globalTrace[1].length] * GRID,
  ]
  const platePadding = [
    padSum[1] * (1 - alignment[1]), // N
    padSum[0] * (1 - alignment[0]), // E
    padSum[1] * alignment[1], // S
    padSum[0] * alignment[0], // W
  ]
  // Keep bed margin clear for connectors (gridflock connector_margin).
  const connectorMargin =
    mode === 'intersection' ? 3.5 : mode === 'edge' ? EDGE_DIM_C[1] + EDGE_DIM[1] : 0
  const bedNorm = [(bedSize[0] - connectorMargin) / GRID, (bedSize[1] - connectorMargin) / GRID]
  const startPadNorm = [platePadding[W] / GRID, platePadding[S] / GRID]
  const endPadNorm = [platePadding[E] / GRID, platePadding[N] / GRID]

  const planX = planAxisIdeal(globalTrace[0], bedNorm[0], startPadNorm[0], endPadNorm[0])
  const plansY = planAxisStaggered(globalTrace[1], bedNorm[1], startPadNorm[1], endPadNorm[1])
  const planXcum = cumulate(planX)
  const plansYcum = [cumulate(plansY[0]), cumulate(plansY[1])]
  const getPlanY = (segx) => plansY[segx % 2]
  const getPlanYcum = (segx) => plansYcum[segx % 2]

  const segPadding = (sx, sy) => [
    sy === getPlanY(sx).length - 1 ? platePadding[N] : 0,
    sx === planX.length - 1 ? platePadding[E] : 0,
    sy === 0 ? platePadding[S] : 0,
    sx === 0 ? platePadding[W] : 0,
  ]
  const cellsBefore = (pyc, sx, sy) => [gtc[0][planXcum[sx]], gtc[1][pyc[sy]]]
  const segSize = (sx, sy) => {
    const pyc = getPlanYcum(sx)
    const before = cellsBefore(pyc, sx, sy)
    const after = cellsBefore(pyc, sx + 1, sy + 1)
    const pad = segPadding(sx, sy)
    return [pad[W] + pad[E] + (after[0] - before[0]) * GRID, pad[N] + pad[S] + (after[1] - before[1]) * GRID]
  }
  const segPos = (sx, sy) => {
    const pyc = getPlanYcum(sx)
    const allSize = [
      platePadding[W] + platePadding[E] + gtc[0][globalTrace[0].length] * GRID + (planX.length - 1) * SEGMENT_GAP,
      platePadding[S] + platePadding[N] + gtc[1][globalTrace[1].length] * GRID + (getPlanY(sx).length - 1) * SEGMENT_GAP,
    ]
    const before = cellsBefore(pyc, sx, sy)
    const sz = segSize(sx, sy)
    return [
      -allSize[0] / 2 + before[0] * GRID + (sx !== 0 ? platePadding[W] : 0) + sz[0] / 2 + sx * SEGMENT_GAP,
      -allSize[1] / 2 + before[1] * GRID + (sy !== 0 ? platePadding[S] : 0) + sz[1] / 2 + sy * SEGMENT_GAP,
    ]
  }

  const segments = []
  for (let sx = 0; sx < planX.length; sx++) {
    for (let sy = 0; sy < getPlanY(sx).length; sy++) {
      const traceX = globalTrace[0].slice(planXcum[sx], planXcum[sx] + planX[sx])
      const traceY = globalTrace[1].slice(getPlanYcum(sx)[sy], getPlanYcum(sx)[sy] + getPlanY(sx)[sy])
      const connector = [
        sy !== getPlanY(sx).length - 1, // N
        sx !== planX.length - 1, // E
        sy !== 0, // S
        sx !== 0, // W
      ]
      const globalSegmentIndex = sy + Math.ceil(sx / 2) * plansY[0].length + Math.floor(sx / 2) * plansY[1].length
      segments.push({
        sx, sy, traceX, traceY,
        padding: segPadding(sx, sy),
        connector,
        pos: segPos(sx, sy),
        size: segSize(sx, sy),
        globalSegmentIndex,
      })
    }
  }
  return { globalTrace, platePadding, planX, plansY, segments }
}

export const SEGMENT_GAP = 10 // _segment_gap — spacing between exported pieces

// ---- seam positions (where the plate splits), in DRAWER mm coords ----
/**
 * The base plate's segment boundaries as line positions inside the interior
 * footprint (top-left origin, x→right, y→down). Derived from the SAME plan the
 * exported base is built from, so the seams shown match the seams that ship.
 * X segments are full-height bands (`xEdges`); each band splits in Y at its own
 * `yEdges` (staggered between neighbouring bands, exactly like gridflock).
 */
export function planSeams(plateSize, bedSize, opts = {}) {
  const plan = planPlate(plateSize, bedSize, opts)
  const gtcX = cumulate(plan.globalTrace[0])
  const gtcY = cumulate(plan.globalTrace[1])
  const planXcum = cumulate(plan.planX)
  const plansYcum = [cumulate(plan.plansY[0]), cumulate(plan.plansY[1])]
  const padW = plan.platePadding[W]
  const padS = plan.platePadding[S]
  const D = plateSize[1]

  const xEdges = []
  for (let k = 0; k <= plan.planX.length; k++) {
    xEdges.push(padW + gtcX[planXcum[k]] * GRID)
  }

  const bands = []
  for (let sx = 0; sx < plan.planX.length; sx++) {
    const planY = plan.plansY[sx % 2]
    const pyc = plansYcum[sx % 2]
    // Cell boundaries measured from the S (bottom) edge, flipped to top-down.
    const yEdges = []
    for (let j = 0; j <= planY.length; j++) {
      yEdges.push(D - (padS + gtcY[pyc[j]] * GRID))
    }
    yEdges.reverse()
    bands.push({ x0: xEdges[sx], x1: xEdges[sx + 1], yEdges })
  }
  return { xEdges, bands, segmentCount: plan.segments.length }
}

// ---- STL export ----
/** The same mesh as {@link manifoldToStl}, as binary STL — what downloads use. */
export function manifoldToBinaryStl(man, name = 'baseplate') {
  const mesh = man.getMesh()
  return binaryStl(mesh.vertProperties, mesh.triVerts, name)
}

export function manifoldToStl(man, name = 'baseplate') {
  const mesh = man.getMesh()
  const nTri = mesh.numTri
  const pos = mesh.vertProperties
  const tv = mesh.triVerts
  const lines = [`solid ${name}`]
  const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  for (let t = 0; t < nTri; t++) {
    const a = v(tv[t * 3]), b = v(tv[t * 3 + 1]), c = v(tv[t * 3 + 2])
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    lines.push(`facet normal ${nx} ${ny} ${nz}`)
    lines.push('outer loop')
    lines.push(`vertex ${a[0]} ${a[1]} ${a[2]}`)
    lines.push(`vertex ${b[0]} ${b[1]} ${b[2]}`)
    lines.push(`vertex ${c[0]} ${c[1]} ${c[2]}`)
    lines.push('endloop')
    lines.push('endfacet')
  }
  lines.push(`endsolid ${name}`)
  return lines.join('\n')
}
