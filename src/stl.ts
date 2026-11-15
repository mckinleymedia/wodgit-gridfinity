/**
 * Binary STL: an 80-byte header, a triangle count, then 50 bytes per triangle
 * (normal, three vertices, a spare 2-byte field). About a fifth the size of the
 * text form for the same mesh, and every slicer reads it.
 *
 * `pos` is x,y,z per vertex; `idx` is three vertex indices per triangle.
 */
export function binaryStl(pos: ArrayLike<number>, idx: ArrayLike<number>, name = 'wodgit'): Uint8Array<ArrayBuffer> {
  const n = Math.floor(idx.length / 3)
  const buf = new ArrayBuffer(84 + n * 50)
  const dv = new DataView(buf)
  // The header is free text; most slicers ignore it. Never start it with
  // "solid", which some readers take to mean the text format.
  const header = new TextEncoder().encode(`Wodgit ${name}`.slice(0, 80))
  new Uint8Array(buf, 0, header.length).set(header)
  dv.setUint32(80, n, true)
  let o = 84
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (const f of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      dv.setFloat32(o, f, true)
      o += 4
    }
    o += 2 // attribute byte count, unused
  }
  return new Uint8Array(buf)
}
