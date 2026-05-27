/**
 * pilot-provision tests — pure helper coverage.
 *
 * The Supabase + Postgres path is exercised in integration tests gated
 * on DATABASE_URL + SUPABASE_SERVICE_ROLE_KEY. These tests cover the
 * pieces that run on every machine: CLI parsing + validation.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePilotProvisionArgs,
  PilotProvisionValidationError,
} from '../lib/pilot-provision-helpers.js';

describe('parsePilotProvisionArgs — happy path', () => {
  it('accepts a full valid set with positional --flag <value> form', () => {
    const args = parsePilotProvisionArgs([
      '--phone',
      '+255712345678',
      '--tenant',
      'tnt_pilot_001',
      '--cohort',
      'pilot-tz-may-2026',
    ]);
    expect(args.phone).toBe('+255712345678');
    expect(args.tenantId).toBe('tnt_pilot_001');
    expect(args.cohort).toBe('pilot-tz-may-2026');
    expect(args.dryRun).toBe(false);
    expect(args.json).toBe(false);
    expect(args.email).toBeUndefined();
  });

  it('accepts the --flag=value form and lower-cases the cohort', () => {
    const args = parsePilotProvisionArgs([
      '--phone=+254712000000',
      '--tenant=tnt_kenya_pilot',
      '--cohort=PILOT-KE-JUN-2026',
      '--dry-run',
      '--json',
    ]);
    expect(args.cohort).toBe('pilot-ke-jun-2026');
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it('carries optional --email and --password when provided', () => {
    const args = parsePilotProvisionArgs([
      '--phone=+255700000000',
      '--tenant=tnt_pilot_001',
      '--cohort=pilot-tz-may-2026',
      '--email=Pilot.One@Borjie.dev',
      '--password=verysecret',
    ]);
    expect(args.email).toBe('pilot.one@borjie.dev');
    expect(args.password).toBe('verysecret');
  });
});

describe('parsePilotProvisionArgs — validation', () => {
  it('throws when --phone is missing', () => {
    expect(() =>
      parsePilotProvisionArgs(['--tenant=tnt_x', '--cohort=pilot-x']),
    ).toThrow(PilotProvisionValidationError);
  });

  it('throws when --phone is not E.164', () => {
    expect(() =>
      parsePilotProvisionArgs([
        '--phone=0712345678',
        '--tenant=tnt_x',
        '--cohort=pilot-x',
      ]),
    ).toThrow(/E\.164/);
  });

  it('throws when --tenant fails the slug pattern', () => {
    expect(() =>
      parsePilotProvisionArgs([
        '--phone=+255700000000',
        '--tenant=  ',
        '--cohort=pilot-x',
      ]),
    ).toThrow(PilotProvisionValidationError);
  });

  it('throws when --cohort is not a lower-case slug', () => {
    expect(() =>
      parsePilotProvisionArgs([
        '--phone=+255700000000',
        '--tenant=tnt_x',
        '--cohort=Bad Cohort!',
      ]),
    ).toThrow(/cohort/i);
  });

  it('throws when --email is provided but malformed', () => {
    expect(() =>
      parsePilotProvisionArgs([
        '--phone=+255700000000',
        '--tenant=tnt_x',
        '--cohort=pilot-x',
        '--email=not-an-email',
      ]),
    ).toThrow(/email/);
  });
});
