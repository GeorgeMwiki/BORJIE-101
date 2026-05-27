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

const personaFactories: Readonly<Record<BorjiePersonaId, () => BorjiePersona>> = {
  'manager-chat': createManagerChat,
  coworker: createCoworker,
  'tenant-assistant': createTenantAssistant,
  'owner-advisor': createOwnerAdvisor,
  'borjie-studio': createBorjieStudio,
  'public-guide': createPublicGuide,
};

// Cache personas (stateless, safe to reuse).
const personaCache = new Map<BorjiePersonaId, BorjiePersona>();

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
  const factory = personaFactories[personaId];
  const persona = factory();
  personaCache.set(personaId, persona);
  return persona;
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
  const persona = factory();
  personaCache.set(personaId, persona);
  return persona;
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
