/**
 * Gridfinity domain core — framework-agnostic, pure functions, unit-testable.
 *
 * Gridfinity is a modular storage standard: everything is built on a 42 mm grid.
 * Baseplates tile the interior in 42 mm cells; bins occupy a whole number of cells
 * (1x1, 2x1, 3x2, …) and stack in 7 mm height units ("U").
 *
 * This module intentionally has zero React/DOM dependencies so the layout math
 * can be tested in isolation and reused for both the on-screen preview and the
 * print/manufacturing export.
 */

import { defaults } from './defaults'

export const GRID_MM = defaults.grid // one gridfinity cell, in millimetres
export const HEIGHT_UNIT_MM = defaults.heightUnit // one gridfinity height unit ("U"), in millimetres

export type Unit = 'mm' | 'in' | 'grids'

const MM_PER_INCH = 25.4

/**
 * Which way a dimension runs. It only matters in `grids`, where the standard
 * uses two different modules: 42 mm cells across the plan, but 7 mm units up.
 * "3 grids" wide is 126 mm; "3 grids" tall is 21 mm.
 */
export type Axis = 'plan' | 'height'

/** Millimetres per one input unit, for the given axis. */
function mmPerUnit(unit: Unit, axis: Axis): number {
  if (unit === 'in') return MM_PER_INCH
  if (unit === 'grids') return axis === 'height' ? HEIGHT_UNIT_MM : GRID_MM
  return 1
}

export function toMm(value: number, unit: Unit, axis: Axis = 'plan'): number {
  return value * mmPerUnit(unit, axis)
}

export function fromMm(mm: number, unit: Unit, axis: Axis = 'plan'): number {
  return mm / mmPerUnit(unit, axis)
}

/**
 * How a typed measurement moves in each unit: mm and grids in whole numbers,
 * inches fluid. `inputStep` is the number input's `step`; `snapToUnit` is what a
 * typed value becomes (whole for mm / grids, as typed for inches).
 */
export function inputStep(unit: Unit): number | 'any' {
  return unit === 'in' ? 'any' : 1
}
export function snapToUnit(value: number, unit: Unit): number {
  return unit === 'in' ? value : Math.round(value)
}

/** Round a converted dimension to a sensible precision for its unit. */
export function roundForUnit(value: number, unit: Unit): number {
  return unit === 'mm' ? Math.round(value) : Math.round(value * 100) / 100
}

/**
 * Re-express a width/depth/height triple in another unit.
 *
 * Switching units restates the same interior — it doesn't relabel the numbers.
 * A 300 mm interior shown in inches is 11.81", not "300 inches". Height converts
 * on the height module, so a 50 mm interior is ~7.14 grids tall, not ~1.19.
 */
export function convertDims<
  T extends { width: number; depth: number; height: number; unit: Unit },
>(d: T, unit: Unit): T {
  if (unit === d.unit) return d
  const to = (v: number, axis: Axis) =>
    roundForUnit(fromMm(toMm(v, d.unit, axis), unit, axis), unit)
  return {
    ...d,
    unit,
    width: to(d.width, 'plan'),
    depth: to(d.depth, 'plan'),
    height: to(d.height, 'height'),
  }
}

/**
 * A length in every unit, for a tooltip under its name: "49 mm · 7 grids ·
 * 1.93 in". Height grids are 7 mm units; `grids` overrides the count where the
 * mm include something the units don't (a bin's base).
 */
export function unitConversions(mm: number, axis: Axis = 'plan', grids?: number): string {
  const g = grids ?? roundForUnit(fromMm(mm, 'grids', axis), 'grids')
  const inches = roundForUnit(fromMm(mm, 'in'), 'in')
  return `${Math.round(mm)} mm · ${g} ${g === 1 ? 'grid' : 'grids'} · ${inches} in`
}

/**
 * Where a row of lengths (width × depth × height) says its units, so each is
 * said once: after a shown number, unless the next shown number has the same
 * unit. A length drawn as an icon (it fits the drawer) needs none.
 */
export function unitSlots(items: { unit: Unit; shown: boolean }[]): boolean[] {
  return items.map((it, i) => {
    if (!it.shown) return false
    const next = items.slice(i + 1).find((n) => n.shown)
    return !next || next.unit !== it.unit
  })
}

/** Short label for a unit, e.g. for input suffixes. */
export const UNIT_LABEL: Record<Unit, string> = {
  mm: 'mm',
  in: 'in',
  grids: 'grids',
}

/** A unit's full name, for a tooltip on its short label (none when the label is
 *  already the word). */
export const UNIT_NAME: Record<Unit, string | undefined> = {
  mm: 'millimeters',
  in: 'inches',
  grids: undefined,
}

export interface GridDimensions {
  /** Whole 42 mm cells that fit across the width. */
  cols: number
  /** Whole 42 mm cells that fit across the depth. */
  rows: number
  /** Leftover width not covered by full cells, in mm (needs a spacer). */
  gapX: number
  /** Leftover depth not covered by full cells, in mm (needs a spacer). */
  gapY: number
  /** Whole 7 mm height units of usable clearance. */
  heightUnits: number
}

/**
 * Given an interior's dimensions (in mm), compute how many gridfinity
 * cells fit and what filler gap remains on each axis.
 */
export function fitGrid(widthMm: number, depthMm: number, heightMm: number): GridDimensions {
  const cols = Math.max(0, Math.floor(widthMm / GRID_MM))
  const rows = Math.max(0, Math.floor(depthMm / GRID_MM))
  return {
    cols,
    rows,
    gapX: widthMm - cols * GRID_MM,
    gapY: depthMm - rows * GRID_MM,
    heightUnits: Math.max(1, Math.floor(heightMm / HEIGHT_UNIT_MM)),
  }
}

