/**
 * Data-routing reasoner — the core decision function.
 *
 * `routeCapturedDatum(datum, ctx)` is a PURE function that decides, for a
 * captured document/datum:
 *   - WHERE it belongs   → `targetModule` + `targetAction`
 *   - WHY                → `rationale` (evidence-cited, never empty)
 *   - WHAT NEXT          → `need` (nothing | reminder | follow-up | workflow)
 *                          + the `obligation` / `workflowHint` that backs it
 *   - WHETHER A HUMAN IS NEEDED → `requiresHumanApproval` / `autonomyEligible`
 *
 * It composes-with the rails: the caller passes a `RailGateVerdict`; a
 * GATE verdict always wins (see rail-gate.ts). This function can only
 * ADD gating on top of the rail, never remove it.
 *
 * The destination matrix here is intentionally THIN — the structural
 * where-to-file rules live in `@borjie/document-analysis`'s
 * `ROUTING_MATRIX`. This reasoner adds the *needs* layer (the two joins
 * the spec calls missing: dated-datum → follow-up candidate, and the
 * workflow-vs-reminder-vs-nothing judgement) on top of any destination.
 */
import {
  type CapturedDatum,
  type DataRoutingDecision,
  type DatedObligation,
  type RoutingEvidence,
  type RoutingModule,
  type RoutingNeed,
  type RoutingRationale,
  type RoutingRationaleCode,
} from './routing-types.js';
import { applyRailGate, type RailGateVerdict, RAIL_PASS } from './rail-gate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Below this combined confidence the routing is HITL-gated. Mirrors the
 * document-analysis `THRESHOLDS.AUTO_APPLY_ROUTING` posture so the two
 * layers agree by construction. Overridable per-call for stakes-scaling.
 */
export const DEFAULT_AUTO_APPLY_THRESHOLD = 0.8;

/**
 * A destination + the field keys it needs. The reasoner only knows a
 * small built-in set; the host extends via `ctx.destinations`. Keeping
 * the built-ins mining-domain-shaped (licences, royalties, assays,
 * offtakes) so the package is useful stand-alone.
 */
export interface DestinationRule {
  readonly kind: string;
  readonly module: RoutingModule;
  readonly action: string;
  readonly requiredFieldKeys: ReadonlyArray<string>;
  /** A date field here makes the datum a dated obligation. */
  readonly dateFieldKeys?: ReadonlyArray<string>;
  /** If set, this kind kicks a known multi-step workflow when filed. */
  readonly workflowHint?: string;
}

const BUILTIN_DESTINATIONS: ReadonlyArray<DestinationRule> = [
  {
    kind: 'payment_receipt',
    module: 'finance',
    action: 'post_receipt',
    requiredFieldKeys: ['amount'],
    dateFieldKeys: ['payment_date'],
  },
  {
    kind: 'royalty_return',
    module: 'finance',
    action: 'record_royalty_return',
    requiredFieldKeys: ['amount'],
    dateFieldKeys: ['due_date', 'filing_deadline'],
    workflowHint: 'process_royalty_payment',
  },
  {
    kind: 'licence_renewal',
    module: 'compliance',
    action: 'create_renewal_request',
    requiredFieldKeys: ['licence_reference'],
    dateFieldKeys: ['expiry_date', 'renewal_deadline'],
    workflowHint: 'licence_renewal',
  },
  {
    kind: 'assay_report',
    module: 'estate',
    action: 'attach_assay',
    requiredFieldKeys: ['asset_reference'],
    dateFieldKeys: ['assay_date'],
  },
  {
    kind: 'offtake_contract',
    module: 'marketplace',
    action: 'create_offtake',
    requiredFieldKeys: ['buyer_name', 'asset_reference'],
    dateFieldKeys: ['offtake_start_date', 'offtake_end_date'],
    workflowHint: 'onboard_offtake',
  },
  {
    kind: 'national_id',
    module: 'compliance',
    action: 'archive_id',
    requiredFieldKeys: ['id_number'],
  },
  {
    kind: 'vendor_invoice',
    module: 'finance',
    action: 'process_invoice',
    requiredFieldKeys: ['vendor_name', 'amount'],
    dateFieldKeys: ['due_date'],
  },
];

export interface RouteContext {
  /** ISO clock — injected for determinism in tests. */
  readonly now: () => Date;
  /** Rail verdict from the host's REAL kernel rails. Default = PASS. */
  readonly railVerdict?: RailGateVerdict;
  /** Host-supplied destinations, appended to (and override) built-ins. */
  readonly destinations?: ReadonlyArray<DestinationRule>;
  /** Auto-apply threshold override (stakes-scaling). */
  readonly autoApplyThreshold?: number;
}

/**
 * The whole thinking behind it. Pure: same inputs → same decision.
 */
