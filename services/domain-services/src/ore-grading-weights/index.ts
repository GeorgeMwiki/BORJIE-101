/**
 * Ore-grading weights module — Borjie mining.
 *
 * Replaces the property-domain `property-grading/drizzle-weights-
 * repository.ts` with mining-domain equivalent: per-tenant weights for
 * composing the headline grade of an ore parcel from its raw assay
 * dimensions (grade %, processability, tonnage, deleterious penalty,
 * logistics, confidence).
 */

export * from './types.js';
export * from './drizzle-ore-grading-weights-repository.js';
