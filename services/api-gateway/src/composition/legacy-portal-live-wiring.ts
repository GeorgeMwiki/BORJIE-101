/**
 * legacy-portal-live-wiring — binds the REAL `services.legacyPortalFileKra`
 * runtime invoker behind the legacy-portal browser super-power route
 * (`routes/mining/legacy-portal.hono.ts` + `legacy-portal-bridge.ts`).
 *
 * THE SEAM THIS CLOSES
 * --------------------
 * `createKraFilingBridge` ships complete + governed but was NEVER bound by the
 * composition root, so `POST /mining/legacy-portal/file-kra` always returned the
 * honest `provisioned:false` envelope. This module constructs the bridge with a
 * REAL Playwright page factory ONLY when the live env is configured:
 *
 *   - `LEGACY_PORTAL_LIVE` is truthy (the explicit opt-in flag), AND
 *   - a credential vault is available (env-backed adapter present).
 *
 * When configured it:
 *   1. Builds a LAZY Playwright `pageFactory` — the `playwright` import +
 *      `chromium.launch()` happen INSIDE the gated branch, on first call, so
 *      dev/CI never spawn a browser merely by importing this module.
 *   2. Wraps each launched `Page` (which already satisfies `DrivablePage`:
 *      goto / getByRole / accessibility.snapshot / url) and threads it through
 *      `LegacyPortalDriver`.
 *   3. Resolves the tenant's portal credentials from the vault.
 *   4. Calls `createKraFilingBridge(...)` and returns its `fileKraReturn`.
 *
 * When NOT configured it returns `undefined` so the route keeps its honest
 * not-provisioned envelope — never a faked filing, never a crash.
 *
 * RAILS
 * -----
 *   - No secrets in code — the vault reads creds from env / a secret-manager
 *     adapter only; nothing is hardcoded.
 *   - Lazy + fail-soft — Playwright is dynamically imported; a launch failure
 *     surfaces as a structured bridge failure, not a boot crash.
 *   - Tenant isolation — the vault key is derived from the CALLING tenantId; a
 *     bridge call only ever fetches that tenant's portal credentials.
 *   - Governance unchanged — the call still originates from the HIGH-stakes
 *     `platform.legacy.file_kra_via_browser` brain tool upstream of the route.
 */

import {
  LegacyPortalDriver,
  type DrivablePage,
} from '@borjie/browser-perception';

import {
  createKraFilingBridge,
  type PortalCredentialVault,
} from './legacy-portal-bridge.js';
import type { LegacyPortalFileKra } from '../routes/mining/legacy-portal.hono.js';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

/** Lazy factory for a driveable page. Production = a Playwright `Page`. */
export type PageFactory = () => Promise<DrivablePage>;

export interface LegacyPortalLiveDeps {
  /** Env source (bootstrap-injected). Defaults to process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Structured logger. Defaults to the pino-shim. */
  readonly logger?: PinoLikeLogger;
  /**
   * Vault override for tests. Production builds an env-backed vault from
   * `LEGACY_PORTAL_VAULT_JSON` (or returns null → not provisioned).
   */
  readonly vault?: PortalCredentialVault | null;
  /**
   * Page-factory override for tests (bypass the Playwright launch). When
   * present, the live branch uses it instead of spawning a browser.
   */
  readonly pageFactory?: PageFactory;
}

