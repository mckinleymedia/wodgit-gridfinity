// @ts-nocheck — manifold-3d's encapsulated objects are untyped; the public API
// is typed in generate.ts.
/**
 * Clean-room gridfinity BIN (bin) geometry on manifold-3d CSG, reverse-engineered
 * to match the GridFlock "box" export (reference/bins/box-2-4-7.stl) to <0.05 mm.
 *
 * A bin is: per-cell chamfered base feet (which plug into the baseplate) + a
 * solid floor slab + straight outer walls with an open top. There is NO stacking
 * lip. Units: mm; the bin is centered on the origin in X/Y and sits on Z=0.
 *
 * The manifold API is injected via setApi() so the same geometry runs in the
 * browser and in Node (tools/genbin.ts) — one source of truth.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaults } from './defaults'
import { binaryStl } from './stl'

let Manifold: any
let CrossSection: any
let Mesh: any

export function setApi(api: any): void {
  Manifold = api.Manifold
  CrossSection = api.CrossSection
  Mesh = api.Mesh
}

// ---- measured constants (from reference/bins/box-2-4-7.stl) ----
export const GRID = defaults.grid // cell pitch
const CLR = 0.31 // per-side gap: outer half-extent = n*GRID/2 - CLR
const OUTER_R = 3.75 // outer corner radius
const WALL = 1.2 // wall thickness (flat sections)
// Cavity corner radius — measured independently; NOT outer_r - wall. The interior
// fillet is more generous than the wall implies (ref: 3.15 at the +x+y corner).
const INNER_R = 3.15

// Base foot profile (45° chamfers), radial inset & height from Z=0 upward.
const H_CHAMFER_BOT = 0.8 // bottom chamfer height (== inset)
const H_STRAIGHT = 1.8 // vertical section
const H_CHAMFER_TOP = 2.15 // top chamfer height (== inset)
const H_BASE = H_CHAMFER_BOT + H_STRAIGHT + H_CHAMFER_TOP // 4.75

const FLOOR_TOP = 5.96 // Z of the interior floor (cavity bottom)
const HEIGHT_UNIT = defaults.heightUnit // one gridfinity height unit, mm
// Total bin height = H_BASE + 7*u + 0.10. Confirmed exact (Δ 0.000 mm) against
// reference exports at u = 2, 3, 4, 6, 7, 9, 12.
const HEIGHT_FUDGE = 0.1

const EPS = 1e-3
const FN = 40 // arc tessellation, matching the baseplate core

/** Total bin height (mm) for `units` gridfinity height units. */
export function binHeightMm(units: number): number {
  return H_BASE + HEIGHT_UNIT * units + HEIGHT_FUDGE
}

// ---- helpers ----
function roundedRectCS(w, h, r) {
  if (r <= 1e-9) return CrossSection.square([w, h], true)
  const iw = w - 2 * r, ih = h - 2 * r
  const base = CrossSection.square([Math.max(iw, 1e-6), Math.max(ih, 1e-6)], true)
  return base.offset(r, 'Round', 2, FN)
}

const SEG_PER_CORNER = FN / 4

