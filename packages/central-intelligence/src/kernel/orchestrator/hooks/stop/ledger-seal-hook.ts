/**
 * Stop: ledger-seal hook — closes the per-session audit chain by writing
 * a terminal hash that binds every dispatched decision into a single
 * tamper-evident envelope.
 *
 * Mirrors the existing audit-hash-chain primitive in
 * `@borjie/ai-copilot/security/audit-hash-chain.ts` but lives at the
 * orchestrator layer so every think() call closes its own envelope.
 *
 * Always returns `allow` — the hook is observation-only.
 */

import type {
  HookContext,
  HookResult,
  StopHook,
  StopSession,
} from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface LedgerSealPort {
  seal(args: {
    readonly threadId: string;
    readonly turnCount: number;
    readonly exhaustedAxis:
      | 'turns'
      | 'tokens'
      | 'tool-calls'
      | 'wall-ms'
      | null;
    readonly finalText: string | null;
    readonly sealedAt: string;
  }): Promise<{ readonly sealHash: string }>;
}

export interface LedgerSealHookDeps {
  readonly ledger: LedgerSealPort;
  readonly clock?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createLedgerSealHook(deps: LedgerSealHookDeps): StopHook {
  const clock = deps.clock ?? (() => new Date());
  return {
    name: 'ledger-seal',
    stage: 'stop',
    async fn(_ctx: HookContext, session: StopSession): Promise<HookResult> {
      try {
        await deps.ledger.seal({
          threadId: session.threadId,
          turnCount: session.turnCount,
          exhaustedAxis: session.exhaustedAxis,
          finalText: session.finalText,
          sealedAt: clock().toISOString(),
        });
      } catch {
        // Ledger seal failure is logged via the injected port's own
        // telemetry; the hook itself must never block the stop path.
      }
      return { kind: 'allow' };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory ledger fixture
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryLedgerSeal {
  readonly seals: ReadonlyArray<{
    readonly threadId: string;
    readonly turnCount: number;
    readonly exhaustedAxis: string | null;
    readonly sealHash: string;
    readonly sealedAt: string;
  }>;
  seal: LedgerSealPort['seal'];
}

export function createInMemoryLedgerSeal(): InMemoryLedgerSeal {
  const seals: Array<{
    threadId: string;
    turnCount: number;
    exhaustedAxis: string | null;
    sealHash: string;
    sealedAt: string;
  }> = [];
  let counter = 0;
  return {
    async seal(args): Promise<{ sealHash: string }> {
      counter += 1;
      const sealHash = `seal_${counter.toString(36)}_${args.threadId}`;
      seals.push({
        threadId: args.threadId,
        turnCount: args.turnCount,
        exhaustedAxis: args.exhaustedAxis,
        sealHash,
        sealedAt: args.sealedAt,
      });
      return { sealHash };
    },
    get seals(): ReadonlyArray<{
      threadId: string;
      turnCount: number;
      exhaustedAxis: string | null;
      sealHash: string;
      sealedAt: string;
    }> {
      return seals;
    },
  };
}
