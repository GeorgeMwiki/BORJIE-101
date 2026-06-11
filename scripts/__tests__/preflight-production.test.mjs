// @ts-check
/**
 * preflight-production.test.mjs — unit tests for the pure helpers behind the
 * two LANE-2 CLIs (preflight + set-gh-secrets). No app boot, no `gh`, no
 * network: every exported helper is pure and tested against synthetic env maps.
 */

import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_REQUIRED,
  partitionRequirements,
  presentCanonicalKeys,
  isSatisfied,
} from '../lib/production-required.mjs';
import {
  parseFlags as preflightFlags,
  buildReport,
} from '../preflight-production.mjs';
import {
  parseFlags as setSecretsFlags,
  planSecrets,
  ghArgs,
} from '../set-gh-secrets.mjs';

/** A fully-provisioned production env (every requirement satisfied). */
const COMPLETE = Object.freeze({
  DATABASE_URL: 'postgres://u:p@host:5432/db',
  JWT_SECRET: 'j'.repeat(64),
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SUPABASE_JWT_SECRET: 's'.repeat(48),
  ANTHROPIC_API_KEY: 'sk-ant-xxxx',
  SESSION_HASH_SECRET: 'h'.repeat(48),
});

describe('production-required helpers', () => {
  it('isSatisfied honors aliases + trims blanks', () => {
    const urlReq = PRODUCTION_REQUIRED.find((r) => r.label === 'SUPABASE_URL');
    expect(isSatisfied(urlReq, { NEXT_PUBLIC_SUPABASE_URL: 'x' })).toBe(true);
    expect(isSatisfied(urlReq, { SUPABASE_URL: '   ' })).toBe(false);
    expect(isSatisfied(urlReq, {})).toBe(false);
  });

  it('partitionRequirements: complete env ⇒ all present, none missing', () => {
    const { present, missing } = partitionRequirements(COMPLETE);
    expect(present).toHaveLength(PRODUCTION_REQUIRED.length);
    expect(missing).toHaveLength(0);
  });

  it('partitionRequirements: empty env ⇒ all missing', () => {
    const { present, missing } = partitionRequirements({});
    expect(present).toHaveLength(0);
    expect(missing).toHaveLength(PRODUCTION_REQUIRED.length);
  });

  it('presentCanonicalKeys returns the exact alias the operator populated', () => {
    const keys = presentCanonicalKeys({
      ...COMPLETE,
      SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
    });
    expect(keys).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(keys).not.toContain('SUPABASE_URL');
  });
});

describe('preflight CLI', () => {
  it('parseFlags reads --env / --json (both spellings)', () => {
    expect(preflightFlags(['--json'])).toMatchObject({ json: true });
    expect(preflightFlags(['--env', '.env.local'])).toMatchObject({
      env: '.env.local',
    });
    expect(preflightFlags(['--env=.env.prod'])).toMatchObject({
      env: '.env.prod',
    });
  });

  it('buildReport: READY when complete', () => {
    const r = buildReport(COMPLETE);
    expect(r.ready).toBe(true);
    expect(r.missing).toHaveLength(0);
    expect(r.present).toHaveLength(PRODUCTION_REQUIRED.length);
  });

  it('buildReport: NOT-READY surfaces every missing label + copy-paste list', () => {
    const partial = { DATABASE_URL: COMPLETE.DATABASE_URL };
    const r = buildReport(partial);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toContain('ANTHROPIC_API_KEY');
    expect(r.missingKeys).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(r.missingKeys).not.toContain('DATABASE_URL');
    // copy-paste list joins by space and stays in sync with `missing`
    expect(r.missingKeys).toHaveLength(r.missing.length);
  });
});

describe('set-gh-secrets CLI', () => {
  it('parseFlags reads --repo / --env-name / --dry-run', () => {
    expect(
      setSecretsFlags(['--repo', 'o/r', '--env-name', 'production', '--dry-run']),
    ).toMatchObject({ repo: 'o/r', envName: 'production', dryRun: true });
    expect(setSecretsFlags(['--repo=o/r'])).toMatchObject({ repo: 'o/r' });
  });

  it('planSecrets: complete env ⇒ set all, skip none', () => {
    const { toSet, skipped } = planSecrets(COMPLETE);
    expect(skipped).toHaveLength(0);
    // Every requirement contributes exactly one concrete key.
    expect(toSet).toHaveLength(PRODUCTION_REQUIRED.length);
    expect(toSet).toContain('ANTHROPIC_API_KEY');
  });

  it('planSecrets: partial env ⇒ set present, skip + list absent by label', () => {
    const { toSet, skipped } = planSecrets({
      DATABASE_URL: COMPLETE.DATABASE_URL,
      ANTHROPIC_API_KEY: COMPLETE.ANTHROPIC_API_KEY,
    });
    expect(toSet).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'ANTHROPIC_API_KEY']),
    );
    expect(toSet).toHaveLength(2);
    expect(skipped).toContain('JWT_SECRET');
    expect(skipped).toContain('SUPABASE_URL');
    expect(skipped).not.toContain('DATABASE_URL');
  });

  it('ghArgs feeds the value via stdin (never on argv) + supports repo/env', () => {
    const args = ghArgs('ANTHROPIC_API_KEY', { repo: 'o/r', envName: 'production' });
    expect(args).toEqual([
      'secret',
      'set',
      'ANTHROPIC_API_KEY',
      '--body',
      '-',
      '--repo',
      'o/r',
      '--env',
      'production',
    ]);
    // The actual secret value never appears in the argv.
    expect(args.join(' ')).not.toContain('sk-ant');
  });
});
