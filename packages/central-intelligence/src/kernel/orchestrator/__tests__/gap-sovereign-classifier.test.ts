/**
 * Gap sovereign classifier + detection-seam derivation (Loop A, P0 — FIX 2).
 *
 * Proves a gap born from a SOVEREIGN tool/intent is classified `sovereign=true`
 * (so the auto-completer parks it, never auto-actuates) and that the dispatcher
 * DETECTION SEAM derives that flag from the SAME policy-gate rail and threads it
 * onto the `GapDetectorPort.recordUnwiredOrganGap` input. A benign organ gap is
 * classified `sovereign=false`.
 */

import { describe, it, expect } from 'vitest';

import {
  isSovereignGapSource,
  isSovereignCompetenceDomain,
} from '../gap-sovereign-classifier.js';
import {
  createToolDispatcher,
  type GapDetectorPort,
} from '../tool-dispatcher.js';
import type { HookContext } from '../hook-chain.js';
import type { Decision } from '../decision.js';

function ctx(): HookContext {
  return {
    threadId: 'thr-1',
    scope: { kind: 'tenant', tenantId: 'T' } as HookContext['scope'],
    tier: 'tenant',
    userMessage: 'do the thing',
    tickStartedAt: 0,
  };
}

/** A registry whose tool always resolves to a NOT_YET_WIRED organ. */
function unwiredRegistry() {
  return {
    async runTool() {
      return {
        kind: 'executor-failed' as const,
        message: 'adapter not yet wired',
      };
    },
  };
}

/** A capturing GapDetectorPort that records the derived `sovereign` flag. */
function capturingDetector(): {
  readonly port: GapDetectorPort;
  readonly seen: Array<{ readonly toolName: string; readonly sovereign: boolean }>;
} {
  const seen: Array<{ readonly toolName: string; readonly sovereign: boolean }> =
    [];
  return {
    seen,
    port: {
      async recordUnwiredOrganGap({ toolName, sovereign }) {
        seen.push({ toolName, sovereign });
      },
    },
  };
}

