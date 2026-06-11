/**
 * legacy-portal-live-wiring.test.ts — locks the legacy-portal un-darking:
 *
 *   1. not provisioned: LEGACY_PORTAL_LIVE unset → fileKra is undefined (route
 *      keeps its honest not-provisioned envelope, no browser spawned);
 *   2. live but no vault: flag on, no vault → still undefined (honest degrade);
 *   3. live + vault + injected pageFactory: returns a WORKING fileKra that
 *      drives the REAL LegacyPortalDriver over a scripted fake DrivablePage and
 *      files successfully (provisioned path), and reports credentials-not-found
 *      when the vault has no entry for the tenant.
 *
 * The fake page is driven by the REAL driver (not a fake driver) so the live
 * wiring's `new LegacyPortalDriver({ page })` construction is exercised.
 */

import { describe, expect, it } from 'vitest';

import { createLegacyPortalLiveWiring } from '../legacy-portal-live-wiring.js';
import type { PortalCredentialVault } from '../legacy-portal-bridge.js';
import type { DrivablePage } from '@borjie/browser-perception';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

function silentLogger(): PinoLikeLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

// A raw AX node the driver's snapshot() will trim + diff.
interface RawNode {
  role: string;
  name?: string;
  children?: RawNode[];
}

function tree(children: RawNode[]): RawNode {
  return { role: 'WebArea', name: 'KRA iTax', children };
}

/**
 * A scripted fake DrivablePage. `accessibility.snapshot()` returns the tree for
 * the current step; each `getByRole().click()/fill()` advances the step so the
 * driver's before/after diff surfaces the expected CTA / alert. The snapshot
 * call order (driven by the REAL driver) is:
 *   openPortal(0) · fillPIN(1) · fillPwd(2) · loginClick(3) · fileReturnClick(4)
 *   · fillIncome(5) · submit(6)
 */
function scriptedPage(): DrivablePage {
  const loginForm: RawNode[] = [
    { role: 'textbox', name: 'KRA PIN' },
    { role: 'textbox', name: 'Password' },
    { role: 'button', name: 'Login' },
  ];
  const dashboard: RawNode[] = [{ role: 'button', name: 'File Return' }];
  const filingForm: RawNode[] = [
    { role: 'textbox', name: 'Monthly Rental Income' },
    { role: 'button', name: 'Submit' },
  ];
  const filed: RawNode[] = [{ role: 'alert', name: 'Return filed successfully' }];

  // Snapshot per step index (the tree the page shows AT that point).
  const steps: RawNode[] = [
    tree(loginForm), // 0 openPortal
    tree(loginForm), // 1 after fill PIN
    tree(loginForm), // 2 after fill password
    tree(dashboard), // 3 after login click → "File Return" appears
    tree(filingForm), // 4 after File Return click
    tree(filingForm), // 5 after fill income
    tree(filed), // 6 after submit → success alert appears
  ];

  let step = 0;
  const advance = (): void => {
    step = Math.min(step + 1, steps.length - 1);
  };

  return {
    url: () => 'https://itax.kra.go.ke/',
    accessibility: {
      snapshot: async () => steps[Math.min(step, steps.length - 1)] as never,
    },
    goto: async () => undefined,
    getByRole: (_role: string) => ({
      click: async () => {
        advance();
      },
      fill: async () => {
        advance();
      },
    }),
  } as unknown as DrivablePage;
}

function vault(
  map: Record<string, { username: string; password: string }>,
): PortalCredentialVault {
  return { fetch: async (key) => map[key] ?? null };
}

describe('createLegacyPortalLiveWiring — not provisioned', () => {
  it('returns undefined fileKra when LEGACY_PORTAL_LIVE is unset', () => {
    const wiring = createLegacyPortalLiveWiring({
      env: {},
      logger: silentLogger(),
    });
    expect(wiring.fileKra).toBeUndefined();
    expect(wiring.bound).toBe(false);
  });

  it('returns undefined when LIVE is on but no vault is configured', () => {
    const wiring = createLegacyPortalLiveWiring({
      env: { LEGACY_PORTAL_LIVE: 'true' },
      vault: null,
      logger: silentLogger(),
    });
    expect(wiring.fileKra).toBeUndefined();
    expect(wiring.bound).toBe(false);
  });
});

describe('createLegacyPortalLiveWiring — live binding', () => {
  it('returns a working fileKra that drives the real driver to a filing', async () => {
    const wiring = createLegacyPortalLiveWiring({
      env: { LEGACY_PORTAL_LIVE: '1' },
      vault: vault({
        'legacy-portal:kra:tnt-1': { username: 'A001', password: 'p' },
      }),
      pageFactory: async () => scriptedPage(),
      logger: silentLogger(),
    });

    expect(wiring.bound).toBe(true);
    expect(wiring.fileKra).toBeDefined();

    const outcome = await wiring.fileKra!({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 250_000,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.filed).toBe(true);
    expect(outcome.confirmationText).toMatch(/filed successfully/i);
    expect(outcome.steps.length).toBeGreaterThan(0);
  });

  it('honest-degrades to credentials-not-found when the vault lacks the tenant', async () => {
    const wiring = createLegacyPortalLiveWiring({
      env: { LEGACY_PORTAL_LIVE: 'yes' },
      vault: vault({}), // empty
      pageFactory: async () => scriptedPage(),
      logger: silentLogger(),
    });

    expect(wiring.bound).toBe(true);
    const outcome = await wiring.fileKra!({
      tenantId: 'tnt-1',
      periodYearMonth: '2026-05',
      monthlyRentalIncomeKes: 100_000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.filed).toBe(false);
    expect(outcome.failureReason).toBe('credentials-not-found');
  });
});