/** CCW boundary loop of a rounded rectangle centered at origin: array of [x,y]. */
function roundedRectLoop(w, h, r) {
  const hw = w / 2 - r, hh = h / 2 - r
  const corners = [
    [hw, -hh, -90],
    [hw, hh, 0],
    [-hw, hh, 90],
    [-hw, -hh, 180],
  ]
  const pts = []
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= SEG_PER_CORNER; s++) {
      const a = ((a0 + (90 * s) / SEG_PER_CORNER) * Math.PI) / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/**
 * Rounded-rect loop (as roundedRectLoop) but with extra vertices inserted on the
 * straight edges at the given junction coordinates. Used for the body wall so it
 * shares exact vertices with the feet that meet it — avoiding T-junctions (and
 * the zero-area sliver triangles manifold otherwise emits to resolve them).
 * @param xJ x-values to add on the top/bottom edges; @param yJ y-values on sides.
 */
function roundedRectLoopJ(w, h, r, xJ, yJ) {
  const hw = w / 2 - r, hh = h / 2 - r
  const inside = (vals, lim) =>
    [...new Set(vals)].filter((v) => Math.abs(v) < lim - 1e-6).sort((a, b) => a - b)
  const xs = inside(xJ, hw)
  const ys = inside(yJ, hh)
  const arc = (cx, cy, a0) => {
    const pts = []
    for (let s = 0; s <= SEG_PER_CORNER; s++) {
      const a = ((a0 + (90 * s) / SEG_PER_CORNER) * Math.PI) / 180
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    return pts
  }
  const loop = []
  loop.push(...arc(hw, -hh, -90))
  for (const y of ys) loop.push([w / 2, y]) // +x edge, ascending
  loop.push(...arc(hw, hh, 0))
  for (const x of [...xs].reverse()) loop.push([x, h / 2]) // +y edge, descending
  loop.push(...arc(-hw, hh, 90))
  for (const y of [...ys].reverse()) loop.push([-w / 2, y]) // -x edge, descending
  loop.push(...arc(-hw, -hh, 180))
  for (const x of xs) loop.push([x, -h / 2]) // -y edge, ascending
  return loop
}

/** Loft a single constant boundary loop between z0 and z1 with flat caps. */
function loftConst(loop, z0, z1) {
  const P = loop.length
  const verts = []
  for (const z of [z0, z1]) for (const [x, y] of loop) verts.push(x, y, z)
  const botC = verts.length / 3
  verts.push(0, 0, z0)
  const topC = verts.length / 3
  verts.push(0, 0, z1)
  const tris = []
  const idx = (lvl, k) => lvl * P + k
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P
    tris.push(idx(0, k), idx(0, k2), idx(1, k2), idx(0, k), idx(1, k2), idx(1, k))
    tris.push(botC, idx(0, k2), idx(0, k)) // bottom cap (−z)
    tris.push(topC, idx(1, k), idx(1, k2)) // top cap (+z)
  }
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
  })
  return Manifold.ofMesh(mesh)
}

/**
 * Closed manifold lofting a stack of rounded-rect cross-sections (levels:
 * [{w,h,r,z}], increasing z) with flat caps. All levels share a boundary point
 * count, so the sides are slice-clean (no CSG-union slivers).
 */
function solidLoft(levels) {
  const loops = levels.map((L) => roundedRectLoop(L.w, L.h, L.r))
  const P = loops[0].length
  const verts = []
  for (let i = 0; i < levels.length; i++) {
    for (let k = 0; k < P; k++) verts.push(loops[i][k][0], loops[i][k][1], levels[i].z)
  }
  const botC = verts.length / 3
  verts.push(0, 0, levels[0].z)
  const topC = verts.length / 3
  verts.push(0, 0, levels[levels.length - 1].z)

  const tris = []
  const idx = (lvl, k) => lvl * P + k
  for (let i = 0; i < levels.length - 1; i++) {
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P
      const a = idx(i, k), b = idx(i, k2), c = idx(i + 1, k2), d = idx(i + 1, k)
      tris.push(a, b, c, a, c, d)
    }
  }
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P
    tris.push(botC, idx(0, k2), idx(0, k))
  }
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

/** A straight rounded-rect prism from z0 to z1, using the same loft machinery
 * (and hence identical corner vertices) as the feet — so unions merge cleanly. */
function prism(w, h, r, z0, z1) {
  return solidLoft([
    { w, h, r, z: z0 },
    { w, h, r, z: z1 },
  ])
}

/** Foot half-extent at the top of the base for a track of width `size` mm: half
 * the track less the clearance — 20.69 for a standard cell, wider for the wide
 * edge cell, so its foot fills the track. */
function footExtent(size: number): number {
  return size / 2 - CLR
}

/**
 * A single base foot with per-axis top half-extents `ex`, `ey` (mm), centered at
 * origin, spanning Z=[0, H_BASE]. `ex = ey = GRID/2 - CLR` reproduces the standard
 * full-cell foot exactly; a bigger extent widens THAT axis while keeping the
 * identical 45° chamfer profile (same heights, same radial runs) — so the wide
 * edge cell's foot is the standard foot, stretched.
 */
