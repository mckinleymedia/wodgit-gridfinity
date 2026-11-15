/**
 * Wires a manifold-3d WASM instance into both geometry cores (bins and base
 * plates), and frees what each build makes.
 *
 * Load manifold once and share it: objects from two WASM instances live in
 * different memories, and mixing them fails with the emscripten error "null
 * function or function signature mismatch".
 *
 * Memory: every Manifold / CrossSection lives in the WASM heap, which JavaScript's
 * garbage collector never frees; each must be `delete()`d. A single build makes
 * thousands of intermediates, so instead of deleting each by hand, every object
 * made inside {@link withManifold} is tracked and freed when it returns.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import ManifoldModule from 'manifold-3d'
import { setApi as setBinApi } from './bin'
import { setApi as setBaseApi } from './baseplate'

let ready: Promise<void> | null = null
let wired = false

/**
 * Load manifold-3d (once) and wire it in. In Node no options are needed. In a
 * browser, pass `locateFile` so the WASM is found, e.g. with Vite:
 *
 *   import wasmUrl from 'manifold-3d/manifold.wasm?url'
 *   await loadManifold({ locateFile: () => wasmUrl })
 */
export function loadManifold(options?: { locateFile: () => string }): Promise<void> {
  if (!ready) ready = ManifoldModule(options).then(useManifold)
  return ready
}

/** Wire in a manifold-3d instance you loaded yourself. Call it once. */
export function useManifold(wasm: any): void {
  if (wired) return
  wired = true
  wasm.setup()
  track(wasm)
  setBinApi(wasm)
  setBaseApi(wasm)
}

/** Whether manifold has been wired in, so the generators can run. */
export function manifoldReady(): boolean {
  return wired
}

/** Objects made inside the current {@link withManifold} call, or null outside one. */
let live: any[] | null = null

/** Methods that don't make a new object (or manage an object's own lifetime). */
const UNTRACKED = new Set(['constructor', 'delete', 'deleteLater', 'isDeleted', 'isAliasOf', 'clone'])

/** Wrap every method and static of Manifold and CrossSection so whatever object
 *  (or array of objects) they return is recorded while a build is running. */
function track(wasm: any): void {
  const classes = [wasm.Manifold, wasm.CrossSection]
  const isGeom = (v: any) => classes.some((C) => v instanceof C)
  const record = (out: any) => {
    if (live) {
      if (isGeom(out)) live.push(out)
      else if (Array.isArray(out)) for (const v of out) if (isGeom(v)) live.push(v)
    }
    return out
  }
  const wrap = (owner: any, name: string) => {
    const fn = owner[name]
    if (typeof fn !== 'function' || UNTRACKED.has(name)) return
    owner[name] = function (this: any, ...args: any[]) {
      return record(fn.apply(this, args))
    }
  }
  // The exported classes are thin wrappers: instances inherit from the
  // underlying bound class, so wrap the prototype a real instance has.
  const samples = [wasm.Manifold.cube([1, 1, 1]), wasm.CrossSection.square([1, 1])]
  for (const s of samples) {
    const proto = Object.getPrototypeOf(s)
    for (const name of Object.getOwnPropertyNames(proto)) wrap(proto, name)
    s.delete()
  }
  for (const C of classes) {
    for (const name of Object.getOwnPropertyNames(C)) {
      if (!['length', 'name', 'prototype'].includes(name)) wrap(C, name)
    }
  }
}

/**
 * Run a geometry build and free every Manifold / CrossSection it made. `fn` must
 * return plain data (an STL, mesh arrays), never a Manifold, which is deleted on
 * the way out. Call after {@link loadManifold} or {@link useManifold}.
 */
export function withManifold<T>(fn: () => T): T {
  if (!wired) throw new Error('manifold-3d is not loaded: await loadManifold() first')
  const outer = live
  live = []
  const mine = live
  try {
    return fn()
  } finally {
    live = outer
    for (const obj of mine) {
      if (!obj.isDeleted?.()) obj.delete()
    }
  }
}
