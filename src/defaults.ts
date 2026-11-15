/**
 * Gridfinity defaults the geometry is built on. Everything here is a default:
 * the bed in particular is only the fallback when a caller doesn't pass one.
 */
export const defaults = {
  /** Gridfinity cell pitch (mm): one full cell. */
  grid: 42,

  /** Gridfinity height unit (mm): bins stack in whole units of this. */
  heightUnit: 7,

  /** Default print bed (mm), 250 × 250. Drives base-plate segmentation and where
   * bins too big for it are cut (the biggest bin piece on this bed is 6 × 5
   * cells; see cuts). */
  bed: { w: 250, d: 250 },

  /**
   * The smallest leftover (mm) that becomes its own edge cell. Once whole 42 mm
   * cells are placed, a leftover at least this big is a separate, narrower
   * column/row with a real foot a bin can fill; anything smaller is too thin to
   * print on its own, so it widens the edge cell instead (42 mm plus the
   * leftover).
   */
  flatMin: 9,

  /**
   * The narrowest cell (mm, along the seam) that gets a base puzzle connector.
   * A connector's 10 mm head needs room on each side, so a thinner edge cell's
   * stretch of the seam is left plain.
   */
  connectorMin: 21,
} as const
