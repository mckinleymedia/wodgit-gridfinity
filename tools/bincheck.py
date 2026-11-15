#!/usr/bin/env python3
"""Reference-free sanity check for a generated bin STL.

Usage: python3 tools/bincheck.py <bin.stl>

Verifies the mesh is watertight, single-component, has correct outward normals,
and no degenerate faces — the mesh-quality half of the success criteria that
does not need a reference. Exits non-zero on failure.
"""
import sys
import numpy as np
import trimesh

def main():
    p = sys.argv[1]
    m = trimesh.load(p, process=True)
    m.merge_vertices()
    tri = m.triangles
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    degen = int((area < 1e-9).sum())
    checks = {
        "watertight": bool(m.is_watertight),
        "single_component": m.body_count == 1,
        "winding_consistent": bool(m.is_winding_consistent),
        "outward_normals": bool(m.is_winding_consistent and m.volume > 0),
        "no_degenerate": degen == 0,
        "on_bed_z0": abs(m.bounds[0][2]) < 1e-3,
    }
    ok = all(checks.values())
    print(f"  {p}: extents {m.extents.round(3).tolist()} vol {m.volume:.1f} faces {len(m.faces)}")
    for k, v in checks.items():
        print(f"     [{'PASS' if v else 'FAIL'}] {k}")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
