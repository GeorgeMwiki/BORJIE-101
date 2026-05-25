/**
 * bootstrap-tenant tests — pure helper coverage.
 *
 * The Postgres-touching path is exercised by integration tests (gated on
 * DATABASE_URL). These tests cover the parts that run on every machine:
 * arg parsing, slug derivation, next-Monday scheduling, error mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  parseBootstrapArgs,
  slugify,
  nextMondayAt8,
  BootstrapValidationError,
} from '../lib/bootstrap-tenant-helpers.js';

describe('bootstrap-tenant helpers', () => {
  it('slugify trims + lowercases + hyphenates', () => {
    expect(slugify('Acme Properties LLC!!!')).toBe('acme-properties-llc');
    expect(slugify('  mixed Case  ')).toBe('mixed-case');
    expect(slugify('---multiple---dashes')).toBe('multiple-dashes');
  });

  it('parseBootstrapArgs accepts a full valid set', () => {
    const args = parseBootstrapArgs([
      '--name', 'Acme',
      '--country', 'tz',
      '--admin-email', 'Admin@Acme.Example',
      '--admin-phone', '+255712345678',
      '--with-demo-data',
    ]);
    expect(args.countryCode).toBe('TZ');
    expect(args.adminEmail).toBe('admin@acme.example');
    expect(args.slug).toBe('acme');
    expect(args.withDemoData).toBe(true);
    expect(args.dryRun).toBe(false);
  });

  it('parseBootstrapArgs supports --flag=value form', () => {
    const args = parseBootstrapArgs([
      '--name=Foo Bar',
      '--country=KE',
      '--admin-email=a@b.co',
      '--admin-phone=+254712000000',
      '--slug=foo-bar',
      '--dry-run',
      '--json',
    ]);
    expect(args.slug).toBe('foo-bar');
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it('parseBootstrapArgs rejects missing name', () => {
    expect(() => parseBootstrapArgs([
      '--country', 'TZ',
      '--admin-email', 'a@b.co',
      '--admin-phone', '+255712345678',
    ])).toThrow(BootstrapValidationError);
  });

  it('parseBootstrapArgs rejects invalid country code', () => {
    expect(() => parseBootstrapArgs([
      '--name', 'Acme',
      '--country', 'tanzania',
      '--admin-email', 'a@b.co',
      '--admin-phone', '+255712345678',
    ])).toThrow(/ISO-3166-1/);
  });

  it('parseBootstrapArgs rejects invalid email', () => {
    expect(() => parseBootstrapArgs([
      '--name', 'Acme',
      '--country', 'TZ',
      '--admin-email', 'not-an-email',
      '--admin-phone', '+255712345678',
    ])).toThrow(/valid email/);
  });

  it('parseBootstrapArgs rejects missing phone flag', () => {
    // No --admin-phone at all: must reject rather than default.
    expect(() => parseBootstrapArgs([
      '--name', 'Acme',
      '--country', 'TZ',
      '--admin-email', 'a@b.co',
    ])).toThrow(/phone/);
  });

  it('nextMondayAt8: from Sunday → next day at 08:00 UTC', () => {
    const sun = new Date('2026-04-19T12:00:00Z'); // Sunday
    const result = nextMondayAt8(sun);
    expect(result.getUTCDay()).toBe(1);
    expect(result.getUTCHours()).toBe(8);
    expect(result.getUTCDate()).toBe(20);
  });

  it('nextMondayAt8: from Monday → rolls forward 7 days', () => {
    const mon = new Date('2026-04-20T10:00:00Z'); // Monday
    const result = nextMondayAt8(mon);
    expect(result.getUTCDay()).toBe(1);
    // 7 days later (not same-day-same-hour).
    expect(result.getTime()).toBeGreaterThan(mon.getTime() + 6 * 86_400_000);
  });

  it('nextMondayAt8: from Friday → 3 days later', () => {
    const fri = new Date('2026-04-17T10:00:00Z'); // Friday
    const result = nextMondayAt8(fri);
    expect(result.getUTCDay()).toBe(1);
    expect(result.getUTCDate()).toBe(20);
  });

  it('parseBootstrapArgs: explicit --slug overrides derived', () => {
    const args = parseBootstrapArgs([
      '--name', 'Acme Properties',
      '--country', 'TZ',
      '--admin-email', 'a@b.co',
      '--admin-phone', '+255712345678',
      '--slug', 'custom-slug',
    ]);
    expect(args.slug).toBe('custom-slug');
  });
});
