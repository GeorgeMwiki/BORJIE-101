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

/** A snapshot whose AXTree carries a control with `name` (for guards). */
function snapWithControl(role: string, name: string): AxTreeSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    nodeCount: 1,
    truncated: false,
    root: {
      role: 'WebArea',
      name: 'iTax',
      children: [{ role, name }],
    },
  };
}

/** A successful click whose post-action snapshot trips a portal guard. */
function actTrippingGuard(
  verb: LegacyPortalAction['verb'],
  role: string,
  name: string,
): ActionResult {
  return {
    ok: true,
    verb,
    postActionSnapshot: snapWithControl(role, name),
    diff: emptyDiff(),
  };
}

/** An ambiguous control resolution (halt-for-help) result. */
function actAmbiguous(verb: LegacyPortalAction['verb']): ActionResult {
  return {
    ok: false,
    verb,
    reason: 'control-ambiguous',
    candidates: [
      { role: 'textbox', name: 'Taxpayar Numbar', score: 0.86 },
      { role: 'textbox', name: 'Taxpeyer Numbor', score: 0.84 },
    ],
    postActionSnapshot: emptySnap(),
    diff: emptyDiff(),
  };
}

/** Login click that surfaces the dashboard CTA (success). */
function actLoginOk(): ActionResult {
  return {
    ok: true,
    verb: 'click',
    postActionSnapshot: emptySnap(),
    diff: {
      added: [{ key: 'k', role: 'button', name: 'File Return', path: '0' }],
      removed: [],
      changed: [],
      identical: false,
    },
  };
}

/** Submit click that surfaces the success alert. */
function actSubmitOk(): ActionResult {
  return {
    ok: true,
    verb: 'submit',
    postActionSnapshot: emptySnap(),
    diff: {
      added: [
        { key: 'k', role: 'alert', name: 'Return filed successfully', path: '0' },
      ],
      removed: [],
      changed: [],
      identical: false,
    },
  };
}

const instantSleep = async (): Promise<void> => undefined;

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

describe('createKraFilingBridge — SOTA robust loop', () => {
  function happyScript(): ActionResult[] {
    return [
      okAct('fill'), // PIN
      okAct('fill'), // password
      actLoginOk(), // login → File Return CTA
      okAct('click'), // navigate to filing
      okAct('fill'), // income
      actSubmitOk(), // submit → success alert
    ];
  }

  it('halts-for-help with askBrain + candidates on an ambiguous control', async () => {
    // First step (fill PIN) is ambiguous → the loop stops and asks the
    // brain to re-plan. NOT a throw, NOT a failure of the whole task.
    const fake = new FakeDriver([actAmbiguous('fill')]);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.filed).toBe(false);
    expect(outcome.askBrain).toBe(true);
    expect(outcome.failureReason).toBe('action-ambiguity');
    expect(outcome.candidates?.length).toBe(2);
  });

  it('auto-re-logs-in once when the session expires after login, then files', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'), // PIN
      okAct('fill'), // password
      // login #1 succeeds but the page shows a "session expired" state.
      actTrippingGuard(
        'click',
        'heading',
        'Your session expired — please log in again',
      ),
      // login #2 (auto-re-login) succeeds with the dashboard CTA.
      actLoginOk(),
      okAct('click'), // navigate
      okAct('fill'), // income
      actSubmitOk(), // submit success
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.filed).toBe(true);
    // Two login clicks were issued (original + one auto-re-login).
    expect(fake.actions.filter((a) => a.verb === 'click').length).toBe(3); // 2 login + 1 nav
  });

  it('escalates (no throw) when the session is STILL expired after the single re-login', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'),
      okAct('fill'),
      actTrippingGuard('click', 'heading', 'session expired'),
      actTrippingGuard('click', 'heading', 'session expired'), // re-login still walled
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toBe('session-expired-after-login');
  });

  it('surfaces captcha-required (no throw) when a CAPTCHA appears post-login', async () => {
    const scripted: ActionResult[] = [
      okAct('fill'),
      okAct('fill'),
      actTrippingGuard('click', 'img', "I'm not a robot"),
    ];
    const fake = new FakeDriver(scripted);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.filed).toBe(false);
    expect(outcome.failureReason).toBe('captcha-required');
  });

  it('replays a successful filing from the idempotency cache on re-invoke (no re-drive)', async () => {
    const fake = new FakeDriver(happyScript());
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const input = {
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    };
    const first = await fileKraReturn(input);
    expect(first.ok).toBe(true);
    expect(first.idempotentReplay).toBeUndefined();
    const actionsAfterFirst = fake.actions.length;

    const second = await fileKraReturn(input);
    expect(second.ok).toBe(true);
    expect(second.filed).toBe(true);
    expect(second.idempotentReplay).toBe(true);
    expect(second.confirmationText).toBe('Return filed successfully');
    // The driver was NOT re-invoked on the cached replay.
    expect(fake.actions.length).toBe(actionsAfterFirst);
  });

  it('expires the idempotency cache after the TTL and re-drives', async () => {
    let clock = 1_000_000;
    const fake = new FakeDriver([...happyScript(), ...happyScript()]);
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
      now: () => clock,
      idempotencyTtlMs: 5 * 60 * 1000,
    });
    const input = {
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    };
    const first = await fileKraReturn(input);
    expect(first.ok).toBe(true);
    const afterFirst = fake.actions.length;

    // Advance past the 5-minute TTL → cache expired → re-drive.
    clock += 5 * 60 * 1000 + 1;
    const second = await fileKraReturn(input);
    expect(second.ok).toBe(true);
    expect(second.idempotentReplay).toBeUndefined();
    expect(fake.actions.length).toBeGreaterThan(afterFirst);
  });

  it('records per-step attempt counts in the audit trail', async () => {
    const fake = new FakeDriver(happyScript());
    const fileKraReturn = createKraFilingBridge({
      driverFactory: () => fake as unknown as never,
      pageFactory: pageFactory(),
      vault: vault({ 'kra:tnt-1': { username: 'A001', password: 'p' } }),
      vaultKey: (t) => `kra:${t}`,
      sleep: instantSleep,
    });
    const outcome = await fileKraReturn({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    });
    expect(outcome.steps).toHaveLength(6);
    expect(outcome.steps.every((s) => (s.attempts ?? 0) >= 1)).toBe(true);
  });
});