export function routeCapturedDatum(
  datum: CapturedDatum,
  ctx: RouteContext,
): DataRoutingDecision {
  const now = ctx.now();
  const threshold = ctx.autoApplyThreshold ?? DEFAULT_AUTO_APPLY_THRESHOLD;
  const rule = resolveDestination(datum.kind, ctx.destinations);

  // --- WHERE + WHY ---------------------------------------------------------
  if (!rule) {
    const candidate = noKindMatch(datum, now);
    return applyRailGate(candidate, ctx.railVerdict ?? RAIL_PASS);
  }

  const missing = rule.requiredFieldKeys.filter((k) => !(k in datum.fields));
  const present = rule.requiredFieldKeys.filter((k) => k in datum.fields);

  const minFieldConfidence =
    present.length > 0
      ? Math.min(...present.map((k) => datum.fields[k]?.confidence ?? 0))
      : 1;
  const destinationConfidence =
    minFieldConfidence * datum.classificationConfidence;

  const obligation = extractObligation(datum, rule, now);

  // --- WHAT NEXT (need judgement) -----------------------------------------
  const need = decideNeed(rule, obligation);
  const workflowHint = need === 'workflow' ? (rule.workflowHint ?? null) : null;

  // --- GATE (own gating; rail applied last) -------------------------------
  const requiredFieldMissing = missing.length > 0;
  const lowConfidence = destinationConfidence < threshold;
  const ownRequiresApproval = requiredFieldMissing || lowConfidence;

  const code: RoutingRationaleCode = requiredFieldMissing
    ? 'required_field_missing'
    : obligation && (need === 'reminder' || need === 'follow-up')
      ? 'dated_obligation'
      : lowConfidence
        ? 'low_confidence_match'
        : 'high_confidence_match';

  const evidence: RoutingEvidence[] = [
    { kind: 'datum', id: datum.id, detail: datum.kind },
    {
      kind: 'classification',
      id: `confidence:${datum.classificationConfidence.toFixed(2)}`,
    },
    ...present.map(
      (k): RoutingEvidence => ({ kind: 'field', id: k, detail: 'required' }),
    ),
    ...missing.map(
      (k): RoutingEvidence => ({ kind: 'field', id: k, detail: 'missing' }),
    ),
    { kind: 'rule', id: `${rule.module}:${rule.action}` },
  ];

  const rationale: RoutingRationale = {
    summary: summarize(rule, datum, missing, obligation, lowConfidence),
    code,
    evidence,
    destinationConfidence,
  };

  const candidate: DataRoutingDecision = {
    datumId: datum.id,
    tenantId: datum.tenantId,
    targetModule: rule.module,
    targetAction: rule.action,
    rationale,
    need,
    requiresHumanApproval: ownRequiresApproval,
    // Eligible only when nothing of ours gates; rail-gate may still veto.
    autonomyEligible: !ownRequiresApproval,
    obligation,
    workflowHint,
    decidedAt: now.toISOString(),
  };

  return applyRailGate(candidate, ctx.railVerdict ?? RAIL_PASS);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveDestination(
  kind: string,
  hostDestinations: ReadonlyArray<DestinationRule> | undefined,
): DestinationRule | null {
  // Host destinations override built-ins on a kind collision.
  if (hostDestinations) {
    const hostMatch = hostDestinations.find((d) => d.kind === kind);
    if (hostMatch) return hostMatch;
  }
  return BUILTIN_DESTINATIONS.find((d) => d.kind === kind) ?? null;
}

function extractObligation(
  datum: CapturedDatum,
  rule: DestinationRule,
  now: Date,
): DatedObligation | null {
  const dateKeys = rule.dateFieldKeys ?? [];
  for (const key of dateKeys) {
    const field = datum.fields[key];
    const iso = field?.isoDate;
    if (!iso) continue;
    const dueMs = Date.parse(iso);
    if (Number.isNaN(dueMs)) continue;
    const daysUntilDue = Math.floor((dueMs - now.getTime()) / DAY_MS);
    return {
      dueAt: new Date(dueMs).toISOString(),
      sourceFieldKey: key,
      description: `${humanizeKind(datum.kind)} due ${describeRelative(daysUntilDue)}`,
      daysUntilDue,
    };
  }
  return null;
}

/**
 * The need judgement — the spec's "reminder / follow-up / workflow /
 * nothing" decision.
 *   - workflow : the kind kicks a known deterministic flow.
 *   - follow-up: a dated obligation that needs tracking (≤ 30 days out
 *     or already overdue — a tracked, escalating candidate).
 *   - reminder : a dated obligation further out — a single dated nudge.
 *   - nothing  : file-and-forget.
 */
function decideNeed(
  rule: DestinationRule,
  obligation: DatedObligation | null,
): RoutingNeed {
  if (rule.workflowHint) return 'workflow';
  if (obligation) {
    return obligation.daysUntilDue <= 30 ? 'follow-up' : 'reminder';
  }
  return 'nothing';
}

function noKindMatch(datum: CapturedDatum, now: Date): DataRoutingDecision {
  const rationale: RoutingRationale = {
    summary: `No routing rule matched kind "${datum.kind}"; needs a human to triage.`,
    code: 'no_kind_match',
    evidence: [
      { kind: 'datum', id: datum.id, detail: datum.kind },
      {
        kind: 'classification',
        id: `confidence:${datum.classificationConfidence.toFixed(2)}`,
      },
    ],
    destinationConfidence: 0,
  };
  return {
    datumId: datum.id,
    tenantId: datum.tenantId,
    targetModule: 'unknown',
    targetAction: 'triage',
    rationale,
    need: 'follow-up',
    requiresHumanApproval: true,
    autonomyEligible: false,
    obligation: null,
    workflowHint: null,
    decidedAt: now.toISOString(),
  };
}

function summarize(
  rule: DestinationRule,
  datum: CapturedDatum,
  missing: ReadonlyArray<string>,
  obligation: DatedObligation | null,
  lowConfidence: boolean,
): string {
  const where = `${humanizeKind(datum.kind)} → ${rule.module}.${rule.action}`;
  if (missing.length > 0) {
    return `${where}; missing ${missing.join(', ')} — needs a human to fill the blanks.`;
  }
  if (obligation) {
    return `${where}; ${obligation.description}.`;
  }
  if (lowConfidence) {
    return `${where}; low confidence — confirm before filing.`;
  }
  return `${where}.`;
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ');
}

function describeRelative(daysUntilDue: number): string {
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} day(s) ago (overdue)`;
  if (daysUntilDue === 0) return 'today';
  return `in ${daysUntilDue} day(s)`;
}

/** Exposed for tests + diagnostics. */
export { BUILTIN_DESTINATIONS };
