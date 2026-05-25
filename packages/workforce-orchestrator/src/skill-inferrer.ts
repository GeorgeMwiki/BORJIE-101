/**
 * Piece M — skill-inferrer.
 *
 * Maps recent performance_signals → skill_assessments. The mapping
 * from assignment.context to skill_slug is application-owned; the
 * mapping table here is the kernel-default. Production deployments can
 * extend `SKILL_MAP` via composition root.
 *
 * proficiency_score is a sigmoid of the net weighted score:
 *
 *     score = sigmoid( sum(signal.weight * decay(age)) )
 *
 * where decay is exp(-age_days / 30). The sigmoid is calibrated such
 * that a steady stream of on_time_completion signals lifts the score
 * over weeks while a single missed_deadline dips it modestly. manager_
 * rated overrides always win.
 */

import {
  SkillAssessmentSchema,
  type PerformanceSignal,
  type SkillAssessment,
  type WorkforceDeps,
} from './types.js';

const DECAY_TAU_MS = 30 * 24 * 3_600_000;

/** Default signal-kind → skill-slug mapping. */
export const SKILL_MAP: Record<string, string[]> = {
  on_time_completion: ['execution_discipline', 'time_management'],
  missed_deadline: ['execution_discipline', 'time_management'],
  repeated_blocker: ['problem_solving', 'help_seeking'],
  exceptional_work: ['execution_discipline', 'craft_quality'],
  positive_sentiment: ['team_morale'],
  negative_sentiment: ['team_morale'],
};

const RECENT_WINDOW_MS = 60 * 24 * 3_600_000;

export async function runSkillInferrer(
  deps: WorkforceDeps,
  args: { tenantId: string; employeeId: string }
): Promise<SkillAssessment[]> {
  const since = new Date(deps.clock().getTime() - RECENT_WINDOW_MS);
  const signals = await deps.store.listSignalsForEmployee(
    args.tenantId,
    args.employeeId,
    since
  );

  const buckets = bucketBySkill(signals, deps.clock().getTime());
  const out: SkillAssessment[] = [];

  // Preserve existing manager_rated rows untouched.
  const existing = await deps.store.listSkillsForEmployee(args.tenantId, args.employeeId);
  const managerLocked = new Set(
    existing.filter((s) => s.sourceKind === 'manager_rated').map((s) => s.skillSlug)
  );

  for (const [skillSlug, raw] of buckets) {
    if (managerLocked.has(skillSlug)) continue;
    const score = sigmoid(raw);
    const row = SkillAssessmentSchema.parse({
      id: deps.uuid(),
      tenantId: args.tenantId,
      employeeId: args.employeeId,
      skillSlug,
      proficiencyScore: round(score, 2),
      lastAssessedAt: deps.clock().toISOString(),
      sourceKind: 'ai_inferred',
    });
    const upserted = await deps.store.upsertSkillAssessment(row);
    out.push(upserted);
  }

  return out;
}

export function bucketBySkill(
  signals: PerformanceSignal[],
  nowMs: number
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const s of signals) {
    const skills = SKILL_MAP[s.signalKind];
    if (!skills) continue;
    const ageMs = s.createdAt ? nowMs - new Date(s.createdAt).getTime() : 0;
    const decay = Math.exp(-ageMs / DECAY_TAU_MS);
    for (const slug of skills) {
      buckets.set(slug, (buckets.get(slug) ?? 0) + s.weight * decay);
    }
  }
  return buckets;
}

export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  // Centred at 0 → 0.5. A net weight of +5 maps to ~0.73; -5 to ~0.27.
  return 1 / (1 + Math.exp(-x / 3));
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
