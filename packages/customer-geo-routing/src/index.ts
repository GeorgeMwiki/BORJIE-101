/**
 * `@borjie/customer-geo-routing` — public surface (Wave 18Z).
 *
 * Customer Geographic Routing + Scope-Login Selector:
 *
 *   geo/      — haversine distance + GeoJSON polygon containment +
 *               postal/administrative-code probes
 *   routing/  — district resolver, proximity scorer, override handlers
 *   scope/    — login-time scope picker contract, session-scope
 *               builder, mid-session scope-switch with binding-revocation
 *               check
 *   audit/    — hash-chain link factory routed through
 *               @borjie/audit-hash-chain
 *
 * Implements `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md`.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  AssignmentKind,
  AuthorityTier,
  CustomerDistrictAssignment,
  CustomerLocation,
  CustomerLocationSource,
  GeoJsonPolygon,
  GeoJsonPolygonRing,
  LatLng,
  OrgUnitServiceArea,
  ScopePickerInput,
  ScopePickerOption,
  ScopePickerOutcome,
  ServiceAreaKind,
  SessionScope,
  SessionScopeOrigin,
  UserBindingLike,
} from './types.js';

export {
  ASSIGNMENT_KINDS,
  AssignmentKindSchema,
  AUTHORITY_TIERS,
  CustomerLocationSchema,
  CustomerLocationSourceSchema,
  CustomerDistrictAssignmentSchema,
  GeoJsonPolygonSchema,
  LatLngSchema,
  LOCATION_SOURCES,
  OrgUnitServiceAreaSchema,
  SERVICE_AREA_KINDS,
  ServiceAreaKindSchema,
  SESSION_SCOPE_ORIGINS,
  SessionScopeSchema,
} from './types.js';

// ── Geo primitives ───────────────────────────────────────────────────
export { haversineKm } from './geo/haversine.js';
export { pointInPolygon } from './geo/polygon-contains.js';
export {
  administrativeCodeMatches,
  postalCodeMatches,
} from './geo/postal-code-mapper.js';

// ── Routing ──────────────────────────────────────────────────────────
export { resolveCustomerDistrict } from './routing/district-resolver.js';
export type { ResolveOptions } from './routing/district-resolver.js';
export {
  pickClosest,
  scoreCandidates,
} from './routing/proximity-scorer.js';
export type { ScoredCandidate } from './routing/proximity-scorer.js';
export {
  applyAdminOverride,
  applyCustomerOverride,
} from './routing/override-handler.js';
export type {
  AdminOverrideInput,
  CustomerOverrideInput,
} from './routing/override-handler.js';

// ── Scope ────────────────────────────────────────────────────────────
export { planScopePicker } from './scope/scope-picker-contract.js';
export type { ScopePickerArgs } from './scope/scope-picker-contract.js';
export { buildSessionScope } from './scope/session-scope-builder.js';
export type { BuildSessionScopeInput } from './scope/session-scope-builder.js';
export {
  ScopeSwitchDenied,
  switchScope,
} from './scope/scope-switcher-audit.js';
export type { SwitchScopeInput } from './scope/scope-switcher-audit.js';

// ── Audit ────────────────────────────────────────────────────────────
export { buildAuditLink } from './audit/audit-chain-link.js';
export type {
  LinkInput,
  LinkOutput,
} from './audit/audit-chain-link.js';
