# wodgit-gridfinity

Gridfinity base plates and bins sized to a space you measured, as printable STLs.

This is the geometry behind [Wodgit](https://wodgit.lab.mckinleymedia.com). It runs in the browser
or in Node on [manifold-3d](https://github.com/elalish/manifold), with no OpenSCAD.

- **Fits the real space.** Interiors are rarely a multiple of 42 mm. The leftover
  goes to the right column and the back row: 9 mm or more becomes its own
  narrower cell with a real foot, and anything smaller widens the edge cell.
  Bins on those edges stretch to fill them.
- **Fits your printer.** Base plates bigger than the bed split into segments
  joined with puzzle connectors. Bins too big for the bed split on cell lines.
- **Matches GridFlock.** Base plates and bins are checked against GridFlock's
  own exports to within 0.05 mm (see [Tests](#tests)).

## Install

```sh
npm install wodgit-gridfinity manifold-3d
```

## Use

```ts
import { writeFileSync } from 'node:fs'
import { loadManifold, buildGrid, baseplateStl, binsStl, GRID } from 'wodgit-gridfinity'

await loadManifold()

// A drawer 310 × 506 mm inside, 50 mm tall
const grid = buildGrid(310, 506, 50, 'mm')
grid.colWidthsMm // [42, 42, 42, 42, 42, 42, 42, 16]

const base = baseplateStl(310, 506, 250, 250) // interior, then print bed
writeFileSync('base.stl', base.stl)
base.segmentCount // pieces to print

const bins = binsStl([
  { colSizes: [GRID, GRID], rowSizes: [GRID], units: 6, cxMm: 0, cyMm: 0 },
])
writeFileSync('bins.stl', bins)
```

In a browser, tell manifold where its WASM is. With Vite:

```ts
import wasmUrl from 'manifold-3d/manifold.wasm?url'
await loadManifold({ locateFile: () => wasmUrl })
```

If you already load manifold-3d yourself, pass that instance to
`useManifold(wasm)` instead. Share one instance: objects from two instances
can't be mixed.

### What's in it

| Module | What it does |
| --- | --- |
| `buildGrid`, `fitGrid` | Splits an interior into 42 mm tracks plus edge tracks |
| `baseplateStl`, `buildPlate`, `planPlate` | Base plates, split to the bed with connectors |
| `binsStl`, `buildBin`, `buildBins` | Bins on any tracks, with optional walls and pieces |
| `binCuts`, `binPieces`, `maxPieceCells` | Where a bin too big for the bed is cut |
| `baseSeams`, `segmentConnectors` | Where the base plate splits, in interior mm |
| `withManifold` | Runs a build and frees every WASM object it made |

Units are millimetres. Solids are centered on the origin in X/Y and sit on Z=0.

## Tests

```sh
npm test          # unit tests
npm run regression  # compare generated STLs to GridFlock exports (needs python3, numpy, trimesh)
```

## License

MIT. Gridfinity is Zack Freedman's design. The base plate is a port of
[GridFlock](https://github.com/yawkat/GridFlock) and
[gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad);
see [NOTICE.md](NOTICE.md).
