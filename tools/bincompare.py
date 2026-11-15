#!/usr/bin/env python3
"""Geometry-based STL comparison for gridfinity bins.

Usage: python3 tools/bincompare.py <generated.stl> <reference.stl> [--json out.json]

Compares two meshes that may be triangulated/ordered differently but should
describe the same shape. Reports bounding box, volume/area, watertightness,
manifoldness, degenerate faces, components, and bidirectional surface deviation
(max / mean / p95 / p99) via dense point sampling. Exits 0 iff success criteria
are met.
"""
import sys, json
import numpy as np
import trimesh

TOL = 0.05  # mm — success threshold for dims & surface deviation

def load(p):
    # process=True merges coincident vertices (needed for watertight/component/
    # euler checks) without moving any geometry.
    m = trimesh.load(p, process=True)
    if isinstance(m, trimesh.Scene):
        m = trimesh.util.concatenate(tuple(m.geometry.values()))
    m.merge_vertices()
    return m

def surface_dev(a, b, n=200000):
    """Bidirectional point-to-surface distance a<->b. Returns dict of stats.

    The raw max is reported but is NOT used as the gate: trimesh's closest_point
    occasionally returns a spurious large distance for a single sampled point
    (the 'invalid value in divide' warning), which would make pass/fail flaky.
    The gate keys on the 99.9th percentile plus the fraction of points that
    genuinely exceed the tolerance — real deviations show up as a population, a
    numerical glitch as one-in-a-million. This matches the success criterion of
    'below 0.05 mm except for insignificant triangulation differences'."""
    pa = a.sample(n)
    pb = b.sample(n)
    _, da, _ = trimesh.proximity.closest_point(b, pa)  # a-points to b-surface
    _, db, _ = trimesh.proximity.closest_point(a, pb)  # b-points to a-surface
    d = np.concatenate([da, db])
    return {
        "max": float(d.max()),
        "mean": float(d.mean()),
        "p99": float(np.percentile(d, 99)),
        "p99_9": float(np.percentile(d, 99.9)),
        "frac_over_tol": float((d > TOL).mean()),
        "n_over_tol": int((d > TOL).sum()),
        "samples": int(len(d)),
    }

def degenerate_count(m):
    tri = m.triangles
    # area via cross product
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = 0.5 * np.linalg.norm(cross, axis=1)
    return int((area < 1e-9).sum())

def report(m):
    return {
        "faces": len(m.faces),
        "verts": len(m.vertices),
        "bounds": m.bounds.tolist(),
        "extents": m.extents.tolist(),
        "volume": float(m.volume),
        "area": float(m.area),
        "watertight": bool(m.is_watertight),
        "winding_consistent": bool(m.is_winding_consistent),
        "components": int(m.body_count),
        "euler": int(m.euler_number),
        "degenerate": degenerate_count(m),
    }

def main():
    gen_p, ref_p = sys.argv[1], sys.argv[2]
    out_json = None
    if "--json" in sys.argv:
        out_json = sys.argv[sys.argv.index("--json") + 1]

    gen, ref = load(gen_p), load(ref_p)
    G, R = report(gen), report(ref)
    dev = surface_dev(gen, ref)

    ext_diff = [abs(a - b) for a, b in zip(G["extents"], R["extents"])]
    bounds_diff = np.abs(np.array(G["bounds"]) - np.array(R["bounds"])).max()

    checks = {
        "extents_match_.05": max(ext_diff) <= TOL,
        "bounds_match_.05": bounds_diff <= TOL,
        # p99.9 within tol AND genuine exceedances are a negligible fraction
        # (< 0.005%), i.e. only isolated numerical glitches, not a real surface.
        "surface_dev_.05": dev["p99_9"] <= TOL and dev["frac_over_tol"] < 5e-5,
        "gen_watertight": G["watertight"],
        "ref_watertight": R["watertight"],
        "gen_winding_ok": G["winding_consistent"],
        "gen_single_component": G["components"] == 1,
        "gen_no_degenerate": G["degenerate"] == 0,
        "volume_within_1pct": abs(G["volume"] - R["volume"]) / R["volume"] <= 0.01,
    }
    checks = {k: bool(v) for k, v in checks.items()}  # coerce numpy bools for JSON
    ok = all(checks.values())

    result = {
        "generated": gen_p, "reference": ref_p,
        "gen": G, "ref": R,
        "extent_diff": ext_diff, "bounds_max_diff": float(bounds_diff),
        "surface_deviation": dev, "checks": checks, "pass": ok,
    }

    print(f"=== {gen_p}  vs  {ref_p} ===")
    print(f"  extents  gen {fmt(G['extents'])}  ref {fmt(R['extents'])}  Δ {fmt(ext_diff)}")
    print(f"  bounds max Δ:      {bounds_diff:.4f} mm")
    print(f"  volume   gen {G['volume']:.1f}  ref {R['volume']:.1f}  Δ {abs(G['volume']-R['volume']):.1f} ({100*abs(G['volume']-R['volume'])/R['volume']:.2f}%)")
    print(f"  area     gen {G['area']:.1f}  ref {R['area']:.1f}")
    print(f"  surface dev: max {dev['max']:.4f}  mean {dev['mean']:.4f}  p99 {dev['p99']:.4f}  p99.9 {dev['p99_9']:.4f}  over-tol {dev['n_over_tol']}/{dev['samples']} ({100*dev['frac_over_tol']:.4f}%)")
    print(f"  gen: watertight={G['watertight']} winding={G['winding_consistent']} comps={G['components']} degen={G['degenerate']} euler={G['euler']} faces={G['faces']}")
    print(f"  ref: watertight={R['watertight']} comps={R['components']} euler={R['euler']} faces={R['faces']}")
    print("  checks:")
    for k, v in checks.items():
        print(f"     [{'PASS' if v else 'FAIL'}] {k}")
    print(f"  ==> {'PASS' if ok else 'FAIL'}")

    if out_json:
        with open(out_json, "w") as f:
            json.dump(result, f, indent=2)
    sys.exit(0 if ok else 1)

def fmt(a):
    return "[" + ", ".join(f"{x:.3f}" for x in a) + "]"

if __name__ == "__main__":
    main()