describe('isSovereignGapSource (reuses the policy-gate rail)', () => {
  it('classifies money / licence-suspension / deletion / four-eye sources sovereign', () => {
    expect(
      isSovereignGapSource({ toolName: 'platform.suspend_licence', intent: 'x' }),
    ).toBe(true);
    expect(
      isSovereignGapSource({ toolName: 'md:disburse-royalty', intent: 'x' }),
    ).toBe(true);
    expect(
      isSovereignGapSource({ toolName: 'sovereign:cross-tenant-read', intent: 'x' }),
    ).toBe(true);
    expect(
      isSovereignGapSource({ toolName: 'md:set-killswitch', intent: 'x' }),
    ).toBe(true);
    // Derived from the intent text alone (the tool name is generic).
    expect(
      isSovereignGapSource({
        toolName: 'platform.run',
        intent: 'disburse the operator payout to the bank',
      }),
    ).toBe(true);
  });

  it('classifies a benign organ source as NOT sovereign', () => {
    expect(
      isSovereignGapSource({
        toolName: 'platform.list_sites',
        intent: 'read the site register',
      }),
    ).toBe(false);
    expect(
      isSovereignGapSource({ toolName: 'forecast.run', intent: 'project tonnage' }),
    ).toBe(false);
  });

  // ── FIX 2 — lexeme/STEM hardening: NAME + intent ALONE (no domain) ──────────

  it('a payout/licence/delete tool NAME with NO competence_domain still parks (FIX 2)', () => {
    // The detection seam (tool-dispatcher) has NO competence_domain — sovereignty
    // MUST be catchable from the tool NAME alone via the lexeme/stem scan.
    for (const toolName of [
      'estate.payout_operator', // pay* stem
      'estate.payments_run', // pay* stem (plural)
      'ledger.disbursement', // disburse stem
      'ledger.settlement_close', // settle* stem
      'treasury.remit_funds', // remit + treasury stems
      'bank.wire_out', // wire stem
      'wallet.withdraw_balance', // withdraw stem
      'ledger.refund_buyer', // refund stem
      'royalty.recompute', // royalty stem
      'licence.renew_permit', // licence + permit stems
      'operator.revoke_access', // revoke stem
      'records.delete_entity', // delete stem
      'records.remove_row', // remove stem
      'storage.erase_blob', // erase stem
      'records.destroy_archive', // destroy stem
      'invoice.void_entry', // void stem
    ]) {
      expect(
        isSovereignGapSource({ toolName, intent: 'do the thing' }),
        `${toolName} should classify sovereign`,
      ).toBe(true);
    }
    // From the free-text INTENT alone (generic tool name).
    expect(
      isSovereignGapSource({
        toolName: 'platform.run',
        intent: 'please settle the outstanding royalty settlement to the operator',
      }),
    ).toBe(true);
  });

  it('catches verb->noun and y->ies INFLECTIONS via morphological roots (fail-closed)', () => {
    // The previous full-word stems missed these inflected forms; the roots fix it.
    for (const toolName of [
      'estate.royalties_export', // royalt root (y->ies)
      'group.treasuries_sweep', // treasur root (y->ies)
      'gdpr.erasure_request', // eras root (verb->noun)
      'licence.revocation_notice', // revoc root (verb->noun)
      'records.removal_batch', // remov root (verb->noun)
      'archive.destruction_order', // destr root (verb->noun)
      'rtbf.deletion_run', // delet root (delete->deletion)
      'permit.suspension_order', // suspen root (suspend->suspension)
      'ledger.disbursements_q3', // disburs root (plural noun)
      'kyc.licensing_review', // licen root (license->licensing)
    ]) {
      expect(
        isSovereignGapSource({ toolName, intent: 'do the thing' }),
        `${toolName} (inflection) should classify sovereign`,
      ).toBe(true);
    }
    // Benign tools that merely SHARE a leading substring must stay non-sovereign.
    for (const benign of ['forecast.run', 'list_sites', 'compute_metrics', 'report.display']) {
      expect(
        isSovereignGapSource({ toolName: benign, intent: 'read only' }),
        `${benign} should stay benign`,
      ).toBe(false);
    }
  });

  it('a benign tool with NO domain stays NOT sovereign under the lexeme scan (FIX 2)', () => {
    for (const toolName of [
      'forecast.run',
      'platform.list_sites',
      'site.read_register',
      'tonnage.project',
      'estate.compute_metric',
      'report.generate_summary',
    ]) {
      expect(
        isSovereignGapSource({ toolName, intent: 'read and summarize' }),
        `${toolName} should stay benign`,
      ).toBe(false);
    }
  });

  // ── FIX 3 — fail CLOSED on the sovereign-DOMAIN edge ───────────────────────

  it('a money/licence-DOMAIN gap with NO sovereign verb still parks (fail closed)', () => {
    // The tool name + intent carry NO sovereign verb stem — under the verb scan
    // alone this would be classified benign. But the gap competence domain is a
    // sovereign domain, so it MUST park (never auto-actuate a money/licence gap).
    expect(
      isSovereignGapSource({
        toolName: 'platform.run',
        intent: 'do the thing the owner asked',
        competenceDomain: 'treasury',
      }),
    ).toBe(true);
    expect(
      isSovereignGapSource({
        toolName: 'estate.compute',
        intent: 'compute the figure',
        competenceDomain: 'licences',
      }),
    ).toBe(true);
    expect(
      isSovereignGapSource({
        toolName: 'estate.compute',
        intent: 'compute the figure',
        competenceDomain: 'payout',
      }),
    ).toBe(true);
    // The SAME generic tool/intent WITHOUT a sovereign domain stays benign — the
    // domain edge is the only thing that flips it (no over-broad classification).
    expect(
      isSovereignGapSource({
        toolName: 'platform.run',
        intent: 'do the thing the owner asked',
        competenceDomain: 'forecast',
      }),
    ).toBe(false);
    expect(
      isSovereignGapSource({
        toolName: 'platform.run',
        intent: 'do the thing the owner asked',
      }),
    ).toBe(false);
  });

  it('isSovereignCompetenceDomain derives the set from the policy-gate source', () => {
    // Money / treasury / licence / royalty / payout / settlement / deletion are
    // sovereign domains (derived from HIGH_RISK_LITERAL_ONLY_PREFIXES); benign
    // estate domains are not.
    for (const d of [
      'money',
      'treasury',
      'licence',
      'licences',
      'royalty',
      'payout',
      'settlement',
      'deletion',
      'TREASURY', // case-insensitive
      ' licences ', // whitespace-tolerant
    ]) {
      expect(isSovereignCompetenceDomain(d)).toBe(true);
    }
    for (const d of ['forecast', 'sites', 'workforce', '', null, undefined]) {
      expect(isSovereignCompetenceDomain(d)).toBe(false);
    }
  });
});

describe('tool-dispatcher detection seam derives sovereign (FIX 2)', () => {
  it('a sovereign tool is recorded sovereign=true (parks downstream)', async () => {
    const detector = capturingDetector();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: detector.port,
    });
    await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: 'platform.suspend_licence', input: {}, callId: 'c1' },
      } as Decision,
      ctx(),
    );
    expect(detector.seen).toHaveLength(1);
    expect(detector.seen[0]).toEqual({
      toolName: 'platform.suspend_licence',
      sovereign: true,
    });
  });

  it('a benign organ is recorded sovereign=false', async () => {
    const detector = capturingDetector();
    const dispatcher = createToolDispatcher({
      registry: unwiredRegistry() as never,
      gapDetector: detector.port,
    });
    await dispatcher.dispatch(
      {
        kind: 'tool_call',
        call: { toolName: 'platform.list_sites', input: {}, callId: 'c1' },
      } as Decision,
      ctx(),
    );
    expect(detector.seen[0]).toEqual({
      toolName: 'platform.list_sites',
      sovereign: false,
    });
  });
});
