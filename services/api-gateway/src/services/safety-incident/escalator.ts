/**
 * Safety-incident severity escalator — chain L-C (issue #193).
 *
 * Pure decider: given an incident's severity + kind, returns which
 * actors must be notified and whether a regulator filing draft should
 * be enqueued. Matches the GMG System Safety guideline (Mar 2024):
 *
 *   low / medium             -> manager investigation queue only.
 *   high                     -> manager + owner cockpit pulse.
 *   critical / fatality      -> manager + owner + Borjie admin
 *                                compliance officer + regulator draft.
 *
 * The handler attaches a SafetyIncidentEvent to the cockpit bus when
 * severity >= high and pushes a bilingual SOS to the manager for every
 * report.
 *
 * Pure module — no DB I/O, no time injection (caller stamps).
 */

export type IncidentSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'fatality';

export type IncidentKind =
  | 'safety'
  | 'environmental'
  | 'community'
  | 'near_miss'
  | 'equipment_failure'
  | 'fatality';

export interface EscalateInput {
  readonly severity: IncidentSeverity;
  readonly kind: IncidentKind;
}

export interface EscalateResult {
  readonly notifyManager: true;
  readonly notifyOwner: boolean;
  readonly notifyAdminCompliance: boolean;
  readonly draftRegulatorFiling: boolean;
  readonly emitCockpitPulse: boolean;
  readonly priority: 'normal' | 'urgent' | 'critical';
  readonly summary: {
    readonly sw: string;
    readonly en: string;
  };
}

/** Severity ranking used to short-circuit thresholds. */
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
  fatality: 4,
};

function gte(level: IncidentSeverity, threshold: IncidentSeverity): boolean {
  return SEVERITY_RANK[level] >= SEVERITY_RANK[threshold];
}

/**
 * Decide the escalation fan-out for an incident report.
 *
 * Invariants:
 *   - Manager is ALWAYS notified (worker safety SOS).
 *   - Owner pulse fires for severity >= 'high'.
 *   - Admin compliance + regulator draft fire for severity >= 'critical'.
 *   - Fatality kind forces the maximum tier regardless of severity
 *     (defensive — a 'fatality' kind with low/medium severity is a
 *      data-entry error and must still pin the regulator).
 */
export function escalateIncident(input: EscalateInput): EscalateResult {
  const sev =
    input.kind === 'fatality' &&
    SEVERITY_RANK[input.severity] < SEVERITY_RANK.critical
      ? 'critical'
      : input.severity;

  const notifyOwner = gte(sev, 'high');
  const notifyAdminCompliance = gte(sev, 'critical');
  const draftRegulatorFiling = gte(sev, 'critical');

  const priority: 'normal' | 'urgent' | 'critical' =
    sev === 'critical' || sev === 'fatality'
      ? 'critical'
      : sev === 'high'
      ? 'urgent'
      : 'normal';

  const sw = (() => {
    if (priority === 'critical') {
      return 'Tukio LA HATARI KUBWA limeripotiwa — angalia sasa.';
    }
    if (priority === 'urgent') {
      return 'Tukio LA HATARI limeripotiwa — chunguza haraka.';
    }
    return 'Tukio jipya la usalama limeripotiwa — chunguza.';
  })();
  const en = (() => {
    if (priority === 'critical') {
      return 'CRITICAL safety incident reported — review immediately.';
    }
    if (priority === 'urgent') {
      return 'HIGH severity incident reported — investigate now.';
    }
    return 'New safety incident reported — please investigate.';
  })();

  return {
    notifyManager: true,
    notifyOwner,
    notifyAdminCompliance,
    draftRegulatorFiling,
    emitCockpitPulse: notifyOwner,
    priority,
    summary: { sw, en },
  };
}

/**
 * Role gates — manager can investigate; owner can escalate to a
 * regulator. Workers can only report (route guards that elsewhere).
 */
export function canInvestigate(role: string | undefined): boolean {
  if (!role) return false;
  return (
    role === 'OWNER' ||
    role === 'TENANT_ADMIN' ||
    role === 'PROPERTY_MANAGER' ||
    role === 'SUPER_ADMIN' ||
    role === 'MAINTENANCE_STAFF'
  );
}

export function canEscalateToRegulator(role: string | undefined): boolean {
  if (!role) return false;
  return (
    role === 'OWNER' || role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN'
  );
}
