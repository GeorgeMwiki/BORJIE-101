/**
 * Checkpoint — per-decision serialised snapshot the main loop emits
 * after every dispatch. Lets a crashed / killed worker resume from the
 * last known good point rather than replaying the whole thread.
 *
 * A Checkpoint captures:
 *   - the dispatched Decision
 *   - the DispatchResult it produced
 *   - the Plan snapshot AFTER advance()
 *   - the Budget snapshot AFTER consume()
 *
 * The SessionStore port persists checkpoints; `resumeOrCreate(threadId)`
 * returns the latest one (or seeds a fresh session). Composition root
 * wires either an in-memory or Postgres-backed store.
 */

import type { Decision, DispatchResult } from './decision.js';
import type { BudgetSnapshot } from './budget.js';
import type { PlanState } from './plan.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface TranscriptTurn {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly timestamp: string;
}

export interface Checkpoint {
  readonly threadId: string;
  readonly checkpointId: string;
  readonly turnIndex: number;
  readonly decision: Decision;
  readonly result: DispatchResult;
  readonly planSnapshot: PlanState;
  readonly budgetSnapshot: BudgetSnapshot;
  readonly transcript: ReadonlyArray<TranscriptTurn>;
  readonly capturedAt: string;
}

export interface Session {
  readonly threadId: string;
  readonly transcript: ReadonlyArray<TranscriptTurn>;
  readonly latestCheckpoint: Checkpoint | null;
}

// ─────────────────────────────────────────────────────────────────────
// SessionStore port
// ─────────────────────────────────────────────────────────────────────

export interface SessionStore {
  resumeOrCreate(threadId: string): Promise<Session>;
  checkpoint(
    session: Session,
    decision: Decision,
    result: DispatchResult,
    plan: PlanState,
    budget: BudgetSnapshot,
  ): Promise<Checkpoint>;
  /** Read-only access for replay / debug tooling. */
  history(threadId: string): Promise<ReadonlyArray<Checkpoint>>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory implementation — test fixture + early composition.
// ─────────────────────────────────────────────────────────────────────

export function createInMemorySessionStore(
  clock: () => Date = () => new Date(),
): SessionStore {
  const sessions = new Map<string, Session>();
  const ledger = new Map<string, Checkpoint[]>();
  let cpCounter = 0;

  async function resumeOrCreate(threadId: string): Promise<Session> {
    const existing = sessions.get(threadId);
    if (existing) return existing;
    const fresh: Session = {
      threadId,
      transcript: [],
      latestCheckpoint: null,
    };
    sessions.set(threadId, fresh);
    return fresh;
  }

  async function checkpoint(
    session: Session,
    decision: Decision,
    result: DispatchResult,
    plan: PlanState,
    budget: BudgetSnapshot,
  ): Promise<Checkpoint> {
    cpCounter += 1;
    const cp: Checkpoint = {
      threadId: session.threadId,
      checkpointId: `cp_${cpCounter.toString(36)}`,
      turnIndex: budget.usage.turns,
      decision,
      result,
      planSnapshot: plan,
      budgetSnapshot: budget,
      transcript: session.transcript,
      capturedAt: clock().toISOString(),
    };
    const arr = ledger.get(session.threadId) ?? [];
    ledger.set(session.threadId, [...arr, cp]);
    sessions.set(session.threadId, {
      ...session,
      latestCheckpoint: cp,
    });
    return cp;
  }

  async function history(
    threadId: string,
  ): Promise<ReadonlyArray<Checkpoint>> {
    return ledger.get(threadId) ?? [];
  }

  return { resumeOrCreate, checkpoint, history };
}
