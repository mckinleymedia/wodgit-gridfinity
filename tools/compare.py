#!/usr/bin/env python3
"""
Geometry-based comparison of two STL meshes (reference vs generated).

Reports:
  - vertex / triangle counts
  - bounding-box dimensions and min/max corner
  - watertightness, winding consistency, connected components
  - volume, surface area
  - bidirectional surface deviation (max / mean / p95 / p99) via point sampling
  - degenerate faces

Alignment: both meshes are assumed to be in the same coordinate frame
(GridFlock centers plates at the origin, and our exporter will match that).
An optional --align flag runs ICP as a safety net.

Exit code 0 if PASS (within tolerances), 1 otherwise.
"""
import argparse
import json
import sys
import numpy as np
import trimesh


def load(path):
    m = trimesh.load(path, force='mesh')
    m.merge_vertices()
    return m


def sample_surface(mesh, n):
    pts, _ = trimesh.sample.sample_surface(mesh, n)
    return pts


def surface_deviation(a, b, n=200000):
    """Bidirectional nearest-surface distance between meshes a and b."""
    pa = sample_surface(a, n)
    pb = sample_surface(b, n)
    # distance from points on A to surface B, and vice versa
    _, da, _ = trimesh.proximity.closest_point(b, pa)
    _, db, _ = trimesh.proximity.closest_point(a, pb)
    d = np.concatenate([da, db])
    return {
        'max': float(d.max()),
        'mean': float(d.mean()),
        'p95': float(np.percentile(d, 95)),
        'p99': float(np.percentile(d, 99)),
        'a_to_b_max': float(da.max()),
        'b_to_a_max': float(db.max()),
    }


def basic(mesh):
    lo, hi = mesh.bounds
    comps = mesh.split(only_watertight=False)
    tri = mesh.triangles
    # degenerate = zero-area
    areas = trimesh.triangles.area(tri)
    degen = int(np.sum(areas < 1e-9))
    return {
        'vertices': int(len(mesh.vertices)),
        'faces': int(len(mesh.faces)),
        'bbox_min': [round(float(x), 4) for x in lo],
        'bbox_max': [round(float(x), 4) for x in hi],
        'extents': [round(float(x), 4) for x in mesh.extents],
        'watertight': bool(mesh.is_watertight),
        'winding_consistent': bool(mesh.is_winding_consistent),
        'components': int(len(comps)),
        'volume': round(float(mesh.volume), 3),
        'area': round(float(mesh.area), 3),
        'degenerate_faces': degen,
    }


def compare(ref_path, gen_path, tol=0.05, samples=200000, do_align=False):
    ref = load(ref_path)
    gen = load(gen_path)

    if do_align:
        matrix, _, _ = trimesh.registration.icp(
            gen.vertices, ref, max_iterations=50)
        gen.apply_transform(matrix)

    r = basic(ref)
    g = basic(gen)
    dev = surface_deviation(ref, gen, samples)

    ext_diff = [abs(a - b) for a, b in zip(r['extents'], g['extents'])]
    bbmin_diff = [abs(a - b) for a, b in zip(r['bbox_min'], g['bbox_min'])]
    bbmax_diff = [abs(a - b) for a, b in zip(r['bbox_max'], g['bbox_max'])]

    checks = {
        'extent_match': max(ext_diff) <= tol,
        'bbox_min_match': max(bbmin_diff) <= tol,
        'bbox_max_match': max(bbmax_diff) <= tol,
        'surface_dev_p99': dev['p99'] <= tol,
        'surface_dev_max': dev['max'] <= max(tol * 10, 0.5),  # allow spikes at triangulation seams
        'gen_watertight': g['watertight'],
        'no_degenerate': g['degenerate_faces'] == 0,
        'volume_close': abs(r['volume'] - g['volume']) <= max(0.01 * r['volume'], 50),
    }
    passed = all(checks.values())

    result = {
        'ref': ref_path,
        'gen': gen_path,
        'tolerance_mm': tol,
        'reference': r,
        'generated': g,
        'extent_diff': [round(x, 4) for x in ext_diff],
        'bbox_min_diff': [round(x, 4) for x in bbmin_diff],
        'bbox_max_diff': [round(x, 4) for x in bbmax_diff],
        'surface_deviation_mm': {k: round(v, 4) for k, v in dev.items()},
        'checks': checks,
        'PASS': passed,
    }
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ref')
    ap.add_argument('gen')
    ap.add_argument('--tol', type=float, default=0.05)
    ap.add_argument('--samples', type=int, default=200000)
    ap.add_argument('--align', action='store_true')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    res = compare(args.ref, args.gen, args.tol, args.samples, args.align)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        r, g = res['reference'], res['generated']
        print(f"REF {args.ref}")
        print(f"GEN {args.gen}")
        print(f"{'':22}{'reference':>18}{'generated':>18}")
        for k in ['vertices', 'faces', 'extents', 'bbox_min', 'bbox_max',
                  'watertight', 'winding_consistent', 'components', 'volume',
                  'area', 'degenerate_faces']:
            print(f"  {k:20}{str(r[k]):>18}{str(g[k]):>18}")
        print(f"  extent_diff        {res['extent_diff']}")
        print(f"  bbox_min_diff      {res['bbox_min_diff']}")
        print(f"  bbox_max_diff      {res['bbox_max_diff']}")
        print(f"  surface_dev(mm)    {res['surface_deviation_mm']}")
        print("  checks:")
        for k, v in res['checks'].items():
            print(f"    {'OK ' if v else 'XX '} {k}: {v}")
        print(f"\n  {'PASS' if res['PASS'] else 'FAIL'}")
    sys.exit(0 if res['PASS'] else 1)


if __name__ == '__main__':
    main()
