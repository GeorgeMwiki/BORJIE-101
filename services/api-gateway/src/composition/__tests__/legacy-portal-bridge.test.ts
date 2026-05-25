/**
 * legacy-portal-bridge tests — Central Command Phase B (B6).
 *
 * Coverage:
 *   1. Login flow: vault → page open → fill PIN/password → click Login
 *   2. Filing flow: navigate → fill rental income → submit
 *   3. Confirmation detected via AXTree diff (alert "Return filed successfully")
 *   4. Credentials missing in vault → ok=false, credentials-not-found
 *   5. Login failure (no "File Return" cta after click) → dashboard-cta-missing
 *   6. Submit success but no confirmation alert → confirmation-not-detected
 *   7. Bridge captures step audit trail for every action
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createKraFilingBridge,
  type PortalCredentialVault,
} from '../legacy-portal-bridge';
import type {
  DrivablePage,
  LegacyPortalAction,
  ActionResult,
  AxTreeSnapshot,
} from '@borjie/browser-perception';

/**
 * Mini-fake driver — bypasses Playwright entirely. The bridge code
 * only depends on `openPortal()` and `act()`; we script the sequence
 * of `act()` responses so the bridge logic is exercised end-to-end.
 */
class FakeDriver {
  private scripted: ActionResult[];
  private call = 0;
  public readonly actions: LegacyPortalAction[] = [];
  constructor(scripted: ActionResult[]) {
    this.scripted = scripted;
  }
  async openPortal(_url: string): Promise<AxTreeSnapshot> {
    return {
      capturedAt: new Date().toISOString(),
      nodeCount: 0,
      truncated: false,
      root: null,
    };
  }
  async act(action: LegacyPortalAction): Promise<ActionResult> {
    this.actions.push(action);
    const i = this.call;
    this.call += 1;
    const out = this.scripted[i] ?? {
      ok: false,
      verb: action.verb,
      reason: 'no-script',
      postActionSnapshot: {
        capturedAt: new Date().toISOString(),
        nodeCount: 0,
        truncated: false,
        root: null,
      },
      diff: { added: [], removed: [], changed: [], identical: true },
    };
    return out;
  }
}

function emptyDiff() {
  return { added: [], removed: [], changed: [], identical: true } as const;
}

function emptySnap(): AxTreeSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    nodeCount: 0,
    truncated: false,
    root: null,
  };
}

function okAct(verb: LegacyPortalAction['verb']): ActionResult {
  return {
    ok: true,
    verb,
    postActionSnapshot: emptySnap(),
    diff: emptyDiff(),
  };
}

function vault(map: Record<string, { username: string; password: string }>): PortalCredentialVault {
  return {
    fetch: async (key) => map[key] ?? null,
  };
}

function pageFactory(): () => Promise<DrivablePage> {
  return async () =>
    ({
      url: () => 'about:blank',
      accessibility: { snapshot: async () => null },
      goto: async () => undefined,
      getByRole: () => ({
        click: async () => undefined,
        fill: async () => undefined,
      }),
    }) as unknown as DrivablePage;
}

describe('createKraFilingBridge', () => {
  it('happy path: logs in, navigates, submits, detects confirmation', async () => {
    // Scripted action results: fill PIN, fill password, login (with
    // "File Return" cta appearing), click File Return, fill income,
    // submit (with "Return filed successfully" alert appearing).
    const scripted: ActionResult[] = [
      okAct('fill'), // PIN
      okAct('fill'), // Password
      {
        ok: true,
        verb: 'click',
        postActionSnapshot: emptySnap(),
        diff: {
          added: [
            {
              key: 'k',
              role: 'button',
              name: 'File Return',
              path: '0',
            },
          ],
          removed: [],
          changed: [],
          identical: false,
        },
      },
      okAct('click'), // Navigate to filing
      okAct('fill'), // Income
      {
        ok: true,
        verb: 'submit',
        postActionSnapshot: emptySnap(),
        diff: {
          added: [
            {
              key: 'k',
              role: 'alert',
              name: 'Return filed successfully',
              path: '0',
            },
          ],
          removed: [],
          changed: [],
          identical: false,
        },
      },
    ];

    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
    });

    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.filed).toBe(true);
    expect(outcome.confirmationText).toBe('Return filed successfully');
    expect(outcome.steps).toHaveLength(6);
    expect(fake.actions.map((a) => a.verb)).toEqual([
      'fill',
      'fill',
      'click',
      'click',
      'fill',
      'submit',
    ]);
  });

  it('returns credentials-not-found when vault is empty', async () => {
    const fake = new FakeDriver([]);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({}),
      vaultKey: (t) => `kra:${t}`,
    });

    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toBe('credentials-not-found');
    expect(outcome.steps).toHaveLength(0);
  });

  it('bails when dashboard CTA is missing after login click', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'),
      okAct('fill'),
      // Login click "succeeds" but diff has no File Return button.
      okAct('click'),
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toBe('dashboard-cta-missing');
  });

  it('reports login-failed when the login click does not succeed', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'),
      okAct('fill'),
      {
        ok: false,
        verb: 'click',
        reason: 'control-not-found',
        postActionSnapshot: emptySnap(),
        diff: emptyDiff(),
      },
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toMatch(/login-failed/);
  });

  it('reports confirmation-not-detected when submit succeeds with no alert', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'),
      okAct('fill'),
      {
        ok: true,
        verb: 'click',
        postActionSnapshot: emptySnap(),
        diff: {
          added: [
            {
              key: 'k',
              role: 'button',
              name: 'File Return',
              path: '0',
            },
          ],
          removed: [],
          changed: [],
          identical: false,
        },
      },
      okAct('click'),
      okAct('fill'),
      // submit succeeds but no alert appears in diff
      okAct('submit'),
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toBe('confirmation-not-detected');
  });
});
