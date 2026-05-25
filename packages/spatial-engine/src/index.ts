/**
 * @borjie/spatial-engine — public entrypoint (pure-logic surface).
 *
 * Muzima spatial parcel engine. See
 * `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md` for the
 * full spec, and the per-module file headers for the rationale.
 *
 * **Root entrypoint = pure logic only** (types, color-coding, geometry,
 * snap-to-building). Node consumers (parcel-service, brain workers,
 * agents) import from here without a JSX toolchain.
 *
 * React components live under `./components/*` and are exported via
 * the SEPARATE `@borjie/spatial-engine/react` subpath (see
 * `package.json:exports."./react"`). Next.js consumers should import
 * from `@borjie/spatial-engine/react` inside a `'use client'`
 * file or with `dynamic(() => import(...), { ssr: false })`.
 *
 * 2026-05-24: split out the React re-exports so the root entrypoint
 * type-checks under non-JSX TS configs (closes the parcel-service
 * `_spatial-engine-shim` workaround).
 */

export * from './types.js';
export * from './color-coding.js';
export * from './geometry.js';
export * from './snap-to-building.js';
