/**
 * Killswitch — administrative HALT short-circuit (step 0 of think()).
 *
 * The killswitch lets a human operator stop the kernel at the earliest
 * possible point: BEFORE any sensor call, memory recall, cohort lookup,
 * or grounding fetch. It exists for governance scenarios where the
 * organization must guarantee "no further AI output" until a human
 * clears the hold:
 *
 *   - Compliance hold after a CBK / EAC / OAG directive.
 *   - Suspected tenant data leak — pause all generation while audit
 *     runs.
 *   - Provider incident escalation (e.g. Anthropic outage with stale
 *     responses that may quote outdated rent / KRA MRI rates).
 *   - Per-tenant emergency stop — one agency suspects their owner-
 *     portal is compromised but the other 47 tenants must keep going.
 *
 * The killswitch is a port. The default implementation reads from env
 * vars (`KILLSWITCH_STATE`, `KILLSWITCH_TENANT_<id>`); production wires
 * a flag-service port instead. The kernel itself depends only on the
 * structural shape.
 *
 * Levels:
 *   - 'live'     → normal operation
 *   - 'degraded' → soft warning (logged, surfaced in provenance; the
 *                  kernel still runs but lower-stakes calls only).
 *                  Mapped onto stakes filter in callers.
 *   - 'halt'     → hard refusal, kernel returns immediately with a
 *                  refusal decision. No LLM call. No memory side-
 *                  effects (other than the trace recorder, which still
 *                  records the short-circuit so ops can audit it).
 *
 * Reason codes are tagged strings so dashboards can group halts by
 * cause.
 */

export type KillswitchLevel = 'live' | 'degraded' | 'halt';

/**
 * Reason codes for a HALT. Documented in code (not user-facing copy)
 * so ops and on-call know exactly why their kernel is silent. Each
 * code corresponds to a concrete operational scenario; the property-
 * management vocabulary is intentional — when a regulator asks "why
 * did your AI refuse?" the answer must reference real domain entities.
 */
export type KillswitchReasonCode =
  // Platform-wide reasons
  | 'KILLSWITCH_HALT'                     // generic platform-wide halt
  | 'COMPLIANCE_HOLD_CBK'                 // Central Bank of Kenya directive
  | 'COMPLIANCE_HOLD_EAC'                 // East African Community directive
  | 'COMPLIANCE_HOLD_OAG'                 // Office of Attorney-General hold
  | 'PROVIDER_INCIDENT'                   // upstream sensor incident
  | 'STALE_GROUNDING_FACTS'               // KRA MRI / GePG / FX data stale
  // Tenant-scoped reasons
  | 'TENANT_HALT'                         // generic tenant-scoped halt
  | 'TENANT_DATA_LEAK_SUSPECTED'          // agency owner-portal breach
  | 'TENANT_PORTAL_COMPROMISED'           // tenant-app credentials suspected
  | 'OWNER_STATEMENT_DISPUTE'             // owner-statement integrity hold
  | 'MAINTENANCE_TICKET_STORM';           // ticket-flood DoS suspected

export interface KillswitchState {
  readonly level: KillswitchLevel;
  readonly reasonCode: KillswitchReasonCode;
  readonly note?: string;
}

export interface KillswitchPort {
  /**
   * Read the platform-wide killswitch state. Returns `{level:'live'}`
   * when no kill-state is configured.
   */
  readPlatform(): KillswitchState;
  /**
   * Read the per-tenant killswitch state. Returns `null` when no
   * tenant-scoped halt is configured for this tenant; callers fall
   * back to the platform state.
   */
  readTenant(tenantId: string | null): KillswitchState | null;
}

const DEFAULT_LIVE: KillswitchState = {
  level: 'live',
  reasonCode: 'KILLSWITCH_HALT',
};

