/**
 * Persona binding resolver.
 *
 * Two responsibilities:
 *
 *   1. `resolveDefaultPersonaForUser(userId, tenantId, port)` — picks
 *      the persona the brain adopts when the user opens a session
 *      WITHOUT explicit selection. Strategy:
 *         a. Look for a binding flagged `isDefault: true`.
 *         b. If none, fall back to the binding with the LOWEST power
 *            tier (most authoritative). Ties broken by createdAt ASC.
 *         c. If the user has no bindings at all, return `null`.
 *
 *   2. `setActivePersona(sessionId, personaId, sessionStore)` — writes
 *      the active persona into a session store. The store is provided
 *      by the caller so this module stays I/O free for tests.
 *
 *   3. `validateBindingTierCompatibility({ titleTier, personaTier })` —
 *      enforces the rule that a binding cannot give a user MORE power
 *      than their title implies. A CUSTOMER (T5) title cannot bind to
 *      a T1 owner persona. Returns a verdict; the caller decides
 *      whether to throw or surface a UI error.
 */

import type { Persona, PersonaBinding, PowerTier } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Ports — provided by the caller (DB adapter, in-memory test double).
// ─────────────────────────────────────────────────────────────────────

export interface PersonaBindingPort {
  listBindingsForUser(args: {
    readonly userId: string;
    readonly tenantId: string;
  }): Promise<ReadonlyArray<PersonaBinding>>;

  getPersonaById(args: {
    readonly tenantId: string;
    readonly personaId: string;
  }): Promise<Persona | null>;
}

export interface ActivePersonaSessionStore {
  setActive(args: {
    readonly sessionId: string;
    readonly personaId: string;
  }): Promise<void>;

  getActive(args: { readonly sessionId: string }): Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────

export interface ResolvedDefaultPersona {
  readonly persona: Persona;
  readonly binding: PersonaBinding;
}

/**
 * Resolve the default persona for (user, tenant). Returns null when the
 * user has no bindings.
 */
export async function resolveDefaultPersonaForUser(args: {
  readonly userId: string;
  readonly tenantId: string;
  readonly port: PersonaBindingPort;
}): Promise<ResolvedDefaultPersona | null> {
  const bindings = await args.port.listBindingsForUser({
    userId: args.userId,
    tenantId: args.tenantId,
  });
  if (bindings.length === 0) return null;

  // (a) explicit default.
  const explicit = bindings.find((b) => b.isDefault === true);
  if (explicit) {
    const persona = await args.port.getPersonaById({
      tenantId: args.tenantId,
      personaId: explicit.personaId,
    });
    if (persona) return { persona, binding: explicit };
  }

  // (b) lowest power tier wins; ties → earliest createdAt.
  const sorted = [...bindings].sort((a, b) => {
    // Resolve personas to read their tier. We do this lazily — only
    // when (a) failed — by fetching personas in parallel.
    return (
      compareCreatedAt(a.createdAt, b.createdAt)
    );
  });

  // Fetch all personas for the bindings, then pick the lowest tier.
  const personas = await Promise.all(
    sorted.map((b) =>
      args.port.getPersonaById({
        tenantId: args.tenantId,
        personaId: b.personaId,
      }),
    ),
  );

  let best: ResolvedDefaultPersona | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const p = personas[i];
    const b = sorted[i];
    if (!p || !b) continue;
    if (!best) {
      best = { persona: p, binding: b };
      continue;
    }
    if (p.powerTier < best.persona.powerTier) {
      best = { persona: p, binding: b };
    } else if (
      p.powerTier === best.persona.powerTier &&
      compareCreatedAt(b.createdAt, best.binding.createdAt) < 0
    ) {
      best = { persona: p, binding: b };
    }
  }

  return best;
}

function compareCreatedAt(a: Date | undefined, b: Date | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.getTime() - b.getTime();
}

/**
 * Write the active persona id into the session store. Pure delegation;
 * exists so the rest of the codebase has one canonical entry point.
 */
export async function setActivePersona(args: {
  readonly sessionId: string;
  readonly personaId: string;
  readonly sessionStore: ActivePersonaSessionStore;
}): Promise<void> {
  await args.sessionStore.setActive({
    sessionId: args.sessionId,
    personaId: args.personaId,
  });
}

/**
 * Get the active persona id for a session, or null if none was set.
 */
export async function getActivePersona(args: {
  readonly sessionId: string;
  readonly sessionStore: ActivePersonaSessionStore;
}): Promise<string | null> {
  return args.sessionStore.getActive({ sessionId: args.sessionId });
}

// ─────────────────────────────────────────────────────────────────────
// Binding-tier compatibility check
// ─────────────────────────────────────────────────────────────────────

export interface BindingTierVerdict {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * A user's persona cannot be MORE powerful than their title.
 * Recall: power_tier 1 = most power; 5 = least.
 * So `personaTier >= titleTier` is required (lower-numbered persona
 * means stronger). Equality is allowed (matched tier).
 */
export function validateBindingTierCompatibility(args: {
  readonly titleTier: PowerTier;
  readonly personaTier: PowerTier;
}): BindingTierVerdict {
  if (args.personaTier >= args.titleTier) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `persona tier ${args.personaTier} is stronger than title tier ${args.titleTier}; binding would elevate the user's power`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory session store — tests + dev.
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure in-memory implementation for tests and the dev composition
 * root. Production replaces with a Redis adapter.
 */
export function createInMemorySessionStore(): ActivePersonaSessionStore {
  const map = new Map<string, string>();
  return {
    async setActive({ sessionId, personaId }) {
      map.set(sessionId, personaId);
    },
    async getActive({ sessionId }) {
      return map.get(sessionId) ?? null;
    },
  };
}
