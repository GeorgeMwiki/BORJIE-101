/**
 * Legacy-portal bridge — the ROBUST driver-loop orchestrator on top of
 * `@borjie/browser-perception`.
 *
 * Wires the {@link LegacyPortalDriver} to the KRA iTax filing surface so
 * the brain can `platform.legacy.file_kra_via_browser` without a real
 * KRA API (none exists for our use case as of 2026Q1).
 *
 * SOTA loop (Browser-use / Skyvern / WebVoyager / Anthropic Computer
 * Use / AutoGPT loop discipline). Each step is a perceive → decide →
 * act → verify → re-plan cycle that NEVER bare-throws to the user:
 *
 *   1. Open portal at `https://itax.kra.go.ke/`
 *   2. Fill KRA PIN + password  (each under bounded retry + backoff)
 *   3. Click Login → confirm dashboard reachable via AXTree diff
 *   4. Navigate to "File Monthly Return"
 *   5. Fill Monthly Rental Income fields
 *   6. Click Submit → confirm "Return filed successfully" appears in
 *      the post-submit diff (the ONLY signal we treat as success)
 *
 * Every action runs through {@link retryAction} (transient faults →
 * retry with exponential backoff; fatal faults → fail fast). After each
 * action the bridge runs {@link scanPortalGuards}: a CAPTCHA / MFA /
 * session-expiry state EARLY-RETURNS a structured reason — never a
 * throw. Control ambiguity from the driver's fuzzy resolver becomes a
 * halt-for-help (`askBrain:true` + candidates) so the brain re-plans
 * mid-flow. A 5-minute idempotency cache prevents double-filing on a
 * re-invoke with the same `(tenant, period, income)`.
 *
 * Credentials NEVER live in code or env — they come from the platform's
 * secret-vault adapter ({@link PortalCredentialVault}). The vault is a
 * port: production wires to AWS Secrets Manager / Doppler / Vault; tests
 * pass an in-memory stub.
 */

