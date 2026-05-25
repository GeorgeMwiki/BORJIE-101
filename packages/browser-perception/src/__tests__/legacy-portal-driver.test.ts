/**
 * legacy-portal-driver.ts tests — open portal, snapshot, find-by-role,
 * act vocabulary (click / fill / navigate / submit), error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LegacyPortalDriver,
  type DrivablePage,
  type LocatorLike,
} from '../legacy-portal-driver.js';
import type { RawAxNode } from '../axtree-snapshot.js';

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
