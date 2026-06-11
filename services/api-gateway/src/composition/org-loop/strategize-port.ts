/**
 * strategize-port.ts — the SELF-RUNNING-ORG spine STRATEGIZE stage.
 *
 * THE STAGE THIS IS
 * -----------------
 * Once the living MD has DETECTED a gap (an `md_commitment` row born at a typed
 * impasse — licence overdue, royalty unfiled, a workforce coverage hole), the
 * spine must decide WHAT the corrective work actually is before it can pick a
 * person and assign it. This port is that decision: it consumes a durable
 * `MdCommitment` (+ optional drive context the EstateMind tick already computed)
 * and produces a `StrategyTrace` — the task SHAPE (title / description / priority
 * / competence domain) plus the rationale + urgency the rest of the spine threads
 * into `planAssignment` → `assignTask`.
 *
 * UNIVERSAL ENGINE · DOMAIN-PACK DATA (LOOP-FLEXIBILITY LAW)
 * ---------------------------------------------------------
 * The port itself is universal Mr-Mwikila core — it is the same STRATEGIZE seam
 * for any vertical. The COMPETENCE DOMAINS (`production` / `maintenance` /
 * `workforce` / `compliance` / ...) are mining-pack DATA: a declarative const
 * table, NOT a hardcoded per-vertical branch in the engine. A different pack
 * supplies a different domain table; the deterministic mapping is a pure lookup
 * over that data. When a `ReasoningPort` is injected the engine defers to it (the
 * brain composes the strategy); absent one it falls back to the deterministic,
 * mining-coherent mapping so the spine is live the moment the gap appears.
 *
 * PURE where possible: the deterministic path has no IO. The injected reasoning
 * path is the only async hop. No `console.*` (Pino shim only). Immutable outputs
 * (every returned object is frozen). Evidence is threaded straight through from
 * the commitment so the Auditor evidence-required rail is satisfied downstream.
 */

import type { MdCommitment } from '@borjie/database/repositories';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// DOMAIN-PACK DATA — the mining operational competence domains. This is
// the loop CONTENT (pack data), not the engine. A different vertical pack
// supplies a different table; the engine only does a pure lookup over it.
// ─────────────────────────────────────────────────────────────────────

/** The mining operational competence domains (declarative pack data). */
export const MINING_COMPETENCE_DOMAINS = [
  'production',
  'maintenance',
  'workforce',
  'compliance',
  'treasury',
  'procurement',
  'safety',
  'geology',
  'logistics',
] as const;

export type CompetenceDomain = (typeof MINING_COMPETENCE_DOMAINS)[number];

/** Default domain when nothing in the gap resolves a specific competence. */
const DEFAULT_COMPETENCE_DOMAIN: CompetenceDomain = 'workforce';

/**
 * Keyword → competence-domain table (pack DATA). Each domain lists the
 * substrings that, found in the gap's `kind` / `gapKind` / title / rationale,
 * route the corrective work to that competence. Ordered by specificity:
 * compliance/treasury/safety win over the generic workforce default. A pure,
 * data-driven lookup — the engine never branches per vertical.
 */
const DOMAIN_KEYWORDS: ReadonlyArray<readonly [CompetenceDomain, ReadonlyArray<string>]> =
  Object.freeze([
    ['compliance', ['licence', 'license', 'permit', 'royalty', 'regulator', 'compliance', 'filing', 'audit', 'inspection']],
    ['safety', ['safety', 'incident', 'hazard', 'ppe', 'accident', 'emergency']],
    ['treasury', ['treasury', 'payment', 'invoice', 'payroll', 'ledger', 'cashflow', 'cash flow', 'settlement']],
    ['procurement', ['procure', 'purchase', 'supplier', 'vendor', 'order', 'inventory', 'restock']],
    ['maintenance', ['maintenance', 'repair', 'breakdown', 'servicing', 'equipment', 'machine', 'pump', 'generator']],
    ['geology', ['geolog', 'assay', 'survey', 'sampling', 'ore grade', 'exploration', 'drill']],
    ['logistics', ['logistic', 'transport', 'haul', 'dispatch', 'delivery', 'shipment', 'fuel']],
    ['production', ['production', 'output', 'extraction', 'processing', 'throughput', 'yield', 'tonnage', 'shift']],
    ['workforce', ['workforce', 'crew', 'staff', 'roster', 'coverage', 'shift cover', 'training', 'onboard']],
  ]);

