/**
 * Proactive nudges — the AI tells the admin things, even when the
 * admin didn't ask. Mirrors LITFIN's proactive-loop pattern: a
 * trigger source (forecast threshold breached, audit anomaly,
 * arrears ladder advanced) emits a NudgeIntent; the kernel renders
 * it through the admin's personalised persona; the result lands in
 * the admin's inbox.
 *
 * The kernel side is intentionally thin — most of the value is in
 * the trigger sources outside (forecasting, audit, etc.). This
 * module owns:
 *
 *   - the NudgeIntent / Nudge shapes
 *   - a NudgeRouter that turns intents → kernel thoughts → Nudges
 *   - a tiny dedupe + cooldown layer so the admin isn't spammed
 */

import type { BrainKernel } from './kernel.js';
import type { BrainDecision, ThoughtRequest } from './kernel-types.js';
import type { ScopeContext } from '../types.js';
import type { UserProfile } from './identity.js';

export interface NudgeIntent {
  readonly id: string;                              // dedupe key
  readonly user: UserProfile;
  readonly scope: ScopeContext;
  readonly threadId: string;
  /** What changed in the world that triggered the nudge. */
  readonly trigger: string;
  /** Severity drives stakes + verbosity. */
  readonly severity: 'info' | 'warn' | 'urgent';
  /** Suggested action the admin can take in one click. */
  readonly suggestedAction: string | null;
  readonly proposedAt: string;
}

export interface Nudge {
  readonly intentId: string;
  readonly text: string;
  readonly severity: NudgeIntent['severity'];
  readonly suggestedAction: string | null;
  readonly decision: BrainDecision;
  readonly deliveredAt: string;
}

export interface NudgeDedupeStore {
  /** Returns true if the intent was last delivered within `cooldownMs`. */
  isDuplicate(intentId: string, cooldownMs: number): Promise<boolean>;
  markDelivered(intentId: string, at: string): Promise<void>;
}

export interface NudgeRouterDeps {
  readonly kernel: BrainKernel;
  readonly dedupe: NudgeDedupeStore;
  readonly cooldownMs?: number;
  readonly clock?: () => Date;
}

export function createNudgeRouter(deps: NudgeRouterDeps) {
  const cooldown = deps.cooldownMs ?? 30 * 60 * 1000;
  const clock = deps.clock ?? (() => new Date());

  return {
    async route(intent: NudgeIntent): Promise<Nudge | null> {
      if (await deps.dedupe.isDuplicate(intent.id, cooldown)) return null;

      const stakes = intent.severity === 'urgent'
        ? 'high'
        : intent.severity === 'warn'
        ? 'medium'
        : 'low';
      const userMessage = renderNudgePrompt(intent);
      const req: ThoughtRequest = {
        threadId: intent.threadId,
        userMessage,
        scope: intent.scope,
        tier: intent.scope.kind === 'platform' ? 'industry' : 'org',
        stakes,
        surface: 'admin-portal',
      };
      const decision = await deps.kernel.think(req);
      const at = clock().toISOString();
      await deps.dedupe.markDelivered(intent.id, at);
      const text = decision.kind === 'refusal' ? decision.reason : decision.text;
      return {
        intentId: intent.id,
        text,
        severity: intent.severity,
        suggestedAction: intent.suggestedAction,
        decision,
        deliveredAt: at,
      };
    },
  };
}

function renderNudgePrompt(intent: NudgeIntent): string {
  return [
    `Trigger: ${intent.trigger}.`,
    `Severity: ${intent.severity}.`,
    intent.suggestedAction
      ? `Suggested action: ${intent.suggestedAction}.`
      : 'No suggested action; just inform.',
    '',
    'Tell me, in one or two sentences, what this means and whether I should act now. Lead with the headline. Do not pad.',
  ].join('\n');
}

/** In-memory dedupe for tests / dev. */
export function createInMemoryNudgeDedupe(): NudgeDedupeStore {
  const lastSeen = new Map<string, number>();
  return {
    async isDuplicate(intentId, cooldownMs) {
      const at = lastSeen.get(intentId);
      if (!at) return false;
      return Date.now() - at < cooldownMs;
    },
    async markDelivered(intentId, at) {
      lastSeen.set(intentId, Date.parse(at));
    },
  };
}
