/**
 * Shared helpers for Wave 20 UI smoke suite.
 *
 * These tests hit the REAL dev servers (USE_REAL_SERVERS=1 is implied by
 * pointing *_URL at the right ports). They intentionally do NOT mock API
 * traffic — the whole point is to catch bugs synthetic probes miss.
 *
 * Each test captures:
 *   - Every console event (log, warn, error)
 *   - Every uncaught page error
 *   - Every network response with status >= 400
 *   - Every request that failed at the transport layer
 *
 * The suite is non-destructive: no POST/PUT/DELETE, no seed writes, no
 * auth. It just navigates and asserts no console errors happen and no
 * 5xx is emitted by the UI layer during a cold page load.
 */
import { test as baseTest, expect, type Page, type ConsoleMessage, type Request as PWRequest, type Response as PWResponse } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CapturedSignals {
  readonly consoleLogs: string[];
  readonly consoleWarns: string[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly failedRequests: string[];
  readonly httpErrors: string[];
  readonly i18nMissingKeys: string[];
}

export function createSignalCollector(): {
  readonly signals: CapturedSignals;
  readonly attach: (page: Page) => void;
} {
  const consoleLogs: string[] = [];
  const consoleWarns: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: string[] = [];
  const i18nMissingKeys: string[] = [];

  const signals: CapturedSignals = {
    consoleLogs,
    consoleWarns,
    consoleErrors,
    pageErrors,
    failedRequests,
    httpErrors,
    i18nMissingKeys,
  };

  const attach = (page: Page): void => {
    page.on('console', (msg: ConsoleMessage) => {
      const text = `[${msg.type()}] ${msg.text()}`;
      if (msg.type() === 'error') {
        consoleErrors.push(text);
        // next-intl emits: "MISSING_MESSAGE: Could not resolve `foo.bar`..."
        if (/MISSING_MESSAGE|missing.+translation|MISSING_TRANSLATION/i.test(msg.text())) {
          i18nMissingKeys.push(msg.text());
        }
      } else if (msg.type() === 'warning') {
        consoleWarns.push(text);
        if (/MISSING_MESSAGE|missing.+translation/i.test(msg.text())) {
          i18nMissingKeys.push(msg.text());
        }
      } else {
        consoleLogs.push(text);
      }
    });

    page.on('pageerror', (err: Error) => {
      pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`);
    });

    page.on('requestfailed', (req: PWRequest) => {
      const failure = req.failure();
      failedRequests.push(`${req.method()} ${req.url()} — ${failure?.errorText ?? 'unknown'}`);
    });

    page.on('response', (res: PWResponse) => {
      const status = res.status();
      if (status >= 400) {
        httpErrors.push(`${status} ${res.request().method()} ${res.url()}`);
      }
    });
  };

  return { signals, attach };
}

export interface AppProbe {
  readonly app: string;
  readonly baseURL: string;
  readonly routes: readonly string[];
  readonly artifactsDir: string;
}

/**
 * Navigate to a route and capture a full-page screenshot. Swallows
 * navigation timeouts — the signals we capture (console errors, failed
 * requests) are the real assertion; a slow-to-paint page is a separate
 * finding.
 */
export async function probeRoute(
  page: Page,
  probe: AppProbe,
  route: string,
): Promise<{ readonly status: 'ok' | 'timeout' | 'error'; readonly message?: string; readonly screenshot?: string }> {
  const screenshot = path.join(
    probe.artifactsDir,
    `${probe.app}-${route.replace(/[\/:]/g, '_').replace(/^_/, '') || 'root'}.png`,
  );

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Give SPAs a beat to hydrate + fire initial API calls.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      /* network-never-idle is a finding, not a hard fail */
    });
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => { /* screenshot failure is non-fatal */ });
    return { status: 'ok', screenshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Still try to grab a screenshot even on failure.
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => { /* ignore */ });
    return {
      status: /timeout/i.test(message) ? 'timeout' : 'error',
      message,
      screenshot,
    };
  }
}

export function writeSignalLog(appName: string, artifactsDir: string, signals: CapturedSignals): void {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const logPath = path.join(artifactsDir, `${appName}-signals.json`);
  fs.writeFileSync(logPath, JSON.stringify(signals, null, 2), 'utf8');
}

export { baseTest as test, expect };