function footXY(ex: number, ey: number) {
  const inset = H_CHAMFER_TOP + H_CHAMFER_BOT
  // Keep each corner radius within the half-extent it rounds.
  const rAt = (r: number, level: number) => Math.max(1e-3, Math.min(r, Math.min(ex, ey) - level))
  return solidLoft([
    { w: 2 * (ex - inset), h: 2 * (ey - inset), r: rAt(OUTER_R - inset, inset), z: 0 },
    { w: 2 * (ex - H_CHAMFER_TOP), h: 2 * (ey - H_CHAMFER_TOP), r: rAt(OUTER_R - H_CHAMFER_TOP, H_CHAMFER_TOP), z: H_CHAMFER_BOT },
    { w: 2 * (ex - H_CHAMFER_TOP), h: 2 * (ey - H_CHAMFER_TOP), r: rAt(OUTER_R - H_CHAMFER_TOP, H_CHAMFER_TOP), z: H_CHAMFER_BOT + H_STRAIGHT },
    { w: 2 * ex, h: 2 * ey, r: rAt(OUTER_R, 0), z: H_BASE },
  ])
}

/**
 * Foot centres for one axis: each foot sits at the centre of its OWN track,
 * measured from the run centre. Standard cells fall on the 42 mm lattice; the
 * wide edge track's foot sits at that track's midpoint — so it lines up with
 * the baseplate socket, which is built the same way. `start` is the cumulative
 * track offsets, `span` the total run length.
 */
function footCenters(sizes: number[], start: number[], span: number): number[] {
  return sizes.map((s, i) => start[i] + s / 2 - span / 2)
}

/**
 * Build a gridfinity bin from explicit per-track sizes, `units` height units
 * tall. Returns a single watertight Manifold centered in X/Y, sitting on Z=0.
 *
 * `colSizes`/`rowSizes` are the mm width/depth of each column/row track.
 * Standard cells are {@link GRID} (42); an interior's edge track is wider (42 plus
 * the leftover). Passing all-42 arrays reproduces a standard whole-cell bin
 * exactly. A wide track grows the outer dimension on that edge only — every 3D
 * transition (corners, wall, chamfers, floor) is unchanged; the edge moves out
 * and its foot widens to fill the track, with the same chamfer profile.
 */
