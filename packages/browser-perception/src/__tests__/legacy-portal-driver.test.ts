/**
 * legacy-portal-driver.ts tests — open portal, snapshot, find-by-role,
 * act vocabulary (click / fill / navigate / submit), error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LegacyPortalDriver,
  type DrivablePage,
  type LocatorLike,
  type BrainPort,
} from '../legacy-portal-driver.js';
import type { RawAxNode } from '../axtree-snapshot.js';
import {
  detectMfaPrompt,
  detectCaptcha,
  detectSessionExpired,
  scanPortalGuards,
} from '../portal-guards.js';
import type { AxTreeSnapshot } from '../axtree-snapshot.js';

/** No-op sleeper so contextual-wait / retry tests run instantly. */
const instantSleep = async (): Promise<void> => undefined;

/**
 * A flag-driven page: `current()` returns the tree for the current state.
 * The locator's `click`/`fill` can mutate that state (via `onAct`), and a
 * `revealAfterCalls` counter lets a tree change after N snapshot reads —
 * modelling a slow async alert for the contextual-wait test.
 */
function makeStatefulPage(opts: {
  readonly trees: RawAxNode[];
  readonly onAct?: () => void;
  /** Reveal `trees[1]` only after this many snapshot() reads. */
  readonly revealAfterReads?: number;
  readonly clickImpl?: () => Promise<void>;
  readonly fillImpl?: () => Promise<void>;
}): {
  page: DrivablePage;
  locator: LocatorLike & {
    click: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
  };
} {
  let stage = 0;
  let reads = 0;
  const locator = {
    click: vi.fn(
      opts.clickImpl ??
        (async () => {
          opts.onAct?.();
          stage = 1;
        }),
    ),
    fill: vi.fn(
      opts.fillImpl ??
        (async () => {
          opts.onAct?.();
        }),
    ),
    count: vi.fn(async () => 1),
  };
  const page: DrivablePage = {
    url: () => 'https://itax.kra.go.ke/',
    accessibility: {
      snapshot: vi.fn(async () => {
        reads += 1;
        if (
          opts.revealAfterReads !== undefined &&
          reads >= opts.revealAfterReads
        ) {
          return opts.trees[1] ?? opts.trees[0] ?? null;
        }
        return opts.trees[stage] ?? opts.trees[0] ?? null;
      }),
    },
    goto: vi.fn(async () => undefined),
    getByRole: vi.fn(() => locator),
  };
  return { page, locator };
}

function snapWith(children: RawAxNode[]): AxTreeSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    nodeCount: children.length,
    truncated: false,
    root: { role: 'WebArea', name: 'x', children: children as never },
  };
}

function makeLocator(): LocatorLike & {
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
} {
  return {
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    count: vi.fn(async () => 1),
  };
}

function makePage(snapshots: RawAxNode[]): {
  page: DrivablePage;
  locator: ReturnType<typeof makeLocator>;
  goto: ReturnType<typeof vi.fn>;
  getByRole: ReturnType<typeof vi.fn>;
} {
  const locator = makeLocator();
  const goto = vi.fn(async () => undefined);
  const getByRole = vi.fn(() => locator);
  let i = 0;
  const accessibility = {
    snapshot: vi.fn(async () => {
      const next = snapshots[Math.min(i, snapshots.length - 1)];
      i += 1;
      return next;
    }),
  };
  const page: DrivablePage = {
    url: () => 'https://itax.kra.go.ke/',
    accessibility,
    goto,
    getByRole,
  };
  return { page, locator, goto, getByRole };
}

