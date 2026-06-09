/**
 * K-1 (the body-change meta-rail) — tests.
 *
 * Proves the deny-stub at `orchestrator-bindings.ts` is replaced with the
 * REAL gated authorizer that composes `decideAutonomy` + the rail verdict +
 * `checkBodyChangeInviolable` (the kernel meta-rail):
 *
 *   - DEFAULT-ON kill-switch (Wave 1 conductor, OK-7): an unset
 *     `BORJIE_BODY_CHANGE` ARMS the real authorizer; only an explicit
 *     off/0/false/no selects the deny-stub;
 *   - enabled → a REVERSIBLE construction (register_skill / register_workflow
 *     / spawn_tab) is AUTHORIZED;
 *   - enabled → a money / licence / deletion / sovereign target is DENIED
 *     (forced to FOUR-EYES / HITL by the rail) — the meta-rail can only ever
 *     escalate, never relax a sovereign rail;
 *   - FAIL-SAFE — an authorizer fault returns {authorized:false} (HITL),
 *     never throws into a paying turn.
 */

import { describe, it, expect } from 'vitest';

import { buildBodyChangePort } from '../orchestrator-bindings';
import type { orchestrator } from '@borjie/central-intelligence';

type BodyChangeRequest = orchestrator.BodyChangeRequest;

// DEFAULT-ON: an unset flag (empty env) arms the authorizer.
const ON = {} as const;
const OFF = { BORJIE_BODY_CHANGE: 'off' } as const;

function req(over: Partial<BodyChangeRequest> = {}): BodyChangeRequest {
  return {
    kind: 'register_skill',
    tenantId: 'tenant-A',
    subjectId: 'skill_arrears_summary',
    reason: 'recurring arrears-summary intent has no matching skill',
    ...over,
  };
}

describe('buildBodyChangePort — K-1 meta-rail authorizer', () => {
  it('explicit OFF: the deny-stub is selected (capability growth denied)', async () => {
    const port = buildBodyChangePort({ env: OFF });
    const verdict = await port.authorizeBodyChange(req());
    expect(verdict.authorized).toBe(false);
    expect(verdict.reason).toMatch(/disabled|human-gated/i);
  });

  it('DEFAULT-ON: an unset flag arms the authorizer (reversible authorized)', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(req());
    expect(verdict.authorized).toBe(true);
    expect(verdict.reason).toMatch(/auto/i);
  });

  it('flag ON: a reversible register_workflow is authorized', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        kind: 'register_workflow',
        subjectId: 'flow_weekly_site_report',
        reason: 'recurring weekly site report has no matching flow',
      }),
    );
    expect(verdict.authorized).toBe(true);
  });

  it('flag ON: a reversible spawn_tab (surface synth) is authorized', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        kind: 'spawn_tab',
        subjectId: 'tab_production_dashboard',
        reason: 'owner asked for a recurring production view',
      }),
    );
    expect(verdict.authorized).toBe(true);
  });

  it('flag ON: a MONEY target is denied (HITL) — sovereign rail not relaxed', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        kind: 'register_skill',
        subjectId: 'skill_auto_payout',
        reason: 'auto-approve a royalty payout disbursement to the ledger',
      }),
    );
    expect(verdict.authorized).toBe(false);
    expect(verdict.reason).toMatch(/HITL|gated|four_eyes/i);
  });

  it('flag ON: a LICENCE target is denied (HITL)', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        subjectId: 'skill_licence_renewal',
        reason: 'auto-decide a mining licence renewal',
      }),
    );
    expect(verdict.authorized).toBe(false);
    expect(verdict.reason).toMatch(/HITL|gated|four_eyes/i);
  });

  it('flag ON: a DELETION target is denied (HITL)', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        subjectId: 'skill_purge_records',
        reason: 'delete stale audit records automatically',
      }),
    );
    expect(verdict.authorized).toBe(false);
  });

  it('flag ON: a rail-editing construction is denied by the meta-rail (forbid)', async () => {
    const port = buildBodyChangePort({ env: ON });
    const verdict = await port.authorizeBodyChange(
      req({
        // The subject names a rail node → checkBodyChangeInviolable forbids.
        subjectId: 'policy-gate-override',
        reason: 'register a skill that bypasses the policy-gate rail',
      }),
    );
    expect(verdict.authorized).toBe(false);
  });

  it('kill-switch: only off/0/false/no disable; everything else arms', async () => {
    // Enabled: explicit on-values AND unrecognized values (default-ON).
    for (const val of ['true', 'on', 'yes', 'TRUE', '1', '', 'maybe', 'enabled']) {
      const port = buildBodyChangePort({ env: { BORJIE_BODY_CHANGE: val } });
      const verdict = await port.authorizeBodyChange(req());
      expect(verdict.authorized).toBe(true);
    }
    // Disabled: only the explicit kill values select the deny-stub.
    for (const val of ['0', 'false', 'off', 'no', 'OFF']) {
      const port = buildBodyChangePort({ env: { BORJIE_BODY_CHANGE: val } });
      const verdict = await port.authorizeBodyChange(req());
      expect(verdict.authorized).toBe(false);
    }
  });

  it('FAIL-SAFE: an authorizer fault returns HITL (never throws into a turn)', async () => {
    // Inject a fault via the audit logger (called inside the try). The
    // fail-closed envelope must DENY rather than propagate the throw into a
    // paying /ask turn.
    const throwingLogger = {
      info: () => {
        throw new Error('audit sink exploded');
      },
    };
    const port = buildBodyChangePort({ env: ON, logger: throwingLogger });
    const verdict = await port.authorizeBodyChange(req());
    expect(verdict.authorized).toBe(false);
    expect(verdict.reason).toMatch(/fault|HITL/i);
  });
});