import {
  LegacyPortalDriver,
  retryAction,
  scanPortalGuards,
  DEFAULT_DRIVER_RETRY_POLICY,
  type DrivablePage,
  type ActionResult,
  type ControlCandidate,
  type RetryPolicy,
  type Sleeper,
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

export interface KraFilingStep {
  readonly verb: string;
  readonly ok: boolean;
  readonly reason?: string;
  /** Attempts consumed for this step (1 = first-try success). */
  readonly attempts?: number;
}

export interface KraFilingOutcome {
  readonly ok: boolean;
  readonly filed: boolean;
  readonly confirmationText?: string;
  readonly failureReason?: string;
  /**
   * Structured halt-for-help signal. When true the loop stopped on an
   * ambiguity the brain must resolve (e.g. two controls matched). The
   * route surfaces this as `action-requires-clarification`, not an error.
   */
  readonly askBrain?: boolean;
  /** Ranked control candidates that triggered the halt-for-help. */
  readonly candidates?: ReadonlyArray<ControlCandidate>;
  /** True when this outcome was served from the idempotency cache. */
  readonly idempotentReplay?: boolean;
  /** Action-by-action audit trail — kept for IETF Agent Audit Trail compliance. */
  readonly steps: ReadonlyArray<KraFilingStep>;
}

/** Structured logger surface (Pino-shaped). Optional — defaults to no-op. */
export interface BridgeLogger {
  info?: (meta: object, message?: string) => void;
  warn?: (meta: object, message?: string) => void;
  error?: (meta: object, message?: string) => void;
}

/** Injectable clock so the idempotency TTL is testable. */
export type NowFn = () => number;

export interface KraFilingBridgeOptions {
  readonly driverFactory: (page: DrivablePage) => LegacyPortalDriver;
  readonly pageFactory: () => Promise<DrivablePage>;
  readonly vault: PortalCredentialVault;
  /** Vault key the bridge looks up to fetch the tenant's iTax creds. */
  readonly vaultKey: (tenantId: string) => string;
  /** Retry policy per step. Defaults to the package default (3 attempts). */
  readonly retryPolicy?: RetryPolicy;
  /** Injectable sleeper for retry backoff (tests pass an instant no-op). */
  readonly sleep?: Sleeper;
  /** Structured logger. Optional. */
  readonly logger?: BridgeLogger;
  /** Clock for idempotency TTL. Defaults to `Date.now`. */
  readonly now?: NowFn;
  /** Idempotency cache TTL in ms. Default 5 minutes. */
  readonly idempotencyTtlMs?: number;
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  readonly outcome: KraFilingOutcome;
  readonly expiresAt: number;
}

/** Stable idempotency key — never double-files the same period/amount. */
function idempotencyKey(input: KraFilingInput): string {
  return [
    input.tenantId,
    input.periodYearMonth,
    input.monthlyRentalIncomeKes,
    input.expensesKes ?? '',
  ].join('|');
}

function logSafe(
  logger: BridgeLogger | undefined,
  level: 'info' | 'warn' | 'error',
  meta: Record<string, unknown>,
  message: string,
): void {
  const fn = logger?.[level];
  if (typeof fn === 'function') fn({ bridge: 'legacy-portal', ...meta }, message);
}

/**
 * Construct the KRA filing bridge. Returns a function the brain tool
 * `platform.legacy.file_kra_via_browser` invokes. The returned function
 * is fail-soft: every failure path resolves to a structured
 * {@link KraFilingOutcome} — it never throws.
 */
export function createKraFilingBridge(opts: KraFilingBridgeOptions) {
  const policy = opts.retryPolicy ?? DEFAULT_DRIVER_RETRY_POLICY;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  // Per-bridge idempotency cache — keyed by (tenant, period, income).
  const idemCache = new Map<string, CacheEntry>();

  return async function fileKraReturn(
    input: KraFilingInput,
  ): Promise<KraFilingOutcome> {
    const idem = idempotencyKey(input);

    // ── Idempotency: a successful filing within the TTL is replayed
    //    from cache, never re-driven (money-adjacent: no double-filing).
    const cached = idemCache.get(idem);
    if (cached && cached.expiresAt > now()) {
      logSafe(
        opts.logger,
        'info',
        { tenantId: input.tenantId, period: input.periodYearMonth },
        'legacy-portal-bridge: idempotent replay — returning cached confirmation (no re-drive)',
      );
      return { ...cached.outcome, idempotentReplay: true };
    }
    if (cached) idemCache.delete(idem); // expired

    const steps: KraFilingStep[] = [];
    const record = (
      res: ActionResult,
      attempts: number,
    ): void => {
      steps.push({
        verb: res.verb,
        ok: res.ok,
        ...(res.reason !== undefined ? { reason: res.reason } : {}),
        attempts,
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

    let page: DrivablePage;
    let driver: LegacyPortalDriver;
    try {
      page = await opts.pageFactory();
      driver = opts.driverFactory(page);
      await driver.openPortal('https://itax.kra.go.ke/');
    } catch (err) {
      // Even a launch / navigation failure surfaces structurally.
      return {
        ok: false,
        filed: false,
        failureReason:
          err instanceof Error ? `portal-open-failed:${err.message}` : 'portal-open-failed',
        steps,
      };
    }

    // ── executeStep: run one action under bounded retry, record the
    //    attempt trail, then scan portal guards on the resulting page.
    const executeStep = async (
      driveAction: () => Promise<ActionResult>,
    ): Promise<{
      readonly result: ActionResult;
      readonly attempts: number;
      readonly guard: ReturnType<typeof scanPortalGuards>;
    }> => {
      let attempts = 0;
      const result = await retryAction(driveAction, {
        policy,
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
        onAttempt: (info) => {
          attempts = info.attempt;
          logSafe(
            opts.logger,
            info.ok ? 'info' : 'warn',
            {
              tenantId: input.tenantId,
              attempt: info.attempt,
              ok: info.ok,
              ...(info.reason ? { reason: info.reason } : {}),
              transient: info.transient,
              willRetry: info.willRetry,
            },
            'legacy-portal-bridge: step attempt',
          );
        },
      });
      record(result, attempts);
      const guard = scanPortalGuards(result.postActionSnapshot);
      return { result, attempts, guard };
    };

    /** Build the halt-for-help outcome from an ambiguous resolution. */
    const ambiguity = (result: ActionResult): KraFilingOutcome => ({
      ok: false,
      filed: false,
      failureReason: 'action-ambiguity',
      askBrain: true,
      ...(result.candidates && result.candidates.length > 0
        ? { candidates: result.candidates }
        : {}),
      steps,
    });

    /** Map a tripped guard to a structured (no-throw) outcome. */
    const guardOutcome = (
      reason: string,
    ): KraFilingOutcome => ({
      ok: false,
      filed: false,
      failureReason: reason,
      steps,
    });

    try {
      // Step 1 — fill PIN
      const pin = await executeStep(() =>
        driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /KRA PIN/i,
          value: creds.username,
        }),
      );
      if (pin.guard.tripped) return guardOutcome(pin.guard.reason!);
      if (pin.result.reason === 'control-ambiguous') return ambiguity(pin.result);

      // Step 2 — fill password
      const pwd = await executeStep(() =>
        driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /password/i,
          value: creds.password,
        }),
      );
      if (pwd.guard.tripped) return guardOutcome(pwd.guard.reason!);
      if (pwd.result.reason === 'control-ambiguous') return ambiguity(pwd.result);

      // Step 3 — login (with one auto-re-login if the session expires)
      let login = await executeStep(() =>
        driver.act({ verb: 'click', role: 'button', name: /login/i }),
      );
      if (login.result.reason === 'control-ambiguous') {
        return ambiguity(login.result);
      }

      // CAPTCHA / MFA after login → halt-for-help (owner intervention),
      // never a throw.
      if (
        login.guard.tripped &&
        login.guard.reason !== 'session-expired-after-login'
      ) {
        return guardOutcome(login.guard.reason!);
      }

      // Session expired immediately after a login click → ONE auto-re-
      // login, then escalate if it expires again.
      if (login.guard.reason === 'session-expired-after-login') {
        logSafe(
          opts.logger,
          'warn',
          { tenantId: input.tenantId },
          'legacy-portal-bridge: session expired after login — attempting one auto-re-login',
        );
        login = await executeStep(() =>
          driver.act({ verb: 'click', role: 'button', name: /login/i }),
        );
        if (login.result.reason === 'control-ambiguous') {
          return ambiguity(login.result);
        }
        if (login.guard.tripped) {
          // Still walled after the single retry → escalate structurally.
          return guardOutcome(login.guard.reason!);
        }
      }

      if (!login.result.ok) {
        return {
          ok: false,
          filed: false,
          failureReason: `login-failed:${login.result.reason ?? 'unknown'}`,
          steps,
        };
      }

      // Verify dashboard reachable via AX diff (a "File Return" CTA
      // appears post-login).
      const dashboardReady = login.result.diff.added.some(
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
      const nav = await executeStep(() =>
        driver.act({ verb: 'click', role: 'button', name: /file return/i }),
      );
      if (nav.guard.tripped) return guardOutcome(nav.guard.reason!);
      if (nav.result.reason === 'control-ambiguous') return ambiguity(nav.result);

      // Step 5 — fill rental income field
      const income = await executeStep(() =>
        driver.act({
          verb: 'fill',
          role: 'textbox',
          name: /monthly rental income/i,
          value: String(input.monthlyRentalIncomeKes),
        }),
      );
      if (income.guard.tripped) return guardOutcome(income.guard.reason!);
      if (income.result.reason === 'control-ambiguous') {
        return ambiguity(income.result);
      }

      // Step 6 — submit
      const submit = await executeStep(() =>
        driver.act({ verb: 'submit', role: 'button', name: /submit/i }),
      );
      if (submit.guard.tripped) return guardOutcome(submit.guard.reason!);
      if (submit.result.reason === 'control-ambiguous') {
        return ambiguity(submit.result);
      }
      if (!submit.result.ok) {
        return {
          ok: false,
          filed: false,
          failureReason: `submit-failed:${submit.result.reason ?? 'unknown'}`,
          steps,
        };
      }

      // Confirm a success alert appears in the diff. This is the
      // load-bearing assertion — without it we'd report success on a
      // page that silently rolled back. (The driver's contextual wait
      // already gives a slow async alert time to surface.)
      const success = submit.result.diff.added.find(
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

      const outcome: KraFilingOutcome = {
        ok: true,
        filed: true,
        confirmationText: success.name,
        steps,
      };
      // Cache the confirmed filing so a re-invoke replays it (no re-drive).
      idemCache.set(idem, { outcome, expiresAt: now() + ttlMs });
      return outcome;
    } catch (err) {
      // Last-resort guard — the loop is designed never to reach here, but
      // if anything slips through we still surface a structured reason.
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
