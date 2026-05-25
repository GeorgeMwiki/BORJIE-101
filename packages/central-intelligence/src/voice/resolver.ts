/**
 * VoiceResolver — maps a ScopeContext to the first-person voice
 * binding used in the system prompt.
 *
 * For tenants, the voice is the tenant's pinned head persona
 * (mr-mwikila-head by default). For the platform, the voice is an
 * "industry-observer" persona with institutional, cross-tenant
 * framing and no first-person-singular-as-the-business wording.
 */

import type { ScopeContext, VoiceBinding } from '../types.js';

export interface VoicePersonaSource {
  /** Return a minimal VoiceBinding for the requested persona. The
   *  source MAY query voice-persona-dna at runtime; the in-memory
   *  default below returns hard-coded canonical bindings. */
  bindingFor(personaId: string): Promise<VoiceBinding | null>;
}

export function createDefaultVoiceResolver(
  source: VoicePersonaSource = createInMemoryVoicePersonaSource(),
): { resolve(ctx: ScopeContext): Promise<VoiceBinding> } {
  return {
    async resolve(ctx: ScopeContext): Promise<VoiceBinding> {
      const binding = await source.bindingFor(ctx.personaId);
      if (binding) return binding;
      // Fall back to the canonical default for the scope kind so the
      // agent never runs with an empty voice.
      return ctx.kind === 'tenant'
        ? DEFAULT_TENANT_BINDING
        : DEFAULT_PLATFORM_BINDING;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Canonical built-ins. Production deploys override via a persona
// source that reads from voice-persona-dna.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_TENANT_BINDING: VoiceBinding = Object.freeze({
  personaId: 'mr-mwikila-head',
  displayName: 'The estate',
  openingStatement:
    'I am the estate itself. When the operator speaks to me, it is the entire operation — the leases, the units, the tenants, the vendors, the cash — speaking back.',
  toneGuidance:
    'Calm. Precise. Institutional. First-person singular. Data-first; opinion only when asked. Never salesy, never cheerful without cause. A senior operator with 30 years on the job.',
  taboos: Object.freeze([
    "I'm just an AI",
    'as a large language model',
    'according to my training data',
    'hopefully',
    'just checking in',
  ]),
});

export const DEFAULT_PLATFORM_BINDING: VoiceBinding = Object.freeze({
  personaId: 'industry-observer',
  displayName: 'The industry',
  openingStatement:
    'I am the industry observer. I sit above every tenant on the network. I see only aggregates — never a single tenant, never a single unit, never a single name. My statements are statistical, my confidence is honest.',
  toneGuidance:
    'Measured. Cross-sectional. Plural or observer pronoun ("we see", "across the network"). Never prescriptive — describe the pattern, let the operator decide. Cite privacy-protected aggregates always.',
  taboos: Object.freeze([
    "I know your tenant",
    'a specific landlord',
    'this particular operator',
    'revealing',
    'identifying',
  ]),
});

export function createInMemoryVoicePersonaSource(
  extras: ReadonlyArray<VoiceBinding> = [],
): VoicePersonaSource {
  const bindings = new Map<string, VoiceBinding>();
  bindings.set(DEFAULT_TENANT_BINDING.personaId, DEFAULT_TENANT_BINDING);
  bindings.set(DEFAULT_PLATFORM_BINDING.personaId, DEFAULT_PLATFORM_BINDING);
  for (const e of extras) bindings.set(e.personaId, e);
  return {
    async bindingFor(personaId: string): Promise<VoiceBinding | null> {
      return bindings.get(personaId) ?? null;
    },
  };
}
