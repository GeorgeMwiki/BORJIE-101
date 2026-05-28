import {
  createInMemorySessionStore,
  getActivePersona,
  setActivePersona,
  validateBindingTierCompatibility,
  BUILT_IN_PERSONAS,
  type ActivePersonaSessionStore,
  type BuiltInPersonaSpec,
  type PowerTier,
  type WorkforceRoleId
} from '@borjie/persona-runtime'

const sessionStore: ActivePersonaSessionStore = createInMemorySessionStore()

export type WorkforceRole = 'owner' | 'manager' | 'employee'

const ROLE_TO_PERSONA_SLUG: Record<WorkforceRole, string> = {
  owner: 'T1_owner_strategist',
  manager: 'T3_module_manager',
  employee: 'T4_field_employee'
}

/**
 * Eight-role mining mapping — used by HomeChat when the workforce
 * tab-config returns one of the 8 fine-grained roles. Mr. Mwikila is
 * the persona face across all of them; the slug captures the role
 * context so the brain routes tools + tone.
 */
const WORKFORCE_ROLE_ID_TO_PERSONA_SLUG: Record<WorkforceRoleId, string> = {
  owner: 'T1_owner_strategist',
  manager: 'T1_manager_dispatch',
  supervisor: 'T1_supervisor_shift',
  pit_operator: 'T1_pit_operator',
  geologist: 'T1_geologist',
  treasury: 'T1_treasury_clerk',
  safety_officer: 'T1_safety_officer',
  compliance_clerk: 'T1_compliance_clerk'
}

export function workforcePersonaSpec(role: WorkforceRole): BuiltInPersonaSpec {
  const slug = ROLE_TO_PERSONA_SLUG[role]
  const spec = BUILT_IN_PERSONAS.find((p) => p.slug === slug)
  if (!spec) {
    throw new Error(`${slug} not found in BUILT_IN_PERSONAS`)
  }
  return spec
}

/**
 * Map a fine-grained WorkforceRoleId to its persona slug. Falls back
 * to the safe supervisor persona when the role is unknown — Mr.
 * Mwikila is reachable from every workforce surface.
 */
export function roleIdToPersona(roleId: WorkforceRoleId | undefined): string {
  if (!roleId) return 'T1_supervisor_shift'
  return (
    WORKFORCE_ROLE_ID_TO_PERSONA_SLUG[roleId] ?? 'T1_supervisor_shift'
  )
}

/**
 * Best-effort widening from the legacy 3-value Role plus the 8-value
 * tab-config role. When the tab-config has hydrated, prefer its role;
 * otherwise widen the legacy role via a safe default (manager → manager,
 * owner → owner, employee → pit_operator).
 */
export function resolveWorkforcePersona(args: {
  readonly tabConfigRole: WorkforceRoleId | undefined
  readonly legacyRole: WorkforceRole | undefined
}): string {
  if (args.tabConfigRole) {
    return roleIdToPersona(args.tabConfigRole)
  }
  if (args.legacyRole === 'owner') return 'T1_owner_strategist'
  if (args.legacyRole === 'manager') return 'T1_manager_dispatch'
  return 'T1_supervisor_shift'
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
