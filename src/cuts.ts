import { defaults } from './defaults'
import type { GridModel } from './grid'

/**
 * Cuts: where a bin too big for the print bed is split into pieces that print
 * separately and join with tabs. A cut always falls on a cell line, so every
 * piece still sits on whole grid cells.
 *
 * The rules:
 *  - A bin that fits the bed has no cuts. One that grows too big splits on its
 *    own, as evenly as it can into as few pieces as possible.
 *  - The user can move a cut (stored on the bin as `cuts`). A moved cut sticks
 *    while every piece still fits; otherwise the bin falls back to the even
 *    split.
 *  - A bin that shrinks back to fitting re-joins: its cuts are ignored.
 */

/** The parts of a placed bin the cut planner reads: its cell position and size,
 *  and any cuts the user moved by hand (cells from its left / top edge). */
export interface CutBin {
  x: number
  y: number
  w: number
  d: number
  cuts?: { x: number[]; y: number[] }
}

/** Cut positions within a bin, in whole cells from its left / top edge. */
export interface BinCuts {
  x: number[]
  y: number[]
}

export const NO_CUTS: BinCuts = { x: [], y: [] }

/**
 * The size (mm) of each cell a bin covers: its columns left→right and rows
 * top→bottom. Mostly 42 mm, but a bin on the right column or back row covers
 * that edge's wide cell, so it needs more bed.
 */
export interface BinTracks {
  x: number[]
  y: number[]
}

/** The cells under a bin on the grid. */
export function binTracks(t: Pick<CutBin, 'x' | 'y' | 'w' | 'd'>, grid: GridModel): BinTracks {
  return {
    x: Array.from({ length: t.w }, (_, i) => grid.colWidthsMm[t.x + i] ?? defaults.grid),
    y: Array.from({ length: t.d }, (_, j) => grid.rowDepthsMm[t.y + j] ?? defaults.grid),
  }
}

/** Every cell a standard 42 mm — for a bin with no grid to measure against. */
function standardTracks(w: number, d: number): BinTracks {
  return { x: Array(w).fill(defaults.grid), y: Array(d).fill(defaults.grid) }
}

/** Total mm of cells [a, b) along one axis. */
function spanMm(tracks: number[], a: number, b: number): number {
  let s = 0
  for (let i = a; i < b; i++) s += tracks[i]
  return s
}

/** Grace (mm) past the bed edge, so a 6-cell run (~251 mm) still fits a 250 mm bed. */
const BED_GRACE = 2
/** A bin's footprint is its cells less 0.31 mm clearance each side (bin-core CLR). */
const BIN_CLEARANCE = 0.62
/**
 * How far a piece's tabs reach past each of its seams (bin-core: 2·CLR + TAB_REACH).
 * Every piece has tabs across every seam it has, so this counts toward its size.
 */
export const TAB_OVERHANG = 0.62 + 3.5

/**
 * The biggest piece the bed takes, in cells: [long side, short side]. As many
 * whole cells as fit each way, but never a square at the maximum — on a 250 ×
 * 250 bed that's 6 × 5, not 6 × 6, which leaves room to get it on and off.
 */
export function maxPieceCells(bed: { w: number; d: number } = defaults.bed): [number, number] {
  const a = Math.max(1, Math.floor((bed.w + BED_GRACE) / defaults.grid))
  const b = Math.max(1, Math.floor((bed.d + BED_GRACE) / defaults.grid))
  const long = Math.max(a, b)
  const short = Math.min(a, b)
  return [long, long === short ? Math.max(1, short - 1) : short]
}

/**
 * Whether a w × d cell piece fits the bed, either way round. `spanW` / `spanD`
 * are its cells' total mm (more than w × 42 when it covers a wide edge cell).
 * `seamsW` / `seamsD` count its seams on each axis: the tabs reaching past them
 * add to its length, so a piece cut on an axis may need to be a cell shorter
 * along it.
 */
export function pieceFits(
  w: number,
  d: number,
  max: [number, number],
  bed: { w: number; d: number },
  seamsW = 0,
  seamsD = 0,
  spanW = w * defaults.grid,
  spanD = d * defaults.grid,
): boolean {
  const [long, short] = max
  const longMm = Math.max(bed.w, bed.d) + BED_GRACE
  const shortMm = Math.min(bed.w, bed.d) + BED_GRACE
  const wMm = spanW - BIN_CLEARANCE + seamsW * TAB_OVERHANG
  const dMm = spanD - BIN_CLEARANCE + seamsD * TAB_OVERHANG
  return (
    (w <= long && d <= short && wMm <= longMm && dMm <= shortMm) ||
    (w <= short && d <= long && wMm <= shortMm && dMm <= longMm)
  )
}

/** Piece sizes (cells) along one axis for a list of cut positions. */
function spans(n: number, cuts: number[]): number[] {
  const edges = [0, ...cuts, n]
  return edges.slice(1).map((e, i) => e - edges[i])
}

/** How many seams each piece along an axis has (0 for an uncut axis, else 1 or 2). */
function seamCounts(k: number): number[] {
  return Array.from({ length: k }, (_, i) => (i > 0 ? 1 : 0) + (i < k - 1 ? 1 : 0))
}

