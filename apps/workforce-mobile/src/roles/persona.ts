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

export type WorkforceRole = 'owner' | 'manager' | 'employee'

const ROLE_TO_PERSONA_SLUG: Record<WorkforceRole, string> = {
  owner: 'T1_owner_strategist',
  manager: 'T3_module_manager',
  employee: 'T4_field_employee'
}

export function workforcePersonaSpec(role: WorkforceRole): BuiltInPersonaSpec {
  const slug = ROLE_TO_PERSONA_SLUG[role]
  const spec = BUILT_IN_PERSONAS.find((p) => p.slug === slug)
  if (!spec) {
    throw new Error(`${slug} not found in BUILT_IN_PERSONAS`)
  }
  return spec
}

export async function readActiveWorkforcePersona(sessionId: string): Promise<string | null> {
  return getActivePersona({ sessionId, sessionStore })
}

export async function bindWorkforcePersona(sessionId: string, personaId: string): Promise<void> {
  await setActivePersona({ sessionId, personaId, sessionStore })
}

export function assertWorkforceCanBind(titleTier: PowerTier, personaTier: PowerTier): void {
  const verdict = validateBindingTierCompatibility({ titleTier, personaTier })
  if (!verdict.allowed) {
    throw new Error(`persona binding rejected: ${verdict.reason ?? 'tier mismatch'}`)
  }
}