export function buildBin(
  colSizes: number[],
  rowSizes: number[],
  units: number,
  walls?: BinSpec["walls"],
  seams?: { x: number[]; y: number[] },
) {
  const nx = colSizes.length
  const ny = rowSizes.length
  const colStart = [0]
  for (const s of colSizes) colStart.push(colStart[colStart.length - 1] + s)
  const rowStart = [0]
  for (const s of rowSizes) rowStart.push(rowStart[rowStart.length - 1] + s)
  const W = colStart[nx]
  const D = rowStart[ny]
  const outerW = W - 2 * CLR
  const outerD = D - 2 * CLR
  const topZ = binHeightMm(units)

  // Each foot is centred in its own track (standard cells land on the 42 mm
  // lattice; the wide edge track at its midpoint) and sized to that track, keeping
  // the standard chamfer profile on every side.
  const colNom = footCenters(colSizes, colStart, W)
  const rowNom = footCenters(rowSizes, rowStart, D)
  const colExt = colSizes.map(footExtent)
  const rowExt = rowSizes.map(footExtent)

  // Outer solid: a straight body prism (top of base → top) unioned with the
  // per-cell feet. The prism wall carries vertices exactly where each foot's flat
  // top-of-base edge meets it (foot centre ± flat half-width), so the union shares
  // those vertices instead of leaving T-junction sliver triangles. A wide edge
  // foot's junctions sit further out than a standard cell's.
  const xJ = colNom.flatMap((c, i) => [c - (colExt[i] - OUTER_R), c + (colExt[i] - OUTER_R)])
  const yJ = rowNom.flatMap((c, j) => [c - (rowExt[j] - OUTER_R), c + (rowExt[j] - OUTER_R)])
  let outer = loftConst(roundedRectLoopJ(outerW, outerD, OUTER_R, xJ, yJ), H_BASE, topZ)

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      outer = outer.add(footXY(colExt[i], rowExt[j]).translate([colNom[i], rowNom[j], 0]))
    }
  }

  // Hollow out the interior above the floor.
  const cavity = roundedRectCS(outerW - 2 * WALL, outerD - 2 * WALL, INNER_R)
    .extrude(topZ - FLOOR_TOP + EPS)
    .translate([0, 0, FLOOR_TOP])
  let bin = outer.subtract(cavity)

  // Internal partition walls: thin full-height fins rising from the floor. Each
  // is given in bin-local normalized form — `dir` ('v' runs along +Y/depth, 'h'
  // along +X/width), `across` the 0..1 position on the thin axis, `center` the
  // 0..1 midpoint on the run axis, and `flen` the run length as a fraction of the
  // interior. A full-length wall reaches `flen = 1` and overlaps the side walls,
  // unioning cleanly; a shorter one is a free-standing fin sitting on the floor
  // (dipped EPS into it so the base merges rather than lying coplanar).
  const innerW = outerW - 2 * WALL
  const innerD = outerD - 2 * WALL
  const wallH = topZ - FLOOR_TOP
  // A divider that crosses a seam (where a bin too big for the bed is cut) is
  // built thicker, so its free end at the cut is stiff and can carry tabs.
  const seamX = (seams?.x ?? []).map((v) => v - W / 2)
  const seamY = (seams?.y ?? []).map((v) => v - D / 2)
  for (const w of walls ?? []) {
    // Per-wall height: `fh` (0..1) of the interior. Full-height (fh=1) walls reach
    // the rim; the default is lower. The box dips EPS into the floor so its base
    // merges cleanly; its top lands at FLOOR_TOP + wallH·fh.
    const hz = Math.min(1, w.fh ?? 1) * wallH
    const zh = hz + EPS
    const cz = FLOOR_TOP - EPS + zh / 2
    if (w.dir === 'v') {
      const cx = innerW * (w.across - 0.5)
      const cy = innerD * (w.center - 0.5)
      const len = innerD * w.flen
      const t = seamY.some((sy) => dividerCrosses(cy, len, sy)) ? DIVIDER_SEAM_T : WALL
      bin = bin.add(Manifold.cube([t, len, zh], true).translate([cx, cy, cz]))
    } else {
      const cy = innerD * (w.across - 0.5)
      const cx = innerW * (w.center - 0.5)
      const len = innerW * w.flen
      const t = seamX.some((sx) => dividerCrosses(cx, len, sx)) ? DIVIDER_SEAM_T : WALL
      bin = bin.add(Manifold.cube([len, t, zh], true).translate([cx, cy, cz]))
    }
  }

  return bin
}

/**
 * One bin to place, centered at (cxMm, cyMm). `colSizes`/`rowSizes` are the mm
 * size of each column/row track it spans — all {@link GRID} for a whole-cell
 * bin, with a wide edge track for one on the right column or back row. `rowSizes` is in the
 * bin's local +Y (ascending) order.
 */
export interface BinSpec {
  colSizes: number[]
  rowSizes: number[]
  units: number
  cxMm: number
  cyMm: number
  /**
   * Internal partition walls in bin-local normalized form. `dir` 'v' runs along
   * depth / 'h' along width; `across` is the 0..1 thin-axis position, `center`
   * the 0..1 run-axis midpoint, `flen` the run length as a fraction of interior,
   * and `fh` the wall height as a fraction of the interior height (default 1).
   */
  walls?: { dir: 'v' | 'h'; across: number; center: number; flen: number; fh: number }[]
  /**
   * Print just one piece of a bin too big for the bed (see lib/cuts). Edges in mm
   * from the bin's −x / −y corner, on cell lines; an edge inside the bin is a
   * seam. (cxMm, cyMm) still place the WHOLE bin's centre, so pieces land where
   * they belong in it. `key` lets pieces of one bin share its build.
   */
  piece?: {
    x0: number
    x1: number
    y0: number
    y1: number
    key: string
    /** Every seam in the whole bin (mm from its −x / −y corner): dividers
     * crossing one are built thicker. */
    seams?: { x: number[]; y: number[] }
  }
}

