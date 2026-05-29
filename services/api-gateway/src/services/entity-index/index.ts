/**
 * Entity-index service — public surface.
 *
 * Wave KNOWLEDGE-HANDOFF — K-B. The persona-aware entity-index query
 * layer that makes the same `entity.search` / `entity.resolve` query
 * return different rows + different fields under owner vs worker JWT.
 *
 * The query function itself (`queryEntityIndex`) is the unified entry
 * point for the brain tools + the route handlers. The persona filter
 * is applied both BEFORE the SQL (scope clip) and AFTER (financial
 * redaction + worker vocab rewrite).
 */

export {
  applyPersonaFilter,
  computePersonaProjection,
  ENTITY_INDEX_PERSONAS,
  type EntityIndexPersona,
  type EntityIndexRow,
  type PersonaFilterInput,
  type PersonaProjection,
} from './persona-filter.js';
export {
  queryEntityIndex,
  type QueryEntityIndexInput,
  type QueryEntityIndexResult,
  type EntityIndexQueryDb,
} from './query.js';