/**
 * An interior's grid as tracks. Real interiors aren't divisible by 42 mm, so the
 * right column and the back row take the leftover: a leftover of at least
 * {@link defaults.flatMin} is its own narrower EDGE cell, while a smaller one
 * (too thin to print alone) widens the edge cell to 42 mm plus the leftover. The
 * left column and front row are always standard. Every cell is a socket a bin
 * plugs into, and every bin edge has the same wall.
 */
export interface GridModel {
  /** At least one full cell fits on each axis. */
  ok: boolean
  widthMm: number
  depthMm: number
  /** The interior's measured height, in mm. */
  heightMm: number
  heightUnits: number
  /** Whole cells across / deep (a wide edge cell counts as one; a narrow edge cell doesn't). */
  fullCols: number
  fullRows: number
  /** Track counts, a narrow edge cell included. */
  nCols: number
  nRows: number
  /** Width/depth of each track in mm (the edge track is wider or narrower than 42). */
  colWidthsMm: number[]
  rowDepthsMm: number[]
  /** Cumulative mm edges, length n+1, for positioning. */
  colEdgesMm: number[]
  rowEdgesMm: number[]
  /** The leftover beyond whole 42 mm cells, held in the edge track — its far
   *  (right) end for the column, its back (top) end for the row — or 0 if the
   *  axis divides cleanly. */
  extraColMm: number
  extraRowMm: number
  /** Track index of the edge column (the last, right) / row (the first, back), or -1 if none. */
  edgeColIndex: number
  edgeRowIndex: number
}

/**
 * Split a length into 42 mm tracks plus the leftover (rounded to whole mm). A
 * leftover of at least {@link defaults.flatMin} is its own edge track; a smaller
 * one widens the edge 42 mm track. `edgeFirst` puts it at track 0 (rows: the
 * back, drawn at the top) rather than the end (columns: the right edge), so the
 * left column and front row stay standard. A length under one cell is a single
 * short track.
 */
function tracks(
  totalMm: number,
  edgeFirst: boolean,
): { sizes: number[]; full: number; extra: number; edgeIndex: number } {
  const full = Math.max(0, Math.floor(totalMm / GRID_MM))
  const extra = Math.round(totalMm - full * GRID_MM)
  if (full === 0) return { sizes: extra > 0 ? [extra] : [], full, extra: 0, edgeIndex: -1 }
  const sizes = Array<number>(full).fill(GRID_MM)
  if (extra <= 0) return { sizes, full, extra: 0, edgeIndex: -1 }
  if (extra >= defaults.flatMin) {
    if (edgeFirst) sizes.unshift(extra)
    else sizes.push(extra)
  } else sizes[edgeFirst ? 0 : full - 1] += extra
  return { sizes, full, extra, edgeIndex: edgeFirst ? 0 : sizes.length - 1 }
}

function edges(sizes: number[]): number[] {
  const e = [0]
  for (const s of sizes) e.push(e[e.length - 1] + s)
  return e
}

/** Build the grid model for an interior (dimensions in `unit`). */
export function buildGrid(width: number, depth: number, height: number, unit: Unit): GridModel {
  const widthMm = toMm(width, unit)
  const depthMm = toMm(depth, unit)
  const heightMm = toMm(height, unit, 'height')
  // Columns: the leftover is at the right edge. Rows: at the back (row 0, drawn at the top).
  const c = tracks(widthMm, false)
  const r = tracks(depthMm, true)
  return {
    ok: c.full >= 1 && r.full >= 1,
    widthMm,
    depthMm,
    heightMm,
    heightUnits: Math.max(1, Math.floor(heightMm / HEIGHT_UNIT_MM)),
    fullCols: c.full,
    fullRows: r.full,
    nCols: c.sizes.length,
    nRows: r.sizes.length,
    colWidthsMm: c.sizes,
    rowDepthsMm: r.sizes,
    colEdgesMm: edges(c.sizes),
    rowEdgesMm: edges(r.sizes),
    extraColMm: c.extra,
    extraRowMm: r.extra,
    edgeColIndex: c.edgeIndex,
    edgeRowIndex: r.edgeIndex,
  }
}

/**
 * The canonical render origin: the center of the always-standard bottom-left
 * cell, in interior mm (top-left frame). The leftover is always taken by the
 * right column and the back row, so the bottom-left cell is a 42 mm cell in a
 * fixed place — this point does not move as the interior resizes, and it
 * coincides with a baseplate socket center. Consumers subtract it to work in a
 * bottom-left-anchored frame. (A one-column or one-row interior's only cell is
 * wide; its center then sits at the cell's own middle on that axis.)
 */
export function anchorMm(g: GridModel): { x: number; y: number } {
  return { x: GRID_MM / 2, y: g.depthMm - GRID_MM / 2 }
}

/**
 * Base-plate planner options (for baseplate-core's planPlate/buildPlate/planSeams)
 * that make the plate match this grid: one socket per track, the wide edge
 * sockets included, bottom-left aligned. The Y tracks reverse because the app
 * keeps the wide row first (top/back) while the base's trace runs front→back
 * (+Y at the end). Any sub-mm rounding left over becomes solid padding on the
 * right/back.
 */
export function basePlateOpts(g: GridModel): {
  globalTrace: [number[], number[]]
  alignment: [number, number]
} {
  return {
    globalTrace: [
      g.colWidthsMm.map((mm) => mm / GRID_MM),
      [...g.rowDepthsMm].reverse().map((mm) => mm / GRID_MM),
    ],
    alignment: [0, 0],
  }
}
