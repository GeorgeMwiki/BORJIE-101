/**
 * @borjie/geo-parcels — Piece N barrel.
 *
 * Walk-and-capture land areas, subdivide into parcels on a map,
 * colour/tag/annotate each parcel, attach title-deed evidence,
 * publish to a cross-tenant marketplace where other tenants browse +
 * transact.
 *
 * The package is pure TypeScript — no I/O. All persistence is done
 * via the `GeoParcelsPort` interface. Adapters live in
 * `services/api-gateway` (Drizzle/PostgreSQL) where RLS is enforced.
 *
 * Spatial validation is done locally via simple Cartesian polygon
 * maths (`polygon-math.ts`); PostGIS re-validates on insert through
 * `ST_Within` / `ST_Intersects` for defence-in-depth.
 */

export * from './types.js';
export * from './polygon-math.js';
export * from './persistence-port.js';
export * from './activity-log.js';
export * from './land-area-capture.js';
export * from './subdivide.js';
export * from './metadata.js';
export * from './evidence.js';
export * from './marketplace.js';
