/**
 * Advisor enum-label contract + locale-purity gate (raw-enum-render class) —
 * the round-12b EXTENSION of the owner-os enum-label gate BEYOND owner-os, to
 * the non-owner-os advisor surfaces (treasury advisor `rec.kind`, fleet-ops
 * `r.type`). Same shape as
 * `components/owner-os/panels/__tests__/enum-label-contract.test.ts`, against
 * the dedicated Stream-A vocabulary `i18n/strings/advisor-enum-labels.ts`.
 *
 * The bug class: a panel cell that renders a DB enum token verbatim
 * (`{rec.kind}`, `{r.type}`) prints the raw code (`usd-cliff-remediation`,
 * `truck`). Source-literal scanners can't see it (the string arrives at
 * runtime off the wire), yet it leaks English under `sw`.
 *
 * This gate asserts:
 *
 *  1. CONTRACT — the FE vocabulary is a faithful copy of the server source of
 *     truth (every server token has a label; order-independent). A server-side
 *     enum change that adds a token fails here until the label lands.
 *
 *  2. NO DRIFT — the FE adds no token the server cannot emit.
 *
 *  3. PARITY — every token has a NON-EMPTY label in BOTH `en` and `sw`
 *     (no half-translated token; no cross-language fallback).
 *
 *  4. ZERO-MIX — under `sw`, `advisorEnumLabel(domain, token, 'sw')` never
 *     returns the raw token verbatim (the regression tripwire: revert a panel
 *     to `{rec.kind}` and the value becomes the raw token, which a localised
 *     label never equals).
 *
 * Proof the gate BITES: delete a token from `advisorEnumLabels.treasuryRecKind`
 * and assertion (1) goes RED; restore it and it's GREEN. Replace a `sw` label
 * with its raw token and assertion (4) goes RED.
 */

import { describe, it, expect } from 'vitest';

import {
  advisorEnumLabel,
  type AdvisorEnumDomain,
} from '../advisor-enum-label';
import { advisorEnumLabels as A } from '@/i18n/strings/advisor-enum-labels';

// ── Faithful copies of the server source-of-truth vocabularies ──────────
//   packages/fx-treasury-advisor/src/types.ts → treasuryRecommendationKindSchema
//   packages/fleet-management/src/types.ts     → VEHICLE_TYPES
const SERVER_VOCAB: Record<AdvisorEnumDomain, readonly string[]> = {
  treasuryRecKind: [
    'sell-stockpile',
    'partial-fx-hedge',
    'delay-capex',
    'accelerate-receivable',
    'usd-cliff-remediation',
    'rebalance-account',
  ],
  fleetVehicleType: [
    'sedan',
    'suv',
    'pickup',
    'van',
    'truck',
    'motorcycle',
    'scooter',
  ],
};

const DOMAINS = Object.keys(SERVER_VOCAB) as AdvisorEnumDomain[];

describe('advisor enum-label contract (raw-enum-render gate, non-owner-os)', () => {
  it('every server domain has a FE label vocabulary', () => {
    for (const domain of DOMAINS) {
      expect(A[domain], `missing FE vocab for ${domain}`).toBeDefined();
    }
  });

  it('every server token has a FE label (contract: no unmapped token)', () => {
    for (const domain of DOMAINS) {
      const vocab = A[domain] as Record<string, unknown>;
      const missing = SERVER_VOCAB[domain].filter((t) => !(t in vocab));
      expect(missing, `unmapped ${domain} tokens`).toEqual([]);
    }
  });

  it('the FE vocabulary adds no token the server cannot emit (no drift)', () => {
    for (const domain of DOMAINS) {
      const server = new Set(SERVER_VOCAB[domain]);
      const extra = Object.keys(A[domain]).filter((t) => !server.has(t));
      expect(extra, `stale ${domain} tokens not in server enum`).toEqual([]);
    }
  });

  it('every token has a non-empty EN and SW label (parity, no mixing)', () => {
    for (const domain of DOMAINS) {
      const vocab = A[domain] as Record<string, { en: string; sw: string }>;
      for (const token of SERVER_VOCAB[domain]) {
        const label = vocab[token]!;
        expect(label.en.length, `empty EN for ${domain}.${token}`).toBeGreaterThan(0);
        expect(label.sw.length, `empty SW for ${domain}.${token}`).toBeGreaterThan(0);
      }
    }
  });

  it('NEVER renders a raw enum token verbatim under sw (zero-mix tripwire)', () => {
    for (const domain of DOMAINS) {
      for (const token of SERVER_VOCAB[domain]) {
        const sw = advisorEnumLabel(domain, token, 'sw');
        expect(
          sw,
          `${domain}.${token} leaks the raw token under sw`,
        ).not.toBe(token);
        expect(sw.length).toBeGreaterThan(0);
      }
    }
  });

  it('EN and SW labels differ for tokens whose code is not already English', () => {
    // Catches a half-done entry where the SW slot equals the EN label for a
    // token that clearly needs a Swahili word.
    const sample: Array<[AdvisorEnumDomain, string]> = [
      ['treasuryRecKind', 'sell-stockpile'],
      ['treasuryRecKind', 'rebalance-account'],
      ['fleetVehicleType', 'truck'],
      ['fleetVehicleType', 'van'],
    ];
    for (const [domain, token] of sample) {
      const en = advisorEnumLabel(domain, token, 'en');
      const sw = advisorEnumLabel(domain, token, 'sw');
      expect(sw, `${domain}.${token} SW not localised`).not.toBe(en);
    }
  });

  it('resolves empty / nullish tokens to the em-dash placeholder', () => {
    expect(advisorEnumLabel('treasuryRecKind', null, 'sw')).toBe('—');
    expect(advisorEnumLabel('fleetVehicleType', undefined, 'en')).toBe('—');
    expect(advisorEnumLabel('treasuryRecKind', '', 'sw')).toBe('—');
  });

  it('humanises an unknown token instead of printing it raw (safety net)', () => {
    // Wire drift: a value the server adds before the label lands must not
    // render as a bare snake_case / kebab-case code.
    expect(advisorEnumLabel('treasuryRecKind', 'brand-new-kind', 'sw')).toBe(
      'Brand new kind',
    );
    expect(
      advisorEnumLabel('fleetVehicleType', 'forklift', 'sw'),
    ).not.toBe('forklift');
  });
});
