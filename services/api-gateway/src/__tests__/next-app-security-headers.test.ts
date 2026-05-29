/**
 * Next-app security-header contract — Borjie pre-launch S-4 audit.
 *
 * Each of the three Next apps (owner-web, admin-web, marketing) MUST
 * register a `headers()` block on next.config.js that maps `/(.*)` to
 * a fixed list of security headers. This test loads each config and
 * pins:
 *
 *   - `Content-Security-Policy` blocks `frame-ancestors` (clickjacking)
 *   - `Strict-Transport-Security` enforces ≥1 year with `includeSubDomains`
 *   - `X-Frame-Options: DENY`
 *   - `X-Content-Type-Options: nosniff`
 *   - `Referrer-Policy: strict-origin-when-cross-origin`
 *   - `Permissions-Policy` denies camera/microphone/geolocation/payment
 *
 * Why this test lives in api-gateway: the gateway's vitest config
 * picks up `services/api-gateway/src/__tests__/**`, which is the
 * existing place for cross-cutting security contract tests
 * (cross-tenant-isolation.test.ts lives here too). We deliberately
 * keep these contract assertions next to the rest of the security
 * suite so a launch reviewer sees them all in one `pnpm test --filter
 * api-gateway` run.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

type HeaderEntry = { readonly key: string; readonly value: string };
type HeadersRule = { readonly source: string; readonly headers: HeaderEntry[] };
type NextConfigLike = { headers?: () => Promise<HeadersRule[]> };

async function loadConfig(appName: string): Promise<NextConfigLike> {
  // CommonJS require — Next configs are .js with `module.exports`. We
  // resolve from the repo root via __dirname to avoid CWD drift in
  // worker harnesses.
  const configPath = resolve(
    __dirname,
    `../../../../apps/${appName}/next.config.js`,
  );
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cfg = require(configPath);
  return cfg as NextConfigLike;
}

const APPS = ['owner-web', 'admin-web', 'marketing'] as const;

describe('Next-app security headers — pre-launch S-4 contract', () => {
  for (const app of APPS) {
    describe(app, () => {
      it('exposes a headers() block that maps "/(.*)" to a header list', async () => {
        const cfg = await loadConfig(app);
        expect(typeof cfg.headers).toBe('function');
        const rules = await cfg.headers!();
        expect(Array.isArray(rules)).toBe(true);
        const wildcard = rules.find((r) => r.source === '/(.*)');
        expect(wildcard).toBeDefined();
      });

      it('sets a CSP that bans framing (clickjacking defence)', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy');
        expect(csp).toBeDefined();
        expect(csp!.value).toContain("frame-ancestors 'none'");
        expect(csp!.value).toContain("default-src 'self'");
        expect(csp!.value).toContain("base-uri 'self'");
        expect(csp!.value).toContain("form-action 'self'");
        expect(csp!.value).toContain("object-src 'none'");
      });

      it('sets HSTS ≥1 year with includeSubDomains and preload', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const hsts = rule.headers.find(
          (h) => h.key === 'Strict-Transport-Security',
        );
        expect(hsts).toBeDefined();
        // Parse the max-age value out of the directive.
        const m = hsts!.value.match(/max-age=(\d+)/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(31_536_000);
        expect(hsts!.value).toContain('includeSubDomains');
        expect(hsts!.value).toContain('preload');
      });

      it('sets X-Frame-Options: DENY', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const xfo = rule.headers.find((h) => h.key === 'X-Frame-Options');
        expect(xfo?.value).toBe('DENY');
      });

      it('sets X-Content-Type-Options: nosniff', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const xcto = rule.headers.find(
          (h) => h.key === 'X-Content-Type-Options',
        );
        expect(xcto?.value).toBe('nosniff');
      });

      it('sets Referrer-Policy: strict-origin-when-cross-origin', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const rp = rule.headers.find((h) => h.key === 'Referrer-Policy');
        expect(rp?.value).toBe('strict-origin-when-cross-origin');
      });

      it('Permissions-Policy denies camera, microphone, geolocation, payment', async () => {
        const cfg = await loadConfig(app);
        const [rule] = await cfg.headers!();
        const pp = rule.headers.find((h) => h.key === 'Permissions-Policy');
        expect(pp).toBeDefined();
        for (const sensor of [
          'camera=()',
          'microphone=()',
          'geolocation=()',
          'payment=()',
        ]) {
          expect(pp!.value).toContain(sensor);
        }
      });
    });
  }
});
