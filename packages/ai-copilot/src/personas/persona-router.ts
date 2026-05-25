/**
 * Borjie Primary Persona Router.
 *
 * Deterministic: portal -> persona. No LLM classification. O(1) lookup.
 * The persona adapts internally based on context injection + sub-persona
 * layering (see sub-persona-router).
 */

import {
  PORTAL_PERSONA_MAP,
  type BossnyumbaPersonaId,
  type PortalId,
  type BossnyumbaPersona,
} from './persona-types.js';
import { createManagerChat } from './manager-chat.js';
import { createCoworker } from './coworker.js';
import { createTenantAssistant } from './tenant-assistant.js';
import { createOwnerAdvisor } from './owner-advisor.js';
import { createBossnyumbaStudio } from './borjie-studio.js';
import { createPublicGuide } from './public-guide.js';

// ============================================================================
// Persona Factory Table
// ============================================================================

const personaFactories: Readonly<Record<BossnyumbaPersonaId, () => BossnyumbaPersona>> = {
  'manager-chat': createManagerChat,
  coworker: createCoworker,
  'tenant-assistant': createTenantAssistant,
  'owner-advisor': createOwnerAdvisor,
  'borjie-studio': createBossnyumbaStudio,
  'public-guide': createPublicGuide,
};

// Cache personas (stateless, safe to reuse).
const personaCache = new Map<BossnyumbaPersonaId, BossnyumbaPersona>();

/**
 * Resolve the primary persona for a given portal.
 */
export function resolvePersona(portalId: PortalId): BossnyumbaPersona {
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
export function resolvePersonaById(personaId: BossnyumbaPersonaId): BossnyumbaPersona {
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
export function getRegisteredPersonas(): ReadonlyArray<BossnyumbaPersonaId> {
  return Object.keys(personaFactories) as BossnyumbaPersonaId[];
}

/**
 * Return all primary personae as immutable array.
 */
export function getAllPrimaryPersonae(): ReadonlyArray<BossnyumbaPersona> {
  return getRegisteredPersonas().map((id) => resolvePersonaById(id));
}