// ---- Pieces and their joining tabs ----
//
// A bin too long for the bed prints in pieces cut on cell lines. Each piece
// keeps whole cells under it, so it plugs into the base grid on its own; the
// seam is left open (no end wall), so the compartment runs on into the next
// piece. Thin tabs on the inside face of every wall that crosses a seam reach
// across it and slide along the inside of the neighbour's wall.
//
// Tabs sit in bands up the wall, alternating which side of the seam owns each
// band — and alternating again between the two walls — so the two pieces'
// tabs interleave instead of colliding (a piece and its 180°-turned twin lock
// together). Every band stays above the floor and below the rim, so no tab
// meets a curve or chamfer.
const TAB_T = 1.5 // tab thickness
const TAB_CLR = 0.2 // gap between a tab and the neighbour's wall it slides along
const TAB_REACH = 3.5 // how far a tab reaches past the neighbour's edge
const TAB_ROOT = 6 // how far a tab runs back along its own wall
const TAB_EMBED = 0.4 // how far the root sinks into its own wall
const TAB_BAND = 12 // target band height
const TAB_FLOOR_GAP = 2.5 // clearance above the floor
const TAB_RIM_GAP = 1.5 // clearance below the rim
const DIVIDER_SEAM_T = 2 * WALL // a divider crossing a seam is twice as thick

/** Whether a divider centred at `c` with run length `len` crosses a seam at `s`
 * with room for a tab's root on both sides. */
function dividerCrosses(c: number, len: number, s: number): boolean {
  const margin = TAB_ROOT + 1
  return s > c - len / 2 + margin && s < c + len / 2 - margin
}

/**
 * The tab bands for a wall: [z0, z1] spans between `zMin` and the rim. Each band
 * must be tall enough for the 45° ends of a tab that reaches 2·CLR + TAB_REACH.
 */
function tabBands(zMin: number, topZ: number): [number, number][] {
  const zMax = topZ - TAB_RIM_GAP
  const reach = 2 * CLR + TAB_REACH
  const minBand = 2 * reach + 2
  const span = zMax - zMin
  if (span < minBand) return []
  const n = Math.max(1, Math.floor(span / TAB_BAND))
  const h = span / n
  if (h < minBand) return [[zMin, zMax]]
  return Array.from({ length: n }, (_, i) => [zMin + i * h, zMin + (i + 1) * h] as [number, number])
}

/**
 * One tab, in a frame where u runs across the seam (u = 0 on the seam, the owner
 * on u < 0) and v runs into the bin from the wall's inner face (v = 0 at the
 * face). Built as two prisms: the root, sunk into the owner's wall, and the
 * reach, whose top and bottom slope 45° to its tip so it prints unsupported.
 */
function tabSolid(z0: number, z1: number) {
  const ownEdge = -CLR
  const tip = CLR + TAB_REACH
  const root = CrossSection.ofPolygons([
    [
      [-TAB_ROOT, z0],
      [ownEdge, z0],
      [ownEdge, z1],
      [-TAB_ROOT, z1],
    ],
  ])
    .extrude(TAB_T + TAB_CLR + TAB_EMBED)
    .translate([0, 0, -TAB_EMBED]) // v from −EMBED (into the wall) to T + CLR
  const run = tip - ownEdge
  const reach = CrossSection.ofPolygons([
    [
      [ownEdge - 0.5, z0],
      [tip, z0 + run],
      [tip, z1 - run],
      [ownEdge - 0.5, z1],
    ],
  ])
    .extrude(TAB_T)
    .translate([0, 0, TAB_CLR]) // v from CLR to CLR + T: clear of the neighbour's wall
  // Built with the cross-section in (u, z) and extruded along v; rotate so the
  // extrusion axis (local z) becomes v and the section's y becomes world z.
  return root.add(reach).rotate([90, 0, 0])
}

/**
 * Cut one piece out of a whole bin and add its tabs. `bin` is the whole bin
 * (centred); W, D its outer track span; `piece` its span in mm from the bin's
 * −x / −y corner (see BinSpec.piece).
 */
