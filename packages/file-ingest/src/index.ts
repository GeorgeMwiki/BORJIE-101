/**
 * @borjie/file-ingest — Phase J2 conversational ingest pipeline.
 *
 * Re-exports the public surface for each sub-module. Detailed APIs live in
 * the per-module entry points (./entity-store, ./schema-sniff, ./proposal,
 * ./approval, ./provenance) so callers can import narrowly when they only
 * need one layer.
 */

export * from './entity-store/index.js';
export * from './schema-sniff/index.js';
export * from './proposal/index.js';
export * from './approval/index.js';
export * from './provenance/index.js';
