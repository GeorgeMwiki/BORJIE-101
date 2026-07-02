/**
 * Mutation sentinel for the three load-bearing money/audit/safety
 * barriers. High line-coverage does not prove a test is EXECUTABLE — a
 * suite can touch every line and still assert nothing meaningful. This
 * sentinel proves the opposite: for each barrier we exercise the REAL
 * imported invariant function with a matched pair of inputs (a case that
 * MUST pass and a case that MUST fail), so that ANY corrupting mutation
 * of the real source — inverting the comparator, gutting the guard,
 * weakening it to `>=`, skipping the content-hash recompute, defaulting
 * fail-OPEN — flips at least one REAL assertion RED. The mutant tables
 * below are documentation of the mutation FAMILY each pair defends
 * against; the load-bearing assertions call the real functions, not
 * inline copies (an earlier version asserted local predicates and thus
 * exercised none of the real code — a false-green this file now closes).
 *
 * Runs scoped to the critical barriers only — not the whole repo (see
 * CLAUDE.md hard rules).
 *
 * Barriers under sentinel:
 *   1. LedgerService money path — `validateJournalBalance` (debits ===
 *      credits). Guards the immutable double-entry invariant.
 *   2. Audit hash-chain — `verifyChain` append-only tamper detection,
 *      probed at BOTH the first AND the last entry so a mutant that only
 *      recomputes the head hash cannot survive.
 *   3. Kill-switch — `isPilotEnabled` fail-closed (open => always false;
 *      default => false).
 */

import { describe, expect, it } from 'vitest';
import { validateJournalBalance } from '../../../services/payments-ledger/src/types.js';
import { appendEntry, verifyChain } from '../../../packages/audit-hash-chain/src/chain.js';
import type { ChainEntry } from '../../../packages/audit-hash-chain/src/types.js';
import { isPilotEnabled } from '../../../packages/feature-flags-adapter/src/pilot-kill-switch.js';

// ---------------------------------------------------------------------------
// Helper — a single line item for the ledger balance invariant.
// ---------------------------------------------------------------------------

function line(direction: 'DEBIT' | 'CREDIT', minor: number) {
  return {
    accountId: 'acc',
    direction,
    amount: { amountMinorUnits: minor, currencyCode: 'TZS' },
  } as never;
}

// ===========================================================================
// BARRIER 1 — LedgerService money path: debits === credits
//
// Mutation family this pair defends against (each would flip a real
// assertion RED because the assertions call `validateJournalBalance`):
//   - `===` -> `!==`            (invert)      : balanced would return false
//   - always-true               (gut guard)   : unbalanced would return true
//   - `===` -> `>=`             (weaken)      : over-debit would return true
//   - ignore-credits            (drop a side) : unbalanced would return true
// ===========================================================================

describe('mutation sentinel — ledger balance invariant (real validateJournalBalance)', () => {
  const balanced = [line('DEBIT', 1000), line('CREDIT', 1000)];
  const unbalanced = [line('DEBIT', 1000), line('CREDIT', 999)];
  const overDebit = [line('DEBIT', 1001), line('CREDIT', 1000)];

  it('accepts a balanced journal (mutation: invert / gut would flip this)', () => {
    expect(validateJournalBalance(balanced)).toBe(true);
  });

  it('rejects an unbalanced journal (mutation: always-true / ignore-credits would flip this)', () => {
    expect(validateJournalBalance(unbalanced)).toBe(false);
  });

  it('rejects an over-debit journal (mutation: weaken `===`->`>=` would flip this)', () => {
    // A `>=` mutant accepts debits > credits; the strict-equality real
    // implementation rejects it. This is the assertion that a comparator
    // weakening cannot survive.
    expect(validateJournalBalance(overDebit)).toBe(false);
  });
});

// ===========================================================================
// BARRIER 2 — Audit hash-chain: append-only, tamper-detected
//
// The real `verifyChain` recomputes each row's content hash. A mutation
// that skips the recompute, or that only recomputes the FIRST row, must
// flip a real assertion RED. We therefore tamper the payload (keeping the
// stored rowHash + prevHash intact) at BOTH the first AND the last entry
// and assert the real function rejects each. The last-entry case is the
// one an earlier first-entry-only test left uncovered: a mutant that only
// content-checks index 0 survived it (proven), but fails the last-entry
// assertion below.
// ===========================================================================

describe('mutation sentinel — audit hash-chain append-only (real verifyChain)', () => {
  const chain0 = appendEntry([], { event: 'licence.granted' });
  const chain1 = appendEntry(chain0, { event: 'royalty.posted' });

  function tamperPayloadAt(
    chain: ReadonlyArray<ChainEntry>,
    index: number,
  ): ChainEntry[] {
    // Change ONLY the payload; keep the stored rowHash and prevHash so the
    // only defence is the content-hash recompute inside verifyChain.
    return chain.map((e, i) =>
      i === index ? { ...e, payload: { event: 'TAMPERED' } } : e,
    );
  }

  it('accepts an intact chain', () => {
    expect(verifyChain(chain1).ok).toBe(true);
  });

  it('rejects a FIRST-entry payload tamper (mutation: skip-recompute would flip this)', () => {
    expect(verifyChain(tamperPayloadAt(chain1, 0)).ok).toBe(false);
  });

  it('rejects a LAST-entry payload tamper (mutation: only-recompute-head would flip this)', () => {
    // Coverage hole this closes: a mutant that recomputes only entry 0's
    // content hash accepts a last-entry tamper. The real verifyChain walks
    // every row, so this assertion goes RED under that mutation.
    const tampered = tamperPayloadAt(chain1, chain1.length - 1);
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenIndex).toBe(chain1.length - 1);
    expect(result.reason).toBe('row_hash_mismatch');
  });
});

// ===========================================================================
// BARRIER 3 — Kill-switch fail-closed
//
// Mutation family (each flips a real assertion because they call the real
// `isPilotEnabled`):
//   - default fail-OPEN         : unset env would return true
//   - ignore kill-switch        : open + env opt-in would return true
//   - always enabled            : unset env would return true
// ===========================================================================

describe('mutation sentinel — kill-switch fail-closed (real isPilotEnabled)', () => {
  const q = { tenantId: 'tnt_pilot' };

  it('kill-switch OPEN forces false even with env opt-in (mutation: ignore-kill-switch would flip this)', async () => {
    expect(
      await isPilotEnabled(q, {
        env: { PILOT_KILL_SWITCH_OPEN: 'true', PILOT_ENABLED: 'true' },
      }),
    ).toBe(false);
  });

  it('unset env defaults to false (mutation: default-fail-open / always-enabled would flip this)', async () => {
    expect(await isPilotEnabled(q, { env: {} })).toBe(false);
  });

  it('explicit env opt-in enables (guards against an over-correction that never enables)', async () => {
    expect(await isPilotEnabled(q, { env: { PILOT_ENABLED: 'true' } })).toBe(true);
  });
});
