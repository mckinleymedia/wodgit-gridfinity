/**
 * One-call STL generators. Each needs manifold loaded first
 * (`await loadManifold()`), then runs synchronously and frees its geometry.
 */
import { withManifold } from './manifold'
import { buildPlate, planPlate, manifoldToBinaryStl as plateStl } from './baseplate'
import { buildBins, manifoldToBinaryStl as binStl, type BinSpec } from './bin'
import { buildGrid, basePlateOpts } from './grid'

export interface BaseplateResult {
  /** Binary STL of the whole base plate (all bed-sized segments in one object). */
  stl: Uint8Array<ArrayBuffer>
  /** How many printable segments the plate was split into. */
  segmentCount: number
  /** Plate footprint used, in mm. */
  plateMm: [number, number]
}

/**
 * The gridfinity base plate for an interior, split into puzzle-jointed segments
 * that each fit the print bed. Its grid matches {@link buildGrid}'s: the
 * leftover goes to the right column and back row.
 * @param placeWmm interior width (mm)
 * @param placeDmm interior depth (mm)
 * @param bedWmm print bed width (mm)
 * @param bedDmm print bed depth (mm)
 */
export function baseplateStl(
  placeWmm: number,
  placeDmm: number,
  bedWmm: number,
  bedDmm: number,
  name = 'baseplate',
): BaseplateResult {
  const plate: [number, number] = [placeWmm, placeDmm]
  const bed: [number, number] = [bedWmm, bedDmm]
  const opts = basePlateOpts(buildGrid(placeWmm, placeDmm, 1, 'mm'))
  return {
    stl: withManifold(() => plateStl(buildPlate(plate, bed, opts), name)),
    segmentCount: planPlate(plate, bed, opts).segments.length,
    plateMm: plate,
  }
}

/** One binary STL holding every bin in `specs`. */
export function binsStl(specs: BinSpec[], name = 'bins'): Uint8Array<ArrayBuffer> {
  return withManifold(() => binStl(buildBins(specs), name))
}