export interface LegacyPortalLiveWiring {
  /**
   * The bridge function to bind onto `services.legacyPortalFileKra`, or
   * `undefined` when the live env is not provisioned (route stays honest).
   */
  readonly fileKra: LegacyPortalFileKra | undefined;
  /** Diagnostic — true when the live bridge was constructed. */
  readonly bound: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Env gates + vault
// ─────────────────────────────────────────────────────────────────────

const LIVE_FLAG = 'LEGACY_PORTAL_LIVE';
const VAULT_JSON_ENV = 'LEGACY_PORTAL_VAULT_JSON';
const PORTAL_URL_ENV = 'LEGACY_PORTAL_KRA_URL';
const DEFAULT_PORTAL_URL = 'https://itax.kra.go.ke/';

function liveEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env[LIVE_FLAG] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Build an env-backed credential vault. `LEGACY_PORTAL_VAULT_JSON` is a JSON
 * object mapping vault-key → `{ username, password, mfaCode? }`. In production
 * this env is itself populated from a secret manager (AWS Secrets Manager /
 * Doppler / Vault) by the deploy — never committed. Returns null when unset so
 * the wiring degrades to not-provisioned.
 */
function buildVaultFromEnv(
  env: NodeJS.ProcessEnv,
  logger: PinoLikeLogger,
): PortalCredentialVault | null {
  const raw = env[VAULT_JSON_ENV]?.trim();
  if (!raw) return null;
  let parsed: Record<
    string,
    { username?: unknown; password?: unknown; mfaCode?: unknown }
  >;
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    logger.warn(
      { env: VAULT_JSON_ENV },
      'legacy-portal-live: vault JSON failed to parse — treating as not provisioned (no creds will be served)',
    );
    return null;
  }
  return {
    fetch: async (key: string) => {
      // Own-property guard — never resolve via the prototype chain.
      const entry = Object.hasOwn(parsed, key) ? parsed[key] : undefined;
      if (
        !entry ||
        typeof entry.username !== 'string' ||
        typeof entry.password !== 'string'
      ) {
        return null;
      }
      return {
        username: entry.username,
        password: entry.password,
        ...(typeof entry.mfaCode === 'string' ? { mfaCode: entry.mfaCode } : {}),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lazy Playwright page factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a lazy Playwright page factory. The `playwright` import + browser
 * launch happen on FIRST call, inside this closure — never at module load — so
 * importing this wiring in dev/CI never spawns a browser. Each call yields a
 * fresh page (the bridge drives one filing per page).
 */
function createPlaywrightPageFactory(logger: PinoLikeLogger): PageFactory {
  return async (): Promise<DrivablePage> => {
    // Dynamic import — keeps the Playwright/Chromium graph out of the boot path.
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    // Best-effort teardown when the page closes (the bridge finishes a filing).
    page.on('close', () => {
      void browser.close().catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'legacy-portal-live: browser close failed (non-fatal)',
        );
      });
    });
    // A Playwright `Page` already satisfies DrivablePage (goto / getByRole /
    // accessibility.snapshot / url). Widen at the boundary.
    return page as unknown as DrivablePage;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public composition
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the live legacy-portal bridge. Returns `{ fileKra: undefined }` when
 * the live env is not provisioned (route keeps its honest envelope), or a real
 * `fileKra` bound over a Playwright-driven `LegacyPortalDriver` + vault when it
 * is. Fail-soft: env gates are checked before any browser machinery is touched.
 */
export function createLegacyPortalLiveWiring(
  deps: LegacyPortalLiveDeps = {},
): LegacyPortalLiveWiring {
  const logger = deps.logger ?? createPinoLikeLogger('legacy-portal-live');
  const env = deps.env ?? process.env;

  if (!liveEnabled(env)) {
    logger.info(
      { wiring: 'legacy-portal-live', flag: LIVE_FLAG, bound: false },
      'legacy-portal-live: NOT provisioned (LEGACY_PORTAL_LIVE unset) — route keeps honest not-provisioned envelope (no browser spawned, no filing faked)',
    );
    return Object.freeze({ fileKra: undefined, bound: false });
  }

  const vault =
    deps.vault !== undefined ? deps.vault : buildVaultFromEnv(env, logger);
  if (!vault) {
    logger.warn(
      { wiring: 'legacy-portal-live', flag: LIVE_FLAG, bound: false },
      'legacy-portal-live: LEGACY_PORTAL_LIVE is on but no credential vault is configured — staying not-provisioned (honest degrade; never drives a portal without vault creds)',
    );
    return Object.freeze({ fileKra: undefined, bound: false });
  }

  const portalUrl = env[PORTAL_URL_ENV]?.trim() || DEFAULT_PORTAL_URL;
  const pageFactory =
    deps.pageFactory ?? createPlaywrightPageFactory(logger);

  const fileKraReturn = createKraFilingBridge({
    driverFactory: (page: DrivablePage) => new LegacyPortalDriver({ page }),
    pageFactory,
    vault,
    vaultKey: (tenantId: string) => `legacy-portal:kra:${tenantId}`,
  });

  // Adapt the bridge's KES-named input to the route's LegacyPortalFileKra port
  // (identical shape; the cast widens the bridge's concrete return type to the
  // route's readonly interface). The bridge already honest-degrades on missing
  // creds / login failure / unconfirmed submit, so the route surfaces a real
  // structured outcome with `provisioned:true`.
  const fileKra: LegacyPortalFileKra = (input) =>
    fileKraReturn({
      tenantId: input.tenantId,
      periodYearMonth: input.periodYearMonth,
      monthlyRentalIncomeKes: input.monthlyRentalIncomeKes,
      ...(input.expensesKes !== undefined
        ? { expensesKes: input.expensesKes }
        : {}),
    });

  logger.info(
    {
      wiring: 'legacy-portal-live',
      flag: LIVE_FLAG,
      portalUrl,
      lazyBrowser: deps.pageFactory === undefined,
      bound: true,
    },
    'legacy-portal-live: REAL bridge bound — file-kra drives a live (lazy) Playwright portal via the AXTree driver + vault creds (governance unchanged: HIGH-gated upstream)',
  );

  return Object.freeze({ fileKra, bound: true });
}