/**
 * Default port that reads from process env vars. Used in tests and as
 * a no-op in production until a flag-service is wired in.
 *
 *   - `KILLSWITCH_STATE`               — platform-wide level
 *   - `KILLSWITCH_REASON`              — reason code (optional)
 *   - `KILLSWITCH_TENANT_<tenantId>`   — per-tenant level
 *   - `KILLSWITCH_TENANT_<id>_REASON`  — per-tenant reason (optional)
 *
 * Levels accepted: 'halt' | 'degraded' | 'live' (case-insensitive).
 * Anything else collapses to 'live' to fail-open on misconfiguration.
 */
export function createEnvKillswitchPort(
  envSource: Readonly<Record<string, string | undefined>> = process.env,
): KillswitchPort {
  return {
    readPlatform(): KillswitchState {
      const raw = envSource['KILLSWITCH_STATE'];
      const level = parseLevel(raw);
      if (level === 'live') return DEFAULT_LIVE;
      const reasonRaw = envSource['KILLSWITCH_REASON'];
      return {
        level,
        reasonCode: parseReasonCode(reasonRaw, 'KILLSWITCH_HALT'),
      };
    },
    readTenant(tenantId: string | null): KillswitchState | null {
      if (!tenantId) return null;
      const key = `KILLSWITCH_TENANT_${tenantId}`;
      const raw = envSource[key];
      if (!raw) return null;
      const level = parseLevel(raw);
      if (level === 'live') return null;
      const reasonRaw = envSource[`${key}_REASON`];
      return {
        level,
        reasonCode: parseReasonCode(reasonRaw, 'TENANT_HALT'),
      };
    },
  };
}

function parseLevel(raw: string | undefined): KillswitchLevel {
  if (!raw) return 'live';
  const v = raw.trim().toLowerCase();
  if (v === 'halt') return 'halt';
  if (v === 'degraded') return 'degraded';
  return 'live';
}

const VALID_REASON_CODES = new Set<string>([
  'KILLSWITCH_HALT',
  'COMPLIANCE_HOLD_CBK',
  'COMPLIANCE_HOLD_EAC',
  'COMPLIANCE_HOLD_OAG',
  'PROVIDER_INCIDENT',
  'STALE_GROUNDING_FACTS',
  'TENANT_HALT',
  'TENANT_DATA_LEAK_SUSPECTED',
  'TENANT_PORTAL_COMPROMISED',
  'OWNER_STATEMENT_DISPUTE',
  'MAINTENANCE_TICKET_STORM',
]);

function parseReasonCode(
  raw: string | undefined,
  fallback: KillswitchReasonCode,
): KillswitchReasonCode {
  if (!raw) return fallback;
  const v = raw.trim().toUpperCase();
  if (VALID_REASON_CODES.has(v)) return v as KillswitchReasonCode;
  return fallback;
}

/**
 * Resolve the effective killswitch state for a request. Per-tenant
 * state takes precedence over platform-wide state — an agency can
 * halt themselves without forcing every other tenant to also halt,
 * and the platform can halt globally without needing to enumerate
 * tenants.
 *
 * Precedence (first non-live wins):
 *   1. tenant-scoped HALT
 *   2. platform-wide HALT
 *   3. tenant-scoped DEGRADED
 *   4. platform-wide DEGRADED
 *   5. live
 */
export function resolveKillswitch(
  port: KillswitchPort,
  tenantId: string | null,
): KillswitchState {
  const platform = port.readPlatform();
  const tenant = port.readTenant(tenantId);

  // HALT wins, tenant first.
  if (tenant?.level === 'halt') return tenant;
  if (platform.level === 'halt') return platform;
  // Then degraded, tenant first.
  if (tenant?.level === 'degraded') return tenant;
  if (platform.level === 'degraded') return platform;
  return DEFAULT_LIVE;
}

/**
 * Render the user-facing refusal copy for a HALT. Kept neutral and
 * informative; never leaks the reason code (that lives in provenance
 * + the decision-trace, not in the reply).
 */
export function renderKillswitchRefusalText(state: KillswitchState): string {
  if (state.level !== 'halt') return '';
  return [
    'Service is temporarily paused while a human operator reviews recent ',
    'activity. Your request was not processed. Please try again later or ',
    'contact your account administrator if this is urgent.',
  ].join('');
}
