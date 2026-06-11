/**
 * turn-commitment-hooks.ts — the chat-turn PRE/POST hooks that make the durable
 * plan FELT in the conversation (the LIVING-MD organ's felt diff).
 *
 * THE TWO HOOKS (SOTA grounding)
 * ------------------------------
 * PRE-TURN  (Magentic-One outer task-ledger RE-READ every loop + the felt-plan
 *           "never trust memory between ticks — re-read the ledger" rail):
 *           before the turn builds its dispatch plan, read the commitment state
 *           FRESH and, when there is a backlog worth surfacing (overdue / newly
 *           due / new-since-last-turn), build a SINGLE-LANGUAGE system context
 *           BLOCK that is injected into `retrieved_context`. This puts the
 *           backlog in the model's attention window WITHOUT the owner asking.
 *           Stale-overdue (>7d) gets a WARNING tone token. It is NOT a
 *           user-visible artifact — it is grounding context the brain reasons
 *           over, exactly like a corpus passage.
 *
 * POST-TURN (the felt-plan "reconciliation sweep must reach the conversation"
 *           rail): after the turn's juniors settle, re-read state; for each
 *           commitment that BECAME due since the last turn, surface a
 *           `commitment_state` wire event so the cockpit renders it inline
 *           ("Royalty filing just became due — I've queued a reminder."). For
 *           any newly-due SOVEREIGN item the post-turn effect requests a
 *           `mwikila_actions_inbox` DRAFT (safe-halt, max rung) — it NEVER
 *           auto-executes (the sovereign hard rail). The inbox write itself is
 *           an injected port so this module never reaches into the DB directly.
 *
 * BILINGUAL ABSOLUTISM (CLAUDE.md hard rule): the injected block + any
 * user-facing copy are SINGLE-LANGUAGE per the active locale — never mixed.
 *
 * No `console.*`. Pure-ish: the only side effect is the optional sovereign-draft
 * port; the hooks otherwise return data the orchestrator yields. Fail-safe:
 * a state-read fault degrades to NO injection / NO events (never breaks a turn).
 */

import type { CommitmentBrief, CommitmentState, CommitmentStatePort } from './commitment-state-port.js';
import type { GovernanceStore } from './governance-store.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

/** The wire payload for the new `commitment_state` SSE event. */
export interface CommitmentStateWireEvent {
  readonly type: 'commitment_state';
  readonly counts: CommitmentState['counts'];
  readonly deferredCount: number;
  readonly nextDueAtMs: number | null;
  /** Brief view of what just became due (single-language title chosen by caller). */
  readonly becameDue: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly titleSw: string;
    readonly kind: string;
    readonly sovereign: boolean;
  }>;
}

/** A sovereign safe-halt DRAFT request (max rung — NEVER auto-executes). */
export interface SovereignDraftRequest {
  readonly tenantId: string;
  readonly commitmentId: string;
  readonly title: string;
  readonly titleSw: string;
  readonly kind: string;
  readonly evidenceIds: ReadonlyArray<string>;
}

/** The injected port that drafts a sovereign item into mwikila_actions_inbox. */
export interface SovereignInboxDraftPort {
  draft(request: SovereignDraftRequest): Promise<void>;
}

export interface TurnCommitmentHooks {
  /**
   * PRE-TURN re-read. Returns an optional single-language system context block
   * to inject into `retrieved_context`, plus the state read (so the post-turn
   * hook can diff against it without a second read if desired).
   */
  preTurn(input: {
    readonly tenantId: string;
    readonly language: 'sw' | 'en';
    readonly lastTurnAtMs: number;
  }): Promise<{ contextBlock: string | null; state: CommitmentState | null }>;
  /**
   * POST-TURN effects. Re-reads state, emits a `commitment_state` event when a
   * commitment became due since `lastTurnAtMs`, and requests a sovereign draft
   * for any newly-due sovereign item (safe-halt — never auto-executes).
   */
  postTurn(input: {
    readonly tenantId: string;
    readonly language: 'sw' | 'en';
    readonly lastTurnAtMs: number;
  }): Promise<{ event: CommitmentStateWireEvent | null }>;
}

/** Stale-overdue warn horizon mirrored from the state port (>7d). */
const STALE_WARN_TONE = '[WARNING]';

/** Pick the single-language title per the active locale (never mixed). */
function pickTitle(brief: CommitmentBrief, language: 'sw' | 'en'): string {
  return language === 'sw' ? brief.titleSw : brief.title;
}

/**
 * Build the single-language system context block from the state. Returns null
 * when there is nothing worth surfacing (no overdue, no new, no newly-due) so
 * a calm backlog never adds noise to the prompt.
 */
