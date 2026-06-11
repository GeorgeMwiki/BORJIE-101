/**
 * Piece M — person-matcher: the PURE, deterministic candidate-ranking
 * kernel for the self-running-org spine ("pick the right workforce
 * person for a detected need").
 *
 * THE SINGLE SOURCE OF TRUTH
 * --------------------------
 * The api-gateway route `routes/mining/tasks-suggest.hono.ts` shipped an
 * INLINE deterministic scorer (cert match + no-current-shift + site
 * experience + low-fatigue). That logic is now extracted here verbatim
 * as the `legacy*` weights so the route can import this kernel with ZERO
 * behaviour change, and EXTENDED with the spine's three new signals:
 *
 *   1. skill / cert match to `need.competenceDomain`  (capability fit)
 *   2. current load — fewer OPEN assignments ranks higher (capacity)
 *   3. role fit — the candidate's role matches the need's desired role
 *   4. learned `successRateByDomain` — a candidate whose completed work
 *      in THIS domain failed spot-checks is down-weighted (the matcher
 *      LEARNS; this is the closed-loop signal the org-loop feeds back).
 *
 * The kernel is a pure function: no IO, no clock, no random. Every input
 * the route/wiring can supply is OPTIONAL with a neutral default, so the
 * legacy 4-signal call (route) and the full spine call (org-loop wiring)
 * both run through ONE deterministic scorer. Confidence ∈ [0, 1].
 *
 * Immutability: returns fresh frozen objects; inputs are never mutated.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// The NEED — what the detected gap requires of a candidate.
// ─────────────────────────────────────────────────────────────────────────

export const MatchNeedSchema = z.object({
  /**
   * The competence/skill domain the work needs (e.g. 'pump_maintenance',
   * 'blasting', 'compliance'). Drives the skill/cert match signal. A
   * candidate holding a matching cert OR a matching skill assessment hits.
   */
  competenceDomain: z.string().min(1).nullable().optional(),
  /**
   * A specific certification slug the work requires (legacy route signal —
   * `attributes.requiredCertification`). Distinct from `competenceDomain`
   * so the route's exact cert-only match is preserved.
   */
  requiredCert: z.string().min(1).nullable().optional(),
  /** Desired role (e.g. 'foreman'). When set, an exact role match scores. */
  desiredRole: z.string().min(1).nullable().optional(),
  /** Site the work is on; same-site experience is a soft positive signal. */
  siteId: z.string().min(1).nullable().optional(),
});

export type MatchNeed = z.infer<typeof MatchNeedSchema>;

// ─────────────────────────────────────────────────────────────────────────
// A CANDIDATE snapshot — everything the kernel needs about one person.
// All extended signals are optional with neutral defaults so the legacy
// route call (which supplies only the first block) is byte-identical.
// ─────────────────────────────────────────────────────────────────────────

