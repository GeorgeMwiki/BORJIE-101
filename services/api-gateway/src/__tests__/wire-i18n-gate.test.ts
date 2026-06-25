/**
 * WIRE-I18N GATE test — wires the backend wire-i18n detector into the
 * api-gateway test run (vitest `include: src/**\/*.test.ts`).
 *
 * Proves three things:
 *   1. `routes/**` carries ZERO mixed-bilingual + ZERO property-vocab
 *      client-facing literals (allowlist excluded).
 *   2. The allowlist can only SHRINK — every entry still matches a live
 *      literal (no stale ratchet rows).
 *   3. The gate BITES — a seeded mixed-bilingual literal AND a seeded
 *      property-vocab literal are each caught (and a clean control is not),
 *      so a green run is real coverage, never a dead detector.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  scanWireI18n,
  staleAllowlistIds,
  formatOffender,
  WIRE_I18N_ALLOWLIST,
} from '../wire-i18n-gate';

describe('wire-i18n gate — routes emit no mixed-bilingual / property-vocab prose', () => {
  it('finds ZERO offenders across routes/** (allowlist excluded)', () => {
    const offenders = scanWireI18n();
    if (offenders.length > 0) {
      const report = offenders.map(formatOffender).join('\n');
      throw new Error(
        `wire-i18n gate found ${offenders.length} offender(s).\n` +
          `Convert client-facing prose to a structured { en, sw } message ` +
          `(the routes/marketplace/rfb.hono.ts precedent) or rely solely on ` +
          `the stable UPPER_SNAKE code; remove any property-domain vocabulary.\n` +
          report,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist a SHRINK-only ratchet (no stale entries)', () => {
    const stale = staleAllowlistIds();
    expect(
      stale,
      `Stale allowlist entries (literal no longer present — remove them): ${stale.join(
        ', ',
      )}`,
    ).toEqual([]);
  });

  it('every allowlist entry carries a non-empty reason', () => {
    for (const [id, reason] of WIRE_I18N_ALLOWLIST) {
      expect(reason.trim().length, `allowlist ${id} needs a reason`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('wire-i18n gate BITES (mutation proof — RED on a seeded offender)', () => {
  // Build a throwaway `src/routes` tree so the seeded files never touch the
  // real source. `scanWireI18n({ routesDir })` points the scanner at it.
  const root = mkdtempSync(join(tmpdir(), 'wire-i18n-gate-'));
  const routesDir = join(root, 'routes');
  mkdirSync(routesDir, { recursive: true });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function seed(name: string, body: string): void {
    writeFileSync(join(routesDir, name), body, 'utf8');
  }

  it('catches a single literal mixing English + Swahili', () => {
    seed(
      'mixed.hono.ts',
      `export const r = c.json({ error: { code: 'BID_NOT_PENDING', ` +
        `message: 'Bid is no longer pending. Zabuni hii haisubiri tena.' } });\n`,
    );
    const hits = scanWireI18n({ routesDir });
    const mixed = hits.filter((h) => h.kind === 'mixed-bilingual');
    expect(mixed.length, JSON.stringify(hits)).toBeGreaterThanOrEqual(1);
    rmSync(join(routesDir, 'mixed.hono.ts'));
  });

  it('catches off-mandate property vocabulary in a client-facing literal', () => {
    seed(
      'prop.hono.ts',
      `export const r = c.json({ error: { code: 'X', ` +
        `message: 'Your rent for this lease unit is overdue.' } });\n`,
    );
    const hits = scanWireI18n({ routesDir });
    const prop = hits.filter((h) => h.kind === 'property-vocab');
    expect(prop.length, JSON.stringify(hits)).toBeGreaterThanOrEqual(1);
    rmSync(join(routesDir, 'prop.hono.ts'));
  });

  it('does NOT flag a clean single-language string or a stable code', () => {
    seed(
      'clean.hono.ts',
      `export const r = c.json({ error: { code: 'RESOURCE_NOT_FOUND', ` +
        `message: { en: 'Resource not found.', sw: 'Rasilimali haijapatikana.' } } });\n` +
        `const route = 'tenant:tnt_demo'; const col = 'tenant_id';\n`,
    );
    const hits = scanWireI18n({ routesDir });
    // The structured { en, sw } object is two SEPARATE single-language
    // literals (never mixed in ONE string); `tenant:` / `tenant_id` are the
    // multi-tenancy CORE token, not property residue.
    expect(hits, JSON.stringify(hits)).toEqual([]);
    rmSync(join(routesDir, 'clean.hono.ts'));
  });
});