export function buildContextBlock(
  state: CommitmentState,
  language: 'sw' | 'en',
): string | null {
  const { counts, becameDueSince, newSince, staleOverdue } = state;
  const hasSignal =
    counts.overdue > 0 || newSince.length > 0 || becameDueSince.length > 0;
  if (!hasSignal) return null;

  const isSw = language === 'sw';
  const lines: string[] = [];
  if (isSw) {
    lines.push(
      `Hali ya ahadi za MD (zilizoahirishwa, ${state.deferredCount} hai): ` +
        `${counts.open} wazi, ${counts.overdue} zimepitwa na wakati, ` +
        `${counts.due} zinastahili sasa, ${counts.blocked} zimezuiwa.`,
    );
    if (becameDueSince.length > 0) {
      lines.push(
        `Zimeanza kustahili tangu zamu iliyopita: ` +
          becameDueSince.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
    if (newSince.length > 0) {
      lines.push(
        `Mpya tangu zamu iliyopita: ` +
          newSince.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
    if (staleOverdue.length > 0) {
      lines.push(
        `${STALE_WARN_TONE} Zimepitwa kwa zaidi ya siku 7 (zinahitaji uangalizi): ` +
          staleOverdue.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
  } else {
    lines.push(
      `MD commitment backlog (deferred, ${state.deferredCount} live): ` +
        `${counts.open} open, ${counts.overdue} overdue, ` +
        `${counts.due} due now, ${counts.blocked} blocked.`,
    );
    if (becameDueSince.length > 0) {
      lines.push(
        `Became due since last turn: ` +
          becameDueSince.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
    if (newSince.length > 0) {
      lines.push(
        `New since last turn: ` +
          newSince.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
    if (staleOverdue.length > 0) {
      lines.push(
        `${STALE_WARN_TONE} Overdue >7d (flag): ` +
          staleOverdue.map((b) => pickTitle(b, language)).join('; ') +
          '.',
      );
    }
  }
  return lines.join(' ');
}

/**
 * Build the turn hooks. `sovereignInbox` is optional — when absent a newly-due
 * sovereign item is still surfaced in the `commitment_state` event but no draft
 * is filed (the surface still warns the owner; nothing auto-executes either way).
 */
export function createTurnCommitmentHooks(deps: {
  readonly statePort: CommitmentStatePort;
  readonly governanceStore?: GovernanceStore | null;
  readonly sovereignInbox?: SovereignInboxDraftPort | null;
  readonly logger?: PinoLikeLogger;
}): TurnCommitmentHooks {
  const logger = deps.logger ?? createPinoLikeLogger('turn-commitment-hooks');

  return {
    async preTurn({ tenantId, language, lastTurnAtMs }) {
      try {
        const state = await deps.statePort.getState(tenantId, lastTurnAtMs);
        const contextBlock = buildContextBlock(state, language);
        return { contextBlock, state };
      } catch (err) {
        // Fail-safe: a backlog read fault degrades to no injection.
        logger.warn(
          {
            wiring: 'turn-commitment-hooks',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'turn-commitment-hooks: pre-turn re-read failed (no injection)',
        );
        return { contextBlock: null, state: null };
      }
    },

    async postTurn({ tenantId, language, lastTurnAtMs }) {
      try {
        // Re-read FRESH after the turn — never trust the pre-turn snapshot.
        const state = await deps.statePort.getState(tenantId, lastTurnAtMs);
        if (state.becameDueSince.length === 0) {
          return { event: null };
        }

        // Sovereign newly-due → request a safe-halt DRAFT (never auto-execute).
        if (deps.sovereignInbox) {
          for (const brief of state.becameDueSince) {
            if (!brief.sovereign) continue;
            try {
              await deps.sovereignInbox.draft({
                tenantId,
                commitmentId: brief.id,
                title: brief.title,
                titleSw: brief.titleSw,
                kind: brief.kind,
                evidenceIds: brief.evidenceIds,
              });
            } catch (err) {
              // A draft fault never blocks the conversational surface.
              logger.warn(
                {
                  wiring: 'turn-commitment-hooks',
                  tenantId,
                  commitmentId: brief.id,
                  err: err instanceof Error ? err.message : String(err),
                },
                'turn-commitment-hooks: sovereign draft failed (surface still warns)',
              );
            }
          }
        }

        const event: CommitmentStateWireEvent = {
          type: 'commitment_state',
          counts: state.counts,
          deferredCount: state.deferredCount,
          nextDueAtMs: state.nextDueAtMs,
          becameDue: state.becameDueSince.map((b) => ({
            id: b.id,
            // Carry both; the wire layer renders single-language by locale.
            title: language === 'sw' ? b.titleSw : b.title,
            titleSw: b.titleSw,
            kind: b.kind,
            sovereign: b.sovereign,
          })),
        };
        return { event };
      } catch (err) {
        logger.warn(
          {
            wiring: 'turn-commitment-hooks',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'turn-commitment-hooks: post-turn effects failed (no event)',
        );
        return { event: null };
      }
    },
  };
}