export function binPiece(bin, W, D, units, piece, walls?) {
  const BIG = 1e3
  const topZ = binHeightMm(units)
  const outerW = W - 2 * CLR
  const outerD = D - 2 * CLR
  const seamX0 = piece.x0 > 1e-6
  const seamX1 = piece.x1 < W - 1e-6
  const seamY0 = piece.y0 > 1e-6
  const seamY1 = piece.y1 < D - 1e-6
  // The piece's window, in the bin's centred frame: a seam edge stops CLR short
  // of the cell line (like any bin edge); an outer edge takes everything.
  const x0 = seamX0 ? piece.x0 - W / 2 + CLR : -BIG
  const x1 = seamX1 ? piece.x1 - W / 2 - CLR : BIG
  const y0 = seamY0 ? piece.y0 - D / 2 + CLR : -BIG
  const y1 = seamY1 ? piece.y1 - D / 2 - CLR : BIG
  let out = bin.intersect(
    Manifold.cube([x1 - x0, y1 - y0, 2 * BIG], true).translate([(x0 + x1) / 2, (y0 + y1) / 2, 0]),
  )

  const baseMin = FLOOR_TOP + TAB_FLOOR_GAP
  const tabs = []

  // A face a tab rides along: its position on the cross axis, which way the open
  // space lies from it (`open`, ±1), the tab bands' floor, and the top of the
  // wall or divider it belongs to.
  //
  // For each band, which side of the seam owns it alternates — and alternates
  // again between the two faces of a pair (a bin's two outer walls, or a
  // divider's two faces), so the pieces' tabs interleave without colliding.
  const innerW = outerW - 2 * WALL
  const innerD = outerD - 2 * WALL
  const wallH = topZ - FLOOR_TOP
  const facePairs = (seamAxis) => {
    // Outer walls crossed by the seam: for a seam across x, the walls at ±y.
    const outerHalf = (seamAxis === 'x' ? outerD : outerW) / 2
    const pairs = [
      [-1, 1].map((side) => ({
        pos: side * (outerHalf - WALL),
        open: -side,
        zMin: baseMin,
        top: topZ,
      })),
    ]
    // Dividers running across the seam: 'h' walls for a seam across x (they run
    // along x), 'v' walls for a seam across y. Each is a pair of faces.
    for (const w of walls ?? []) {
      const runsAcross = seamAxis === 'x' ? w.dir === 'h' : w.dir === 'v'
      if (!runsAcross) continue
      const along = seamAxis === 'x' ? innerW : innerD
      const acrossSpan = seamAxis === 'x' ? innerD : innerW
      const c = along * (w.center - 0.5)
      const len = along * w.flen
      const sPos = seamAxis === 'x' ? sxs : sys
      if (!sPos.some((s0) => dividerCrosses(c, len, s0))) continue
      const at = acrossSpan * (w.across - 0.5)
      const top = FLOOR_TOP + Math.min(1, w.fh ?? 1) * wallH // tabs stop below its top
      pairs.push(
        [-1, 1].map((side) => ({ pos: at + (side * DIVIDER_SEAM_T) / 2, open: side, zMin: baseMin, top })),
      )
    }
    return pairs
  }
  const sxs = [seamX0 ? piece.x0 - W / 2 : null, seamX1 ? piece.x1 - W / 2 : null].filter((v) => v != null)
  const sys = [seamY0 ? piece.y0 - D / 2 : null, seamY1 ? piece.y1 - D / 2 : null].filter((v) => v != null)

  // The piece's own span across a seam (bin-centred mm), on the axis its faces
  // sit along. A face outside it — the bin's far outer wall, or a divider, beyond
  // this piece's other seam — isn't part of the piece, so it gets no tabs (they'd
  // float free of the piece).
  const crossSpan = (seamAxis) =>
    seamAxis === 'x'
      ? [piece.y0 - D / 2, piece.y1 - D / 2]
      : [piece.x0 - W / 2, piece.x1 - W / 2]
  const addTabs = (seamAxis, sPos, low) => {
    const [c0, c1] = crossSpan(seamAxis)
    for (const pair of facePairs(seamAxis)) {
      // `k` stays the face's place in its pair, so mating pieces interleave.
      pair.forEach((face, k) => {
        if (face.pos < c0 || face.pos > c1) return
        tabBands(face.zMin, face.top).forEach(([z0, z1], i) => {
          const lowOwns = (i + k) % 2 === 0
          if (lowOwns !== low) return
          const uDir = low ? 1 : -1
          // tabSolid comes out with u along +x and v along −y: scale so u points at
          // the neighbour and v into the open space beside this face.
          let t = tabSolid(z0, z1).scale([uDir, -face.open, 1])
          if (seamAxis === 'x') tabs.push(t.translate([sPos, face.pos, 0]))
          else {
            // Swap x and y (rotate 90° then mirror x) so u runs along y, v along x.
            t = t.rotate([0, 0, 90]).scale([-1, 1, 1])
            tabs.push(t.translate([face.pos, sPos, 0]))
          }
        })
      })
    }
  }
  const seamAcrossX = (sx, low) => addTabs('x', sx, low)
  const seamAcrossY = (sy, low) => addTabs('y', sy, low)
  if (seamX0) seamAcrossX(piece.x0 - W / 2, false)
  if (seamX1) seamAcrossX(piece.x1 - W / 2, true)
  if (seamY0) seamAcrossY(piece.y0 - D / 2, false)
  if (seamY1) seamAcrossY(piece.y1 - D / 2, true)
  for (const t of tabs) out = out.add(t)
  return out
}