/**
 * Resolve a competence domain from the gap, data-first. The commitment's own
 * `competenceDomain` (the jagged-frontier coordinate the gap register stamps)
 * wins when it is one of the pack domains; otherwise a pure keyword lookup over
 * `kind` / `gapKind` / title / rationale; otherwise the workforce default.
 */
export function resolveCompetenceDomain(commitment: MdCommitment): CompetenceDomain {
  const stamped = commitment.competenceDomain;
  if (stamped && (MINING_COMPETENCE_DOMAINS as ReadonlyArray<string>).includes(stamped)) {
    return stamped as CompetenceDomain;
  }
  const haystack = [
    commitment.kind,
    commitment.gapKind ?? '',
    commitment.title,
    commitment.rationale,
  ]
    .join(' ')
    .toLowerCase();
  for (const [domain, keywords] of DOMAIN_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return domain;
  }
  return DEFAULT_COMPETENCE_DOMAIN;
}

// ─────────────────────────────────────────────────────────────────────
// Urgency / priority — universal engine mapping (NOT pack-specific).
// ─────────────────────────────────────────────────────────────────────

/** The spine urgency band (mirrors the kernel DriveUrgency union). */
export type StrategyUrgency = 'low' | 'medium' | 'high' | 'critical';

/** The workforce task priority union (matches AssignTaskInput.priority). */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Drive context the EstateMind tick already computed for this concern. */
export interface DriveContext {
  /** The standing-drive id the gap maps to (e.g. `compliance-pressure`). */
  readonly driveId?: string | null;
  /** Normalised breach severity in [0,1] — how far past the set-point. */
  readonly breachSeverity?: number | null;
  /** A pre-resolved urgency band (overrides the derived one when present). */
  readonly urgency?: StrategyUrgency | null;
}

/** Map a commitment + drive context to an urgency band (pure). */
export function deriveUrgency(
  commitment: MdCommitment,
  driveContext?: DriveContext,
): StrategyUrgency {
  if (driveContext?.urgency) return driveContext.urgency;
  // A sovereign / overdue obligation is the loudest concern.
  if (commitment.sovereign || commitment.status === 'overdue') return 'critical';
  const severity =
    typeof driveContext?.breachSeverity === 'number'
      ? Math.min(1, Math.max(0, driveContext.breachSeverity))
      : null;
  if (severity !== null) {
    if (severity >= 0.75) return 'critical';
    if (severity >= 0.5) return 'high';
    if (severity >= 0.25) return 'medium';
    return 'low';
  }
  // No severity signal — lean on the lifecycle: blocked/reopened deserve a push.
  if (commitment.status === 'blocked' || commitment.status === 'reopened') return 'high';
  return 'medium';
}

/** Map an urgency band to the workforce task priority union (pure). */
export function urgencyToPriority(urgency: StrategyUrgency): TaskPriority {
  switch (urgency) {
    case 'critical':
      return 'urgent';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
  }
}

// ─────────────────────────────────────────────────────────────────────
// The StrategyTrace + the port surface.
// ─────────────────────────────────────────────────────────────────────

/** The task SHAPE the spine threads into planAssignment → assignTask. */
export interface TaskShape {
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly competenceDomain: CompetenceDomain;
}

/** The STRATEGIZE output — the task shape + why + how loud. */
export interface StrategyTrace {
  readonly taskShape: TaskShape;
  readonly rationale: string;
  readonly urgency: StrategyUrgency;
  /** Evidence ids threaded straight from the gap (Auditor evidence rail). */
  readonly evidenceIds: ReadonlyArray<string>;
  /** 'reasoning' when the injected brain composed it; else 'deterministic'. */
  readonly source: 'deterministic' | 'reasoning';
}

/**
 * Optional reasoning port — when injected, the brain composes the strategy. A
 * fault or a `null` return falls back to the deterministic mapping (honest
 * degrade, never a throw out of `strategize`).
 */
