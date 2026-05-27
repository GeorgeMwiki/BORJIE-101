import {
  createInMemorySessionStore,
  getActivePersona,
  setActivePersona,
  validateBindingTierCompatibility,
  BUILT_IN_PERSONAS,
  type ActivePersonaSessionStore,
  type BuiltInPersonaSpec,
  type PowerTier
} from '@borjie/persona-runtime'

const sessionStore: ActivePersonaSessionStore = createInMemorySessionStore()

export function ownerPersonaSpec(): BuiltInPersonaSpec {
  const spec = BUILT_IN_PERSONAS.find((p) => p.slug === 'T1_owner_strategist')
  if (!spec) {
    throw new Error('T1_owner_strategist not found in BUILT_IN_PERSONAS')
  }
  return spec
}

export async function readActiveOwnerPersona(sessionId: string): Promise<string | null> {
  return getActivePersona({ sessionId, sessionStore })
}

export async function bindOwnerPersona(sessionId: string, personaId: string): Promise<void> {
  await setActivePersona({ sessionId, personaId, sessionStore })
}

export function assertOwnerCanBind(titleTier: PowerTier, personaTier: PowerTier): void {
  const verdict = validateBindingTierCompatibility({ titleTier, personaTier })
  if (!verdict.allowed) {
    throw new Error(`persona binding rejected: ${verdict.reason ?? 'tier mismatch'}`)
  }
}
