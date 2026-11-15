import { defaults } from './defaults'
import { planSeams } from './baseplate'
import { GRID_MM, buildGrid, basePlateOpts, type GridModel } from './grid'

/** One full-height X band of the base plate and where it splits in Y. */
export interface SeamBand {
  /** Band's left/right edges in interior mm. */
  x0: number
  x1: number
  /** Y cell boundaries within this band, top-down (interior mm). */
  yEdges: number[]
}

/** Where the exported base plate splits, expressed in interior mm coordinates. */
export interface Seams {
  /** X band boundaries, left→right (length = bands + 1). */
  xEdges: number[]
  bands: SeamBand[]
  /** Number of printable base segments. */
  segmentCount: number
}

const EMPTY: Seams = { xEdges: [0], bands: [], segmentCount: 0 }

/**
 * Seam positions for an interior + print bed. The plate is driven by the
 * interior's exact tracks ({@link basePlateOpts}), so the drawn base lines up
 * cell-for-cell with the bins on {@link buildGrid}'s grid.
 */
export function baseSeams(
  placeWmm: number,
  placeDmm: number,
  bedWmm: number,
  bedDmm: number,
): Seams {
  if (!(placeWmm > 0) || !(placeDmm > 0) || !(bedWmm > 0) || !(bedDmm > 0)) return EMPTY
  try {
    const opts = basePlateOpts(buildGrid(placeWmm, placeDmm, 1, 'mm'))
    return planSeams([placeWmm, placeDmm], [bedWmm, bedDmm], opts) as Seams
  } catch {
    return EMPTY
  }
}

/** One printable base piece, as a rectangle in interior mm. */
export interface BaseSegment {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The printable pieces the base plate splits into, in interior mm. Empty for
 *  {@link EMPTY} seams — callers wanting a single full-plate piece supply their
 *  own fallback. */
export function baseSegments(seams: Seams): BaseSegment[] {
  return seams.bands.flatMap((band) =>
    band.yEdges.slice(0, -1).map((y0, j) => ({
      x0: band.x0,
      y0,
      x1: band.x1,
      y1: band.yEdges[j + 1],
    })),
  )
}

/**
 * The puzzle-connector head/neck size (mm), mirroring the base model's edge
 * connector ({@link EDGE_DIM}/{@link EDGE_DIM_C} in baseplate-core). Used to draw a
 * faithful little representation of each connector in the exploded plan view.
 */
export const CONNECTOR_DIM = {
  /** Head: length along the seam × how far it protrudes past the neck. */
  head: [10, 2.5] as const,
  /** Neck: length along the seam × how far it stands off the piece edge. */
  neck: [3, 1.2] as const,
}

/**
 * One puzzle connector on a printable base piece, in interior mm. It sits at a cell
 * boundary midpoint on the piece's edge; `edge` is which edge it belongs to and so
 * which way its (male) tab protrudes: `'E'` → right (+x), `'N'` → up/back (−y).
 */
export interface SeamConnector {
  x: number
  y: number
  edge: 'N' | 'E'
}

/**
 * Where a tab sits along each cell, from its cumulative track edges: where it would
 * on a standard 42 mm cell. A wide cell's extra runs off its far end — the right
 * for a column, the back (top, `fromEnd`) for a row — so the tab stays half a cell
 * from the cell's other gridline, as if the cell were exactly 42 mm. A cell
 * narrower than {@link defaults.connectorMin} gets no tab.
 */
function tabPositions(edgesMm: number[], fromEnd: boolean): number[] {
  const c: number[] = []
  for (let i = 0; i < edgesMm.length - 1; i++) {
    const size = edgesMm[i + 1] - edgesMm[i]
    if (size < defaults.connectorMin) continue // too thin for a tab
    const half = Math.min(size, GRID_MM) / 2
    c.push(fromEnd ? edgesMm[i + 1] - half : edgesMm[i] + half)
  }
  return c
}

/**
 * The male puzzle tabs to draw on each printable base piece, aligned index-for-index
 * with {@link baseSegments}. One tab sits at every cell boundary along a piece's
 * *interior* seam edges — matching the real base, where N/E edges carry the male tab
 * and S/W the female socket. Emitting only the male side (the piece's top `'N'` and
 * right `'E'` edges) gives exactly one tab per seam, from the piece that owns it;
 * the mating piece's female edge is left bare, so the split reads as interlocking.
 */
export function segmentConnectors(seams: Seams, grid: GridModel): SeamConnector[][] {
  const EPS = 0.5
  const xMax = seams.xEdges[seams.xEdges.length - 1]
  const colCenters = tabPositions(grid.colEdgesMm, false)
  const rowCenters = tabPositions(grid.rowEdgesMm, true)
  const out: SeamConnector[][] = []
  for (const band of seams.bands) {
    const bandTop = band.yEdges[0]
    for (let j = 0; j < band.yEdges.length - 1; j++) {
      const y0 = band.yEdges[j]
      const y1 = band.yEdges[j + 1]
      const cons: SeamConnector[] = []
      // Right (E) edge: male when another band sits to the right.
      if (band.x1 < xMax - EPS) {
        for (const cy of rowCenters) {
          if (cy > y0 + EPS && cy < y1 - EPS) cons.push({ x: band.x1, y: cy, edge: 'E' })
        }
      }
      // Top (N) edge: male when this slice has a piece above it within the band.
      if (y0 > bandTop + EPS) {
        for (const cx of colCenters) {
          if (cx > band.x0 + EPS && cx < band.x1 - EPS) cons.push({ x: cx, y: y0, edge: 'N' })
        }
      }
      out.push(cons)
    }
  }
  return out
}

/** A drawn seam line segment in interior mm. */
export interface SeamLine {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Interior seam lines to draw: full-height X splits + per-band Y splits. */
export function seamLines(seams: Seams, placeDmm: number): SeamLine[] {
  const lines: SeamLine[] = []
  // Vertical: interior X band boundaries, full depth.
  for (let i = 1; i < seams.xEdges.length - 1; i++) {
    lines.push({ x0: seams.xEdges[i], y0: 0, x1: seams.xEdges[i], y1: placeDmm })
  }
  // Horizontal: interior Y splits within each band.
  for (const band of seams.bands) {
    for (let j = 1; j < band.yEdges.length - 1; j++) {
      lines.push({ x0: band.x0, y0: band.yEdges[j], x1: band.x1, y1: band.yEdges[j] })
    }
  }
  return lines
}