describe('LegacyPortalDriver', () => {
  let snapInitial: RawAxNode;
  let snapPostLogin: RawAxNode;

  beforeEach(() => {
    snapInitial = {
      role: 'WebArea',
      name: 'iTax Login',
      children: [
        { role: 'textbox', name: 'KRA PIN' },
        { role: 'textbox', name: 'Password' },
        { role: 'button', name: 'Login' },
      ],
    };
    snapPostLogin = {
      role: 'WebArea',
      name: 'iTax Dashboard',
      children: [
        { role: 'button', name: 'File Return' },
        { role: 'alert', name: 'Welcome, KRA001' },
      ],
    };
  });

  it('throws when no page is provided', () => {
    expect(() => new LegacyPortalDriver({ page: null as never })).toThrow(
      /page is required/,
    );
  });

  it('openPortal navigates + captures the initial snapshot', async () => {
    const { page, goto } = makePage([snapInitial]);
    const driver = new LegacyPortalDriver({ page });
    const snap = await driver.openPortal('https://itax.kra.go.ke/');
    expect(goto).toHaveBeenCalledWith('https://itax.kra.go.ke/');
    expect(snap.root?.name).toBe('iTax Login');
    expect(driver.getLastSnapshot()).toBe(snap);
  });

  it('findRoleByName locates a control in the current snapshot', async () => {
    const { page } = makePage([snapInitial]);
    const driver = new LegacyPortalDriver({ page });
    await driver.openPortal('https://itax.kra.go.ke/');
    const node = await driver.findRoleByName('button', /login/i);
    expect(node?.name).toBe('Login');
  });

  it('act:click invokes getByRole + locator.click and returns the diff', async () => {
    const { page, locator, getByRole } = makePage([snapInitial, snapPostLogin]);
    const driver = new LegacyPortalDriver({ page });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'click',
      role: 'button',
      name: /login/i,
    });
    expect(getByRole).toHaveBeenCalledWith('button', { name: /login/i });
    expect(locator.click).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(
      res.diff.added.some((e) => e.name === 'File Return'),
    ).toBe(true);
  });

  it('act:fill invokes locator.fill with value', async () => {
    const { page, locator } = makePage([snapInitial, snapInitial]);
    const driver = new LegacyPortalDriver({ page });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'fill',
      role: 'textbox',
      name: /KRA PIN/i,
      value: 'A001234567B',
    });
    expect(locator.fill).toHaveBeenCalledWith('A001234567B', {
      timeout: 5000,
    });
    expect(res.ok).toBe(true);
  });

  it('act:navigate calls page.goto', async () => {
    const { page, goto } = makePage([snapInitial, snapPostLogin]);
    const driver = new LegacyPortalDriver({ page });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'navigate',
      url: 'https://itax.kra.go.ke/file-return',
    });
    expect(goto).toHaveBeenCalledWith(
      'https://itax.kra.go.ke/file-return',
    );
    expect(res.ok).toBe(true);
  });

  it('act recovers gracefully when locator.click throws', async () => {
    const { page, locator } = makePage([snapInitial, snapInitial]);
    locator.click.mockRejectedValueOnce(new Error('timeout 5000ms exceeded'));
    const driver = new LegacyPortalDriver({ page });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'click',
      role: 'button',
      name: /login/i,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/timeout/);
    // post-action snapshot is still captured so the brain can see state.
    expect(res.postActionSnapshot).toBeDefined();
  });

  it('act:click reports getByRole-unavailable when page lacks the API', async () => {
    const { page } = makePage([snapInitial, snapInitial]);
    const naked: DrivablePage = {
      ...page,
      getByRole: undefined as never,
    };
    const driver = new LegacyPortalDriver({ page: naked });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'click',
      role: 'button',
      name: 'Login',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('getByRole-unavailable');
  });

  it('respects maxNodes cap when configured', async () => {
    const big: RawAxNode = {
      role: 'WebArea',
      name: 'big',
      children: Array.from({ length: 500 }, (_, i) => ({
        role: 'button',
        name: `b-${i}`,
      })),
    };
    const { page } = makePage([big]);
    const driver = new LegacyPortalDriver({ page, maxNodes: 50 });
    const snap = await driver.openPortal('https://x/');
    expect(snap.nodeCount).toBeLessThanOrEqual(50);
    expect(snap.truncated).toBe(true);
  });
});