export interface MatchCandidate {
  /** Stable id used in the result (userId preferred, employeeId fallback). */
  readonly employeeId: string;
  /** Certification slugs the candidate holds (from employee.attributes). */
  readonly certifications?: ReadonlyArray<string>;
  /** Skill domains the candidate is assessed in (skill_assessments). */
  readonly skillDomains?: ReadonlyArray<string>;
  /** The candidate's role (employees.role). */
  readonly role?: string | null;
  /** Site the candidate most-recently worked (same-site experience). */
  readonly lastSiteId?: string | null;
  /** Whether the candidate is on an overlapping shift right now (conflict). */
  readonly hasActiveShiftNow?: boolean;
  /** Fatigue estimate 0..1 (higher = more tired; lower scores better). */
  readonly fatigueScore?: number;
  /** Count of OPEN (pending/in_progress/blocked) assignments — load. */
  readonly openAssignmentCount?: number;
  /**
   * LEARNED success rate in `need.competenceDomain`, 0..1. A candidate
   * whose completed tasks in this domain passed spot-checks trends to 1;
   * repeated failures pull it toward 0. `null`/absent → no history → the
   * signal is NEUTRAL (never penalises a newcomer, never rewards blindly).
   */
  readonly successRateByDomain?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Result — one scored candidate.
// ─────────────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  readonly employeeId: string;
  /** Total score ∈ [0, 1]; higher is a better match. */
  readonly score: number;
  /** Human-readable signal contributions (for the suggestion UI / audit). */
  readonly reasons: ReadonlyArray<string>;
  /**
   * Confidence ∈ [0, 1]. Mirrors `score` — the deterministic kernel's
   * score IS its confidence (an LLM ranker may later diverge the two).
   */
  readonly confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Signal weights. The first four mirror the route's inline scorer EXACTLY
// (0.5 / 0.2 / 0.2 / 0.1) so a legacy call reproduces it; the spine adds
// capability (skill-domain) + capacity (load) + role-fit on a separate
// budget that only engages when the need declares those dimensions.
// ─────────────────────────────────────────────────────────────────────────

const W_CERT_MATCH = 0.5; // legacy: certification match
const W_NO_CONFLICT = 0.2; // legacy: no current shift
const W_SAME_SITE = 0.2; // legacy: site experience
const W_LOW_FATIGUE = 0.1; // legacy: low fatigue (scaled by 1 - fatigue)

const W_SKILL_DOMAIN = 0.5; // spine: skill/cert match to competenceDomain
const W_LOW_LOAD = 0.2; // spine: fewer open assignments
const W_ROLE_FIT = 0.15; // spine: exact role match

/** Open-assignment count at/above which the load signal contributes zero. */
const LOAD_SATURATION = 5;
/** Fatigue at/below which the "low fatigue" reason is surfaced. */
const LOW_FATIGUE_THRESHOLD = 0.3;

// ─────────────────────────────────────────────────────────────────────────
// Pure ranking kernel.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score and sort candidates against a need. PURE + deterministic: same
 * inputs → same output, no IO. Sort is by descending score with a stable
 * `employeeId` tiebreak so ties never depend on input order.
 */
export function rankCandidates(
  candidates: ReadonlyArray<MatchCandidate>,
  need: MatchNeed,
): ScoredCandidate[] {
  const parsedNeed = MatchNeedSchema.parse(need);
  const scored = candidates.map((cand) => scoreCandidate(cand, parsedNeed));
  return scored
    .slice()
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.employeeId.localeCompare(b.employeeId),
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Per-candidate scorer (kept <50 lines; helpers below carry the detail).
// ─────────────────────────────────────────────────────────────────────────

function scoreCandidate(
  cand: MatchCandidate,
  need: MatchNeed,
): ScoredCandidate {
  const reasons: string[] = [];

  const certHit = matchesCert(cand, need.requiredCert ?? null);
  const noConflict = cand.hasActiveShiftNow !== true;
  const sameSite =
    need.siteId != null &&
    cand.lastSiteId != null &&
    cand.lastSiteId === need.siteId;
  const fatigue = clamp01(cand.fatigueScore ?? 0);
  const skillHit = matchesDomain(cand, need.competenceDomain ?? null);
  const roleHit =
    need.desiredRole != null &&
    cand.role != null &&
    cand.role === need.desiredRole;
  const loadFactor = loadContribution(cand.openAssignmentCount);

  if (certHit) reasons.push('certification match');
  if (noConflict) reasons.push('no current shift');
  if (sameSite) reasons.push('site experience');
  if (fatigue <= LOW_FATIGUE_THRESHOLD) reasons.push('low fatigue');
  if (skillHit) reasons.push('skill domain match');
  if (roleHit) reasons.push('role fit');
  if (loadFactor > 0.5) reasons.push('low current load');

  const base =
    (certHit ? W_CERT_MATCH : 0) +
    (noConflict ? W_NO_CONFLICT : 0) +
    (sameSite ? W_SAME_SITE : 0) +
    W_LOW_FATIGUE * (1 - fatigue) +
    (skillHit ? W_SKILL_DOMAIN : 0) +
    (roleHit ? W_ROLE_FIT : 0) +
    W_LOW_LOAD * loadFactor;

  // LEARNED multiplier: a proven track record in-domain protects the base;
  // a poor record discounts it. Absent history → neutral 1.0 multiplier.
  const learned = learnedMultiplier(cand.successRateByDomain);
  if (learned < 1) reasons.push('down-weighted: weak in-domain track record');
  else if (learned > 1 && need.competenceDomain != null)
    reasons.push('strong in-domain track record');

  const score = clamp01(base * learned);

  return Object.freeze({
    employeeId: cand.employeeId,
    score,
    reasons: Object.freeze(reasons),
    confidence: score,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Signal helpers.
// ─────────────────────────────────────────────────────────────────────────

function matchesCert(
  cand: MatchCandidate,
  requiredCert: string | null,
): boolean {
  if (!requiredCert) return false;
  const held = cand.certifications;
  if (!held || held.length === 0) return false;
  return held.some((c) => c === requiredCert);
}

function matchesDomain(
  cand: MatchCandidate,
  competenceDomain: string | null,
): boolean {
  if (!competenceDomain) return false;
  const inSkills = (cand.skillDomains ?? []).some((s) => s === competenceDomain);
  if (inSkills) return true;
  // A cert whose slug equals the competence domain also satisfies it.
  return (cand.certifications ?? []).some((c) => c === competenceDomain);
}

/** Map open-assignment load → [0,1]; 0 open ⇒ 1.0, saturates to 0. */
function loadContribution(openCount: number | undefined): number {
  if (openCount === undefined || openCount === null) return 1;
  const n = Number.isFinite(openCount) ? Math.max(0, openCount) : 0;
  if (n >= LOAD_SATURATION) return 0;
  return clamp01(1 - n / LOAD_SATURATION);
}

/**
 * Learned in-domain track-record → score multiplier in [0.5, 1.25].
 * - null / no history → 1.0 (neutral; never penalises a newcomer).
 * - success_rate 0.0 → 0.5 (halve the base — repeated spot-check failures).
 * - success_rate 0.5 → ~1.0 (par).
 * - success_rate 1.0 → 1.25 (modest reward for a proven hand).
 */
function learnedMultiplier(successRate: number | null | undefined): number {
  if (successRate === null || successRate === undefined) return 1;
  if (!Number.isFinite(successRate)) return 1;
  const r = clamp01(successRate);
  // Piecewise-linear through (0 → 0.5), (0.5 → 1.0), (1.0 → 1.25).
  if (r <= 0.5) return 0.5 + r; // 0.5 .. 1.0
  return 1 + (r - 0.5) * 0.5; // 1.0 .. 1.25
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