/** Whether every piece made by these cuts fits the bed, tabs included. */
export function cutsFit(
  w: number,
  d: number,
  cuts: BinCuts,
  max: [number, number],
  bed: { w: number; d: number },
  tracks: BinTracks = standardTracks(w, d),
): boolean {
  const xe = [0, ...cuts.x, w]
  const ye = [0, ...cuts.y, d]
  const sx = seamCounts(xe.length - 1)
  const sy = seamCounts(ye.length - 1)
  return xe.slice(1).every((x1, i) =>
    ye.slice(1).every((y1, j) =>
      pieceFits(
        x1 - xe[i],
        y1 - ye[j],
        max,
        bed,
        sx[i],
        sy[j],
        spanMm(tracks.x, xe[i], x1),
        spanMm(tracks.y, ye[j], y1),
      ),
    ),
  )
}

/** Cut positions that split n cells into k pieces as evenly as possible. */
function evenCuts(n: number, k: number): number[] {
  const out: number[] = []
  let at = 0
  for (let i = 0; i < k - 1; i++) {
    at += Math.floor(n / k) + (i < n % k ? 1 : 0)
    out.push(at)
  }
  return out
}

/** The even split: fewest pieces, then fewest seams, then the most even pieces. */
export function autoCuts(
  w: number,
  d: number,
  max: [number, number],
  bed: { w: number; d: number },
  tracks: BinTracks = standardTracks(w, d),
): BinCuts {
  let best: { cuts: BinCuts; pieces: number; seams: number; smallest: number } | null = null
  for (let kx = 1; kx <= w; kx++) {
    for (let ky = 1; ky <= d; ky++) {
      const cuts = { x: evenCuts(w, kx), y: evenCuts(d, ky) }
      if (!cutsFit(w, d, cuts, max, bed, tracks)) continue
      const pieces = kx * ky
      const seams = kx - 1 + (ky - 1)
      const smallest = Math.min(...spans(w, cuts.x)) * Math.min(...spans(d, cuts.y))
      if (
        !best ||
        pieces < best.pieces ||
        (pieces === best.pieces && (seams < best.seams || (seams === best.seams && smallest > best.smallest)))
      )
        best = { cuts, pieces, seams, smallest }
    }
  }
  return best?.cuts ?? NO_CUTS
}

/** Whether stored cuts are well-formed for a w × d bin (in range, ascending). */
function wellFormed(n: number, cuts: number[] | undefined): cuts is number[] {
  return (
    Array.isArray(cuts) &&
    cuts.every((c, i) => Number.isInteger(c) && c > 0 && c < n && (i === 0 || c > cuts[i - 1]))
  )
}

/** Whether a bin on these cells prints whole on the bed — no cuts needed. */
export function fitsBed(tracks: BinTracks, bed: { w: number; d: number }): boolean {
  return cutsFit(tracks.x.length, tracks.y.length, NO_CUTS, maxPieceCells(bed), bed, tracks)
}

/** The cuts a bin actually gets: none if it fits, the user's if they work, else the
 * even split. `tracks` are the cells under it ({@link binTracks}); omitted, all 42 mm. */
export function binCuts(
  t: Pick<CutBin, 'w' | 'd' | 'cuts'>,
  bed: { w: number; d: number },
  tracks: BinTracks = standardTracks(t.w, t.d),
): BinCuts {
  const max = maxPieceCells(bed)
  if (cutsFit(t.w, t.d, NO_CUTS, max, bed, tracks)) return NO_CUTS
  const mine = t.cuts
  if (mine && wellFormed(t.w, mine.x) && wellFormed(t.d, mine.y)) {
    const cuts = { x: mine.x, y: mine.y }
    if (cutsFit(t.w, t.d, cuts, max, bed, tracks)) return cuts
  }
  return autoCuts(t.w, t.d, max, bed, tracks)
}

/**
 * Move one cut to a new cell line. Returns the new cuts, or null if that would
 * leave a piece that doesn't fit (or collide with another cut).
 */
export function moveCut(
  t: Pick<CutBin, 'w' | 'd' | 'cuts'>,
  bed: { w: number; d: number },
  axis: 'x' | 'y',
  index: number,
  to: number,
  tracks: BinTracks = standardTracks(t.w, t.d),
): BinCuts | null {
  const current = binCuts(t, bed, tracks)
  const list = [...current[axis]]
  if (index < 0 || index >= list.length) return null
  list[index] = to
  const next = { ...current, [axis]: list }
  const n = axis === 'x' ? t.w : t.d
  if (!wellFormed(n, list)) return null
  return cutsFit(t.w, t.d, next, maxPieceCells(bed), bed, tracks) ? next : null
}

/** The pieces a bin prints as, in cells relative to the bin: x, y, w, d. */
export function binPieces(
  t: Pick<CutBin, 'w' | 'd' | 'cuts'>,
  bed: { w: number; d: number },
  tracks: BinTracks = standardTracks(t.w, t.d),
) {
  const cuts = binCuts(t, bed, tracks)
  const xEdges = [0, ...cuts.x, t.w]
  const yEdges = [0, ...cuts.y, t.d]
  const out: { x: number; y: number; w: number; d: number }[] = []
  for (let j = 0; j < yEdges.length - 1; j++)
    for (let i = 0; i < xEdges.length - 1; i++)
      out.push({ x: xEdges[i], y: yEdges[j], w: xEdges[i + 1] - xEdges[i], d: yEdges[j + 1] - yEdges[j] })
  return out
}