describe('LegacyPortalDriver — SOTA robustness loop', () => {
  it('re-perceives and finds an alternate when the first snapshot lacks the control', async () => {
    // openPortal snapshots the login form WITHOUT the "Continue" button.
    // The button only appears on the re-perception snapshot, exercising
    // the chain step 2 (re-snapshot + exact match).
    const loginForm: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [{ role: 'textbox', name: 'KRA PIN' }],
    };
    const withButton: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [
        { role: 'textbox', name: 'KRA PIN' },
        { role: 'button', name: 'Continue' },
      ],
    };
    const { page, locator } = makeStatefulPage({
      trees: [loginForm, withButton],
      // The control is revealed on the re-perception snapshot.
      revealAfterReads: 2,
    });
    const driver = new LegacyPortalDriver({ page, sleep: instantSleep });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'click',
      role: 'button',
      name: /continue/i,
    });
    expect(res.ok).toBe(true);
    expect(res.confidence).toBe(1);
    expect(locator.click).toHaveBeenCalled();
  });

  it('fuzzy-resolves a renamed control and reports the confidence', async () => {
    // The portal renamed "KRA PIN Number" → "KRA PIN No"; the exact
    // (substring) match for "KRA PIN Number" misses, and fuzzy
    // Jaro-Winkler resolves it at a sub-1.0 confidence.
    const renamed: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [{ role: 'textbox', name: 'KRA PIN No' }],
    };
    const { page, locator } = makeStatefulPage({
      trees: [renamed, renamed],
    });
    const driver = new LegacyPortalDriver({ page, sleep: instantSleep });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'fill',
      role: 'textbox',
      name: 'KRA PIN Number',
      value: 'A001234567B',
    });
    expect(res.ok).toBe(true);
    expect(res.confidence).toBeGreaterThanOrEqual(0.65);
    expect(res.confidence).toBeLessThan(1);
    expect(locator.fill).toHaveBeenCalledWith('A001234567B', {
      timeout: 5000,
    });
  });

  it('surfaces control-ambiguous + candidates when two controls match equally', async () => {
    // Ask for "Taxpayer Number"; two textboxes carry near-identical
    // typo'd variants (neither a substring) that fuzzy-match with
    // near-equal scores → genuinely ambiguous → halt-for-help.
    const ambiguous: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [
        { role: 'textbox', name: 'Taxpayar Numbar' },
        { role: 'textbox', name: 'Taxpeyer Numbor' },
      ],
    };
    const { page } = makeStatefulPage({ trees: [ambiguous, ambiguous] });
    const driver = new LegacyPortalDriver({ page, sleep: instantSleep });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'fill',
      role: 'textbox',
      name: 'Taxpayer Number',
      value: 'x',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('control-ambiguous');
    expect(res.candidates?.length).toBeGreaterThanOrEqual(2);
  });

  it('reports control-not-found when nothing matches even fuzzily', async () => {
    const empty: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [{ role: 'button', name: 'Totally Unrelated Widget' }],
    };
    const { page } = makeStatefulPage({ trees: [empty, empty] });
    const driver = new LegacyPortalDriver({ page, sleep: instantSleep });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'click',
      role: 'button',
      name: 'Submit Return',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('control-not-found');
  });

  it('asks the optional brain to disambiguate and proceeds on its pick', async () => {
    const ambiguous: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [
        { role: 'textbox', name: 'Taxpayar Numbar' },
        { role: 'textbox', name: 'Taxpeyer Numbor' },
      ],
    };
    const { page, locator } = makeStatefulPage({ trees: [ambiguous, ambiguous] });
    const brain: BrainPort = {
      resolveControl: vi.fn(async () => ({
        name: 'Taxpayar Numbar',
        confidence: 0.9,
      })),
    };
    const driver = new LegacyPortalDriver({ page, brain, sleep: instantSleep });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'fill',
      role: 'textbox',
      name: 'Taxpayer Number',
      value: 'x',
    });
    expect(brain.resolveControl).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.confidence).toBe(0.9);
    expect(locator.fill).toHaveBeenCalled();
  });

  it('contextual-wait catches a late-arriving success alert', async () => {
    // The click leaves the page momentarily unchanged (diff identical),
    // then a success alert renders on a later snapshot. The driver's
    // bounded contextual re-verify must surface it.
    const beforeClick: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [{ role: 'button', name: 'Submit' }],
    };
    const withAlert: RawAxNode = {
      role: 'WebArea',
      name: 'iTax',
      children: [
        { role: 'button', name: 'Submit' },
        { role: 'alert', name: 'Return filed successfully' },
      ],
    };
    // Reads: openPortal(1), resolveControl exact on before(no read since
    // lastSnapshot reused), post-action read(2)=identical, then the
    // contextual loop reads(3+)=alert appears.
    const { page } = makeStatefulPage({
      trees: [beforeClick, withAlert],
      clickImpl: async () => undefined,
      revealAfterReads: 3,
    });
    const driver = new LegacyPortalDriver({
      page,
      sleep: instantSleep,
      verifySettleMs: 10,
      verifyMaxMs: 100,
    });
    await driver.openPortal('https://itax.kra.go.ke/');
    const res = await driver.act({
      verb: 'submit',
      role: 'button',
      name: /submit/i,
    });
    expect(res.ok).toBe(true);
    expect(res.diff.identical).toBe(false);
    expect(
      res.diff.added.some((e) => e.name === 'Return filed successfully'),
    ).toBe(true);
  });
});

describe('portal-guards', () => {
  it('detects an MFA / one-time-code prompt', () => {
    const snap = snapWith([
      { role: 'textbox', name: 'Enter the verification code' } as never,
    ]);
    const hit = detectMfaPrompt(snap);
    expect(hit.detected).toBe(true);
    expect(scanPortalGuards(snap).reason).toBe('mfa-required');
  });

  it('detects a CAPTCHA challenge', () => {
    const snap = snapWith([
      { role: 'img', name: "I'm not a robot" } as never,
    ]);
    expect(detectCaptcha(snap).detected).toBe(true);
    expect(scanPortalGuards(snap).reason).toBe('captcha-required');
  });

  it('detects an expired session', () => {
    const snap = snapWith([
      { role: 'heading', name: 'Your session expired — please log in again' } as never,
    ]);
    expect(detectSessionExpired(snap).detected).toBe(true);
    expect(scanPortalGuards(snap).reason).toBe('session-expired-after-login');
  });

  it('returns no hit on a clean page', () => {
    const snap = snapWith([
      { role: 'button', name: 'File Return' } as never,
    ]);
    expect(scanPortalGuards(snap).tripped).toBe(false);
    expect(detectMfaPrompt(snap).detected).toBe(false);
  });
});
