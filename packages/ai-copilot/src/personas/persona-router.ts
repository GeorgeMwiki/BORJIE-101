/**
 * Borjie Primary Persona Router.
 *
 * Deterministic: portal -> persona. No LLM classification. O(1) lookup.
 * The persona adapts internally based on context injection + sub-persona
 * layering (see sub-persona-router).
 */

import {
  PORTAL_PERSONA_MAP,
  type BorjiePersonaId,
  type PortalId,
  type BorjiePersona,
} from './persona-types.js';
import { createManagerChat } from './manager-chat.js';
import { createCoworker } from './coworker.js';
import { createTenantAssistant } from './tenant-assistant.js';
import { createOwnerAdvisor } from './owner-advisor.js';
import { createBorjieStudio } from './borjie-studio.js';
import { createPublicGuide } from './public-guide.js';

// ============================================================================
// Persona Factory Table
// ============================================================================

/**
 * Defense-in-depth: persona factories MUST return stateless persona
 * objects.
 *
 * **INVARIANT**: every factory in this table is required to return a
 * `BorjiePersona` whose fields capture only IDENTITY (id, displayName,
 * portalId, systemPrompt, availableTools, communicationStyle) and never
 * close over per-request state — user id, session id, tenant id,
 * conversation history, locale-of-the-moment, or any other request-scoped
 * data.
 *
 * Why this matters: the router caches each persona by `personaId` and
 * reuses the SAME object across every caller for the lifetime of the
 * worker. A persona that captured session data would leak that data into
 * the next caller's prompt — a cross-tenant disclosure bug.
 *
 * Per-request context (locale, route, user metadata, sub-persona layering)
 * is injected as a separate context block downstream, AFTER the persona's
 * `systemPrompt` is read. The persona itself never sees that data and never
 * stores it.
 *
 * Adding a new persona: keep the factory pure. No `new Date()`. No
 * `process.env`. No reading from caches. No closures that capture
 * arguments — the factory takes none.
 */
const personaFactories: Readonly<Record<BorjiePersonaId, () => BorjiePersona>> = {
  'manager-chat': createManagerChat,
  coworker: createCoworker,
  'counterparty-assistant': createTenantAssistant,
  'owner-advisor': createOwnerAdvisor,
  'borjie-studio': createBorjieStudio,
  'public-guide': createPublicGuide,
};

// Cache personas (stateless — the factory invariant above is what makes
// this cache safe to share across requests, threads, and users).
const personaCache = new Map<BorjiePersonaId, BorjiePersona>();

/** Fields that legitimately live on a `BorjiePersona` (identity only). */
const ALLOWED_PERSONA_KEYS: ReadonlySet<string> = new Set([
  'id',
  'displayName',
  'portalId',
  'systemPrompt',
  'availableTools',
  'communicationStyle',
]);

// Token shapes that must never appear in a persona's identity surface: a
// factory that baked a user id / JWT / session id into the system prompt
// would trip these.
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/;
const SESSION_RE = /\b(?:session|sid|sess)[_-]?id[=:]\s*\S+/i;

/**
 * Dev-only runtime assertion that a persona returned by a factory does not
 * carry user-scoped state.
 *
 * We check the persona's enumerable own-property surface — if any field is
 * outside the identity allow-list, or any identity string contains a value
 * that looks like a per-request identifier (UUID, JWT, session id), we
 * throw immediately so the regression surfaces in dev BEFORE the persona is
 * cached and leaks into the next caller's prompt.
 *
 * Disabled in production by an early return so the hot path stays
 * branch-free. The factory invariant is the canonical defence; this is a
 * backstop for accidental drift.
 */
function assertStatelessInDev(persona: BorjiePersona): void {
  if (process.env.NODE_ENV === 'production') return;

  for (const key of Object.keys(persona)) {
    if (!ALLOWED_PERSONA_KEYS.has(key)) {
      throw new Error(
        `[persona-router] persona '${persona.id}' carries unexpected field '${key}' — personaFactories must return stateless persona objects. See assertStatelessInDev in persona-router.ts.`,
      );
    }
  }

  const identityStrings: ReadonlyArray<unknown> = [
    persona.id,
    persona.displayName,
    persona.systemPrompt,
  ];
  for (const value of identityStrings) {
    if (typeof value !== 'string') continue;
    if (UUID_RE.test(value) || JWT_RE.test(value) || SESSION_RE.test(value)) {
      throw new Error(
        `[persona-router] persona '${persona.id}' contains a request-scoped identifier in its identity surface. Per-request data must be injected as a separate context block, not baked into the persona. See assertStatelessInDev in persona-router.ts.`,
      );
    }
  }
}

/**
 * Build a persona via its factory, run the dev-only statelessness guard,
 * then cache it. Both `resolvePersona` and `resolvePersonaById` funnel
 * through here so the guard fires the first time ANY path builds a persona,
 * catching drift before the shared cache is poisoned.
 */
function buildAndCachePersona(
  personaId: BorjiePersonaId,
  factory: () => BorjiePersona,
): BorjiePersona {
  const persona = factory();
  assertStatelessInDev(persona);
  personaCache.set(personaId, persona);
  return persona;
}

/**
 * Resolve the primary persona for a given portal.
 */
export function resolvePersona(portalId: PortalId): BorjiePersona {
  const personaId = PORTAL_PERSONA_MAP[portalId];
  if (!personaId) {
    throw new Error(`resolvePersona: unknown portal "${portalId}"`);
  }
  const cached = personaCache.get(personaId);
  if (cached) return cached;
  return buildAndCachePersona(personaId, personaFactories[personaId]);
}

/**
 * Resolve a primary persona by its id directly (useful for tests and the
 * orchestrator's forcePersonaId path).
 */
export function resolvePersonaById(personaId: BorjiePersonaId): BorjiePersona {
  const factory = personaFactories[personaId];
  if (!factory) {
    throw new Error(`resolvePersonaById: unknown persona "${personaId}"`);
  }
  const cached = personaCache.get(personaId);
  if (cached) return cached;
  return buildAndCachePersona(personaId, factory);
}

/**
 * Return all registered primary persona ids.
 */
export function getRegisteredPersonas(): ReadonlyArray<BorjiePersonaId> {
  return Object.keys(personaFactories) as BorjiePersonaId[];
}

/**
 * Return all primary personae as immutable array.
 */
export function getAllPrimaryPersonae(): ReadonlyArray<BorjiePersona> {
  return getRegisteredPersonas().map((id) => resolvePersonaById(id));
}
