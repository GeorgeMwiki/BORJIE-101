/**
 * Legacy-portal bridge — Central Command Phase B (B6) example wiring.
 *
 * Wires the {@link LegacyPortalDriver} to a fictional KRA iTax filing
 * surface so the brain can `platform.legacy.file_kra_via_browser`
 * without a real KRA API (none exists for our use case as of 2026Q1).
 *
 * The bridge is a thin orchestrator on top of `@borjie/browser-perception`:
 *
 *   1. Open portal at `https://itax.kra.go.ke/`
 *   2. Fill KRA PIN + password
 *   3. Click Login → confirm dashboard reachable via AXTree diff
 *   4. Navigate to "File Monthly Return"
 *   5. Fill Monthly Rental Income fields
 *   6. Click Submit → confirm "Return filed successfully" appears in
 *      the post-action diff
 *
 * Credentials NEVER live in code or env — they come from the
 * platform's secret-vault adapter ({@link PortalCredentialVault}). The
 * vault is a port: production wires to AWS Secrets Manager / Doppler /
 * Vault; tests pass an in-memory stub.
 *
 * Production caveat (before flipping to real KRA — #33): this code does
 * NOT call the real iTax portal — the real driver should be invoked
 * from a Playwright runtime in a hardened sandbox (separate VPC, IP
 * whitelist on KRA side, retry budget, idempotency hash). The mock
 * driver used in tests simulates the AXTree snapshot/diff cycle so the
 * bridge logic stays exercised.
 */

import {
  LegacyPortalDriver,
  type DrivablePage,
  type ActionResult,
} from '@borjie/browser-perception';

export interface PortalCredentialVault {
  readonly fetch: (
    key: string,
  ) => Promise<{ username: string; password: string; mfaCode?: string } | null>;
}

export interface KraFilingInput {
  readonly tenantId: string;
  readonly periodYearMonth: string; // e.g. "2026-05"
  readonly monthlyRentalIncomeKes: number;
  readonly expensesKes?: number;
}

export interface KraFilingOutcome {
  readonly ok: boolean;
  readonly filed: boolean;
  readonly confirmationText?: string;
  readonly failureReason?: string;
  /** Action-by-action audit trail — kept for IETF Agent Audit Trail compliance. */
  readonly steps: ReadonlyArray<{
    readonly verb: string;
    readonly ok: boolean;
    readonly reason?: string;
  }>;
}

export interface KraFilingBridgeOptions {
  readonly driverFactory: (page: DrivablePage) => LegacyPortalDriver;
  readonly pageFactory: () => Promise<DrivablePage>;
  readonly vault: PortalCredentialVault;
  /** Vault key the bridge looks up to fetch the tenant's iTax creds. */
  readonly vaultKey: (tenantId: string) => string;
}

/**
 * Construct the KRA filing bridge. Returns a function the brain tool
 * `platform.legacy.file_kra_via_browser` invokes.
 */
export function createKraFilingBridge(opts: KraFilingBridgeOptions) {
  return async function fileKraReturn(
    input: KraFilingInput,
  ): Promise<KraFilingOutcome> {
    const steps: Array<{ verb: string; ok: boolean; reason?: string }> = [];
    const record = (res: ActionResult): void => {
      steps.push({
        verb: res.verb,
        ok: res.ok,
        ...(res.reason !== undefined ? { reason: res.reason } : {}),
      });
    };

    const creds = await opts.vault.fetch(opts.vaultKey(input.tenantId));
    if (!creds) {
      return {
        ok: false,
        filed: false,
        failureReason: 'credentials-not-found',
        steps,
      };
    }

    const page = await opts.pageFactory();
    const driver = opts.driverFactory(page);

    try {
      await driver.openPortal('https://itax.kra.go.ke/');

      // Step 1 — fill PIN
      record(
        await driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /KRA PIN/i,
          value: creds.username,
        }),
      );

      // Step 2 — fill password
      record(
        await driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /password/i,
          value: creds.password,
        }),
      );

      // Step 3 — login
      const loginResult = await driver.act({
        verb: 'click',
        role: 'button',
        name: /login/i,
      });
      record(loginResult);
      if (!loginResult.ok) {
        return {
          ok: false,
          filed: false,
          failureReason: `login-failed:${loginResult.reason ?? 'unknown'}`,
          steps,
        };
      }

      // Verify dashboard is reachable via AX diff (a "File Return" CTA
      // appears post-login).
      const dashboardReady = loginResult.diff.added.some(
        (e) => e.role === 'button' && /file return/i.test(e.name ?? ''),
      );
      if (!dashboardReady) {
        return {
          ok: false,
          filed: false,
          failureReason: 'dashboard-cta-missing',
          steps,
        };
      }

      // Step 4 — navigate to filing surface
      record(
        await driver.act({
          verb: 'click',
          role: 'button',
          name: /file return/i,
        }),
      );

      // Step 5 — fill rental income field
      record(
        await driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /monthly rental income/i,
          value: String(input.monthlyRentalIncomeKes),
        }),
      );

      // Step 6 — submit
      const submitResult = await driver.act({
        verb: 'submit',
        role: 'button',
        name: /submit/i,
      });
      record(submitResult);
      if (!submitResult.ok) {
        return {
          ok: false,
          filed: false,
          failureReason: `submit-failed:${submitResult.reason ?? 'unknown'}`,
          steps,
        };
      }

      // Confirm a success alert appears in the diff. This is the
      // load-bearing assertion — without it we'd report success on a
      // page that silently rolled back.
      const success = submitResult.diff.added.find(
        (e) =>
          e.role === 'alert' &&
          /filed successfully|submitted successfully/i.test(e.name ?? ''),
      );
      if (!success) {
        return {
          ok: false,
          filed: false,
          failureReason: 'confirmation-not-detected',
          steps,
        };
      }

      return {
        ok: true,
        filed: true,
        confirmationText: success.name,
        steps,
      };
    } catch (err) {
      return {
        ok: false,
        filed: false,
        failureReason:
          err instanceof Error ? err.message : 'unknown-bridge-error',
        steps,
      };
    }
  };
}
