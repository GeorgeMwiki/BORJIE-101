/**
 * Proactive nudge generator — emits a small number of "you crossed a
 * stage threshold, here's what to do next" messages per evaluation.
 *
 * Idempotency: every nudge has a stable id keyed off `(tenantId,
 * topic)`. The caller passes the last delivery records; if the same
 * nudge id was delivered within `lookbackDays` (default 14), we skip
 * re-emitting it. This prevents the user from being spammed when the
 * worker runs hourly.
 *
 * Pure functions only. The optional `StageTriggerSink` integration is
 * wired in `index.ts` (the public surface), keeping this module easy
 * to test without I/O.
 */

import { STAGE_CARDS } from '../stages/definitions.js';
import { evaluatePlaybook } from '../playbooks/index.js';
import type {
  NudgeGenerationInput,
  StageNudge,
  NudgeUrgency,
} from '../types.js';

export const DEFAULT_LOOKBACK_DAYS = 14;

interface InternalNudgeSeed {
  readonly topic: string;
  readonly urgency: NudgeUrgency;
  readonly title: string;
  readonly message: string;
  readonly suggestedActionPrompt: string;
  readonly evidence: ReadonlyArray<string>;
  readonly dismissable: boolean;
}

function makeNudgeId(tenantId: string, topic: string): string {
  // Stable hash-free id — predictable for tests and idempotency.
  return `stage-nudge:${tenantId}:${topic}`;
}

function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return 0;
  return Math.abs(bMs - aMs) / (1000 * 60 * 60 * 24);
}

function withinLookback(
  nudgeId: string,
  lookbackDays: number,
  now: string,
  history: NudgeGenerationInput['lastDeliveredAt'],
): boolean {
  for (const rec of history) {
    if (rec.nudgeId !== nudgeId) continue;
    if (daysBetween(rec.deliveredAt, now) < lookbackDays) return true;
  }
  return false;
}

/**
 * Generate the nudges that should fire for this evaluation. Filters
 * out anything that was delivered inside the lookback window. The
 * caller is responsible for persisting new delivery records after
 * emitting.
 */
export function generateStageNudges(
  input: NudgeGenerationInput,
): ReadonlyArray<StageNudge> {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const now = input.nowIso ?? input.metrics.observedAt ?? new Date().toISOString();
  const tenantId = input.metrics.tenantId;
  const stage = input.detection.stage;
  const card = STAGE_CARDS[stage];

  const seeds: InternalNudgeSeed[] = [];

  // Topic 1 — playbook next steps. Always emit when ≥1 incomplete task.
  const evaluation = evaluatePlaybook({
    playbook: card.stageOnboardingPlaybook,
    orgState: input.orgState,
    nextN: 3,
  });
  if (evaluation.nextIncompleteTasks.length > 0) {
    const first = evaluation.nextIncompleteTasks[0]!;
    seeds.push({
      topic: `playbook:${stage}:next`,
      urgency:
        evaluation.completionRatio < 0.25
          ? 'medium'
          : evaluation.completionRatio < 0.5
            ? 'low'
            : 'info',
      title: `Next up at ${card.displayName}: ${first.task.name}`,
      message: `You have ${evaluation.totalTasks - evaluation.completedTasks} task(s) left in the ${card.displayName} playbook. Want me to walk you through "${first.task.name}"?`,
      suggestedActionPrompt: `Walk me through "${first.task.name}".`,
      evidence: [
        `playbook completion ${(evaluation.completionRatio * 100).toFixed(0)}%`,
        ...evaluation.nextIncompleteTasks.map((t) => `next: ${t.task.name}`),
      ],
      dismissable: true,
    });
  }

  // Topic 2 — stage-just-changed. Fire HIGH urgency when smoothing is
  // NOT active (i.e. the stage actually graduated).
  if (!input.detection.smoothingActive && input.detection.rawStage === stage) {
    // Only fire if the stage looks like a "fresh" entry — i.e. an
    // explicit transition just happened upstream. We approximate that
    // by looking at whether ANY playbook task is incomplete (a brand-
    // new stage will have a near-empty completion ratio).
    if (evaluation.completionRatio < 0.5) {
      seeds.push({
        topic: `stage-entered:${stage}`,
        urgency: 'high',
        title: `Welcome to the ${card.displayName} stage`,
        message: `Your unit count puts you firmly in the ${card.displayName} band. Here are the focus areas I think matter most now: ${card.focusAreas.join(', ')}.`,
        suggestedActionPrompt: `Tell me more about what changes at the ${card.displayName} stage.`,
        evidence: input.detection.evidence,
        dismissable: true,
      });
    }
  }

  // Topic 3 — adjacency to next stage threshold. If unitsManaged is
  // within 10% of the next stage's `min`, emit a low-urgency heads-up.
  const nextMin = card.range.max === null ? null : card.range.max + 1;
  if (nextMin !== null) {
    const distance = nextMin - input.metrics.unitsManaged;
    if (distance > 0 && distance <= Math.max(5, Math.floor(nextMin * 0.1))) {
      seeds.push({
        topic: `approach-next:${stage}`,
        urgency: 'low',
        title: `Approaching the next stage threshold`,
        message: `You're ${distance} unit(s) away from the next stage threshold (${nextMin} units). Want a preview of what unlocks?`,
        suggestedActionPrompt: `Show me what unlocks at the next stage.`,
        evidence: [
          `current units: ${input.metrics.unitsManaged}`,
          `next threshold: ${nextMin}`,
          `distance: ${distance}`,
        ],
        dismissable: true,
      });
    }
  }

  // Topic 4 — high-churn warning at any stage. Tenant churn > 12%
  // rolling 90d is concerning regardless of size.
  if (input.metrics.tenantChurnRate > 0.12) {
    seeds.push({
      topic: `churn-warning`,
      urgency: 'high',
      title: `Tenant churn is elevated`,
      message: `Your rolling 90-day tenant churn rate is ${(
        input.metrics.tenantChurnRate * 100
      ).toFixed(1)}%. That's high enough that I'd want to dig into renewal patterns with you.`,
      suggestedActionPrompt: `Help me understand why my churn is high.`,
      evidence: [
        `churn rate: ${(input.metrics.tenantChurnRate * 100).toFixed(1)}%`,
        `threshold: 12%`,
      ],
      dismissable: true,
    });
  }

  // ─── Apply idempotency filter + assemble final nudges ─────────────
  const out: StageNudge[] = [];
  for (const seed of seeds) {
    const id = makeNudgeId(tenantId, seed.topic);
    if (withinLookback(id, lookbackDays, now, input.lastDeliveredAt)) continue;
    out.push({
      id,
      urgency: seed.urgency,
      title: seed.title,
      message: seed.message,
      suggestedActionPrompt: seed.suggestedActionPrompt,
      evidence: seed.evidence,
      dismissable: seed.dismissable,
      stage,
      generatedAt: now,
    });
  }
  return out;
}

/** Helper: derive an urgency rank for sorting (higher = more urgent). */
export function urgencyRank(u: NudgeUrgency): number {
  switch (u) {
    case 'info':
      return 0;
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'critical':
      return 4;
  }
}
