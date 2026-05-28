/**
 * Workforce Tab Catalog — Wave WORKFORCE-FIXED-TABS.
 *
 * Single source of truth for the FIXED tab set on workforce-mobile and
 * buyer-mobile. The workforce-mobile tab bar is server-driven: at
 * runtime the app fetches `/api/v1/workforce/tab-config` and renders
 * the returned subset of these ids in returned order. There is NO
 * dynamic spawning on the workforce surface — that is owner-cockpit
 * only.
 *
 * Roles:
 *   owner | manager | supervisor | pit_operator | geologist | treasury |
 *   safety_officer | compliance_clerk
 *
 * The 'chat' tab uses the special role marker '*' (every role). It is
 * a HARD CONSTRAINT that the owner can never disable it — Mr. Mwikila
 * (the MD persona on workforce-mobile) must always be reachable.
 *
 * Labels are bilingual sw/en per the Borjie hard rule.
 */

export type WorkforceRoleId =
  | 'owner'
  | 'manager'
  | 'supervisor'
  | 'pit_operator'
  | 'geologist'
  | 'treasury'
  | 'safety_officer'
  | 'compliance_clerk';

export const WORKFORCE_ROLE_IDS: ReadonlyArray<WorkforceRoleId> = [
  'owner',
  'manager',
  'supervisor',
  'pit_operator',
  'geologist',
  'treasury',
  'safety_officer',
  'compliance_clerk',
] as const;

export interface WorkforceTabSpec {
  readonly id: string;
  /** `*` means every role. */
  readonly roles: ReadonlyArray<WorkforceRoleId | '*'>;
  readonly label: { readonly en: string; readonly sw: string };
}

export const WORKFORCE_TAB_CATALOG: ReadonlyArray<WorkforceTabSpec> = [
  {
    id: 'shift',
    roles: ['supervisor', 'pit_operator'],
    label: { en: 'Shift', sw: 'Zamu' },
  },
  {
    id: 'tasks',
    roles: ['supervisor', 'pit_operator', 'geologist'],
    label: { en: 'Tasks', sw: 'Kazi' },
  },
  {
    id: 'crew',
    roles: ['supervisor', 'manager'],
    label: { en: 'Crew', sw: 'Wafanyakazi' },
  },
  {
    id: 'dispatch',
    roles: ['manager'],
    label: { en: 'Dispatch', sw: 'Utumaji' },
  },
  {
    id: 'incidents',
    roles: ['supervisor', 'manager', 'safety_officer'],
    label: { en: 'Incidents', sw: 'Ajali' },
  },
  {
    id: 'drill-log',
    roles: ['geologist'],
    label: { en: 'Drill log', sw: 'Logi ya kuchimba' },
  },
  {
    id: 'assay',
    roles: ['geologist'],
    label: { en: 'Assay', sw: 'Uchunguzi' },
  },
  {
    id: 'treasury',
    roles: ['treasury', 'owner'],
    label: { en: 'Treasury', sw: 'Hazina' },
  },
  {
    id: 'compliance',
    roles: ['compliance_clerk', 'manager'],
    label: { en: 'Compliance', sw: 'Utii' },
  },
  {
    id: 'chat',
    roles: ['*'],
    label: { en: 'Mr. Mwikila', sw: 'Bw. Mwikila' },
  },
  {
    id: 'reports',
    roles: ['supervisor', 'manager', 'geologist'],
    label: { en: 'Reports', sw: 'Ripoti' },
  },
  {
    id: 'profile',
    roles: ['*'],
    label: { en: 'Profile', sw: 'Wasifu' },
  },
] as const;

export type WorkforceTabId = (typeof WORKFORCE_TAB_CATALOG)[number]['id'];

/** Tabs that the owner can NEVER disable for any role. */
export const MANDATORY_WORKFORCE_TAB_IDS: ReadonlyArray<string> = [
  'chat',
  'profile',
];

/**
 * Return the catalog entries a given role is allowed to see (the union
 * of role-specific tabs plus the universal `*` tabs).
 */
export function listTabsAllowedForRole(
  role: WorkforceRoleId,
): ReadonlyArray<WorkforceTabSpec> {
  return WORKFORCE_TAB_CATALOG.filter((spec) =>
    spec.roles.some((r) => r === '*' || r === role),
  );
}

/**
 * Default enabled-tab set per role for tenants that have no owner-set
 * config row yet. Built from `listTabsAllowedForRole` so it stays in
 * lockstep with the catalog when new tabs are added.
 */
export function defaultEnabledTabIdsForRole(
  role: WorkforceRoleId,
): ReadonlyArray<string> {
  return listTabsAllowedForRole(role).map((t) => t.id);
}

/**
 * Validate a proposed enabled-tab list against the catalog + role
 * permissions + mandatory-tab rule. Returns either `{ ok: true }` or
 * `{ ok: false, error }` so the api-gateway can return a precise 400.
 */
export function validateEnabledTabsForRole(
  role: WorkforceRoleId,
  enabledTabIds: ReadonlyArray<string>,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const allowed = new Set(listTabsAllowedForRole(role).map((t) => t.id));
  const seen = new Set<string>();
  for (const id of enabledTabIds) {
    if (!allowed.has(id)) {
      return {
        ok: false,
        error: `Tab '${id}' is not in the catalog for role '${role}'.`,
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: `Tab '${id}' is listed more than once.` };
    }
    seen.add(id);
  }
  for (const mandatory of MANDATORY_WORKFORCE_TAB_IDS) {
    if (allowed.has(mandatory) && !seen.has(mandatory)) {
      return {
        ok: false,
        error: `Tab '${mandatory}' is mandatory and cannot be disabled.`,
      };
    }
  }
  return { ok: true };
}