/**
 * Build many bins into one manifold, each centered at its (cxMm, cyMm). Callers
 * space the specs apart so the bins are disjoint, so this composes them (no
 * boolean) — fast and clean. A spec with a `piece` prints just that piece; the
 * pieces of one bin share a single build of the whole bin.
 */
export function buildBins(specs: BinSpec[]) {
  const whole = new Map()
  const bins = specs.map((s) => {
    if (!s.piece) return buildBin(s.colSizes, s.rowSizes, s.units, s.walls).translate([s.cxMm, s.cyMm, 0])
    let full = whole.get(s.piece.key)
    if (!full) {
      full = buildBin(s.colSizes, s.rowSizes, s.units, s.walls, s.piece.seams)
      whole.set(s.piece.key, full)
    }
    const W = s.colSizes.reduce((a, b) => a + b, 0)
    const D = s.rowSizes.reduce((a, b) => a + b, 0)
    return binPiece(full, W, D, s.units, s.piece, s.walls).translate([s.cxMm, s.cyMm, 0])
  })
  return bins.length === 1 ? bins[0] : Manifold.compose(bins)
}

// ---- STL export ----
/**
 * Merge coincident-position vertices and drop the resulting zero-area triangles.
 * manifold-3d's coplanar unions (the feet meeting the body wall) emit a handful
 * of duplicate-position vertices capped by degenerate slivers; welding them here
 * yields a mesh that is watertight and degenerate-free once STL drops the shared
 * index (STL is a triangle soup). Tolerance 1e-4 mm ≪ the 0.05 mm match budget.
 */
function weld(mesh) {
  const P = mesh.vertProperties, TV = mesh.triVerts
  const Q = 1e4
  const key = (i) => `${Math.round(P[i * 3] * Q)},${Math.round(P[i * 3 + 1] * Q)},${Math.round(P[i * 3 + 2] * Q)}`
  const canon = new Map()
  const remap = new Int32Array(mesh.numVert)
  for (let i = 0; i < mesh.numVert; i++) {
    const k = key(i)
    if (canon.has(k)) remap[i] = canon.get(k)
    else { canon.set(k, i); remap[i] = i }
  }
  const tris = []
  for (let t = 0; t < mesh.numTri; t++) {
    const a = remap[TV[t * 3]], b = remap[TV[t * 3 + 1]], c = remap[TV[t * 3 + 2]]
    if (a === b || b === c || a === c) continue
    tris.push([a, b, c])
  }
  return { pos: P, tris }
}

/** The same mesh as {@link manifoldToStl}, as binary STL — what downloads use. */
export function manifoldToBinaryStl(man, name = 'bin') {
  const { pos, tris } = weld(man.getMesh())
  return binaryStl(pos, tris.flat(), name)
}

export function manifoldToStl(man, name = 'bin') {
  const { pos, tris } = weld(man.getMesh())
  const lines = [`solid ${name}`]
  const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  for (const [ia, ib, ic] of tris) {
    const a = v(ia), b = v(ib), c = v(ic)
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