export interface ReasoningPort {
  propose(input: {
    readonly tenantId: string;
    readonly commitment: MdCommitment;
    readonly driveContext?: DriveContext;
    readonly competenceDomain: CompetenceDomain;
  }): Promise<{
    readonly title?: string;
    readonly description?: string;
    readonly priority?: TaskPriority;
    readonly competenceDomain?: CompetenceDomain;
    readonly rationale?: string;
    readonly urgency?: StrategyUrgency;
  } | null>;
}

export interface StrategizePort {
  strategize(
    tenantId: string,
    commitment: MdCommitment,
    driveContext?: DriveContext,
  ): Promise<StrategyTrace>;
}

export interface CreateStrategizePortDeps {
  /** Optional brain reasoning port. Absent → deterministic mapping. */
  readonly reasoning?: ReasoningPort | null;
  readonly logger?: PinoLikeLogger;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Trim + clamp to assignTask's title bound (<=500) so the shape is valid. */
function clampTitle(raw: string): string {
  const t = raw.trim();
  return t.length > 500 ? `${t.slice(0, 497)}...` : t;
}

/**
 * Build the deterministic, mining-coherent task shape from the gap alone. PURE.
 * The title is the gap's own title; the description composes the rationale +
 * the competence domain so the assignee sees WHY this is their work. Exported so
 * the reasoning-path fallback and tests share one source of truth.
 */
export function deterministicTaskShape(
  commitment: MdCommitment,
  domain: CompetenceDomain,
  priority: TaskPriority,
): TaskShape {
  const description =
    `${commitment.rationale}`.trim().length > 0
      ? `${commitment.rationale.trim()} (competence: ${domain})`
      : `Corrective action for ${commitment.kind} (competence: ${domain}).`;
  return Object.freeze({
    title: clampTitle(commitment.title),
    description,
    priority,
    competenceDomain: domain,
  });
}

/**
 * Create the STRATEGIZE port. Deterministic by default; defers to an injected
 * `reasoning` port when present (with an honest-degrade fallback).
 */
export function createStrategizePort(
  deps: CreateStrategizePortDeps = {},
): StrategizePort {
  const logger = deps.logger ?? createPinoLikeLogger('org-loop-strategize');
  const reasoning = deps.reasoning ?? null;

  function deterministic(
    commitment: MdCommitment,
    driveContext?: DriveContext,
  ): StrategyTrace {
    const domain = resolveCompetenceDomain(commitment);
    const urgency = deriveUrgency(commitment, driveContext);
    const priority = urgencyToPriority(urgency);
    return Object.freeze({
      taskShape: deterministicTaskShape(commitment, domain, priority),
      rationale: commitment.rationale,
      urgency,
      evidenceIds: Object.freeze([...commitment.evidenceIds]),
      source: 'deterministic' as const,
    });
  }

  return {
    async strategize(tenantId, commitment, driveContext) {
      const baseline = deterministic(commitment, driveContext);
      if (!reasoning) return baseline;
      const domain = baseline.taskShape.competenceDomain;
      try {
        const proposed = await reasoning.propose({
          tenantId,
          commitment,
          ...(driveContext ? { driveContext } : {}),
          competenceDomain: domain,
        });
        if (!proposed) return baseline;
        const urgency = proposed.urgency ?? baseline.urgency;
        const resolvedDomain = proposed.competenceDomain ?? domain;
        const priority = proposed.priority ?? urgencyToPriority(urgency);
        return Object.freeze({
          taskShape: Object.freeze({
            title: clampTitle(proposed.title ?? baseline.taskShape.title),
            description: (proposed.description ?? baseline.taskShape.description).trim(),
            priority,
            competenceDomain: resolvedDomain,
          }),
          rationale: proposed.rationale ?? baseline.rationale,
          urgency,
          evidenceIds: baseline.evidenceIds,
          source: 'reasoning' as const,
        });
      } catch (err) {
        logger.warn(
          { tenantId, commitmentId: commitment.id, err: errMsg(err) },
          'org-loop-strategize: reasoning port failed — falling back to deterministic strategy (honest degrade)',
        );
        return baseline;
      }
    },
  };
}
