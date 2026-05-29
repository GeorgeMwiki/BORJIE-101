/**
 * PCCB / PDPA PII redaction contract — Borjie pre-launch S-5 audit.
 *
 * Tanzania's Personal Data Protection Act 2022 (s.51 breach-notify)
 * requires that PII be encrypted in transit + at rest AND scrubbed
 * from operational logs that may flow to third parties (Sentry, log
 * aggregators outside the EAC region).
 *
 * `@borjie/observability`'s `redactPII()` is the single canonical
 * scrubber. This test pins the contract that the redactor covers the
 * Tanzania-specific identifiers PCCB explicitly enumerates:
 *
 *   - NIDA national-id (`nidaNumber`)
 *   - M-Pesa MSISDN (`mpesaNumber`, `mpesaPhone`)
 *   - Driver licence (`driversLicense`)
 *   - Mining-licence holder phone / email (generic phone/email fields)
 *   - GPS coordinates (gpsLat/gpsLng — sensitive when paired with an
 *     identity in an artisanal mining context)
 *
 * If a future commit shortens the default redaction list this test
 * fails loudly — protecting against the silent-leak failure mode
 * where a refactor "cleans up" the redactor and exposes PII downstream.
 */

import { describe, it, expect } from 'vitest';
// Import the redactor directly — the `@borjie/observability` barrel
// does not re-export `redactPII`; keeping the deep import makes the
// dependency obvious and means this test cannot be silently broken by
// a barrel-flatten refactor. See `packages/observability/src/pii-redactor.ts`.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { redactPII } from '../../../../packages/observability/src/pii-redactor';

describe('redactPII — PCCB / PDPA Tanzania identifier coverage (S-5)', () => {
  it('redacts NIDA national-id, M-Pesa MSISDN, driver licence', () => {
    const input = {
      ownerName: 'Mzee Mwanaidi Komba',
      nidaNumber: '19850412-12345-67890-12',
      mpesaPhone: '+255712345678',
      mpesaNumber: '0712345678',
      driversLicense: 'TZA-2026-DRV-90210',
    } as const;

    const out = redactPII(input);

    // The whole "ownerName" is not a PII default field, but every PCCB-
    // listed identifier MUST be redacted. We assert each value was
    // replaced with the `[REDACTED:<field>]` template.
    expect(out.nidaNumber).toMatch(/^\[REDACTED\]:/);
    expect(out.mpesaPhone).toMatch(/^\[REDACTED\]:/);
    expect(out.mpesaNumber).toMatch(/^\[REDACTED\]:/);
    expect(out.driversLicense).toMatch(/^\[REDACTED\]:/);
  });

  it('redacts generic email + phone (PCCB-equivalent identifiers)', () => {
    const input = {
      email: 'owner@example.tz',
      phone: '+255700000002',
      phoneNumber: '0700000002',
    } as const;

    const out = redactPII(input);

    expect(out.email).toMatch(/^\[REDACTED\]:/);
    expect(out.phone).toMatch(/^\[REDACTED\]:/);
    expect(out.phoneNumber).toMatch(/^\[REDACTED\]:/);
  });

  it('redacts GPS coordinates (sensitive in artisanal mining context)', () => {
    const input = {
      siteName: 'Mawe Bora Mine 1',
      gpsLat: -6.3690,
      gpsLng: 34.8888,
      latitude: -6.3690,
      longitude: 34.8888,
    } as const;

    const out = redactPII(input);

    expect(out.gpsLat).toMatch(/^\[REDACTED\]:/);
    expect(out.gpsLng).toMatch(/^\[REDACTED\]:/);
    expect(out.latitude).toMatch(/^\[REDACTED\]:/);
    expect(out.longitude).toMatch(/^\[REDACTED\]:/);
    // Site name is allowed in logs — not PII per PCCB.
    expect(out.siteName).toBe('Mawe Bora Mine 1');
  });

  it('redacts credentials (defense-in-depth — also covered by pino)', () => {
    const input = {
      password: 'CorrectHorseBatteryStaple',
      accessToken: 'ey…',
      refreshToken: 'ey…',
      apiKey: 'sk-…',
      authorization: 'Bearer ey…',
    } as const;

    const out = redactPII(input);

    expect(out.password).toMatch(/^\[REDACTED\]:/);
    expect(out.accessToken).toMatch(/^\[REDACTED\]:/);
    expect(out.refreshToken).toMatch(/^\[REDACTED\]:/);
    expect(out.apiKey).toMatch(/^\[REDACTED\]:/);
    expect(out.authorization).toMatch(/^\[REDACTED\]:/);
  });

  it('walks nested objects (audit-event payloads are tree-shaped)', () => {
    const input = {
      requestId: 'req-1',
      payload: {
        owner: {
          email: 'owner@example.tz',
          nidaNumber: '19850412-12345-67890-12',
        },
        site: {
          gpsLat: -6.3690,
          gpsLng: 34.8888,
        },
      },
    } as const;

    const out = redactPII(input);

    expect(out.requestId).toBe('req-1'); // not PII
    expect(out.payload.owner.email).toMatch(/^\[REDACTED\]:/);
    expect(out.payload.owner.nidaNumber).toMatch(/^\[REDACTED\]:/);
    expect(out.payload.site.gpsLat).toMatch(/^\[REDACTED\]:/);
    expect(out.payload.site.gpsLng).toMatch(/^\[REDACTED\]:/);
  });

  it('never mutates the input (immutability contract)', () => {
    const input = {
      email: 'owner@example.tz',
      nidaNumber: '19850412-12345-67890-12',
    };
    const snapshot = JSON.stringify(input);

    redactPII(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
