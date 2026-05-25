/**
 * setup-borjie-env.test.mjs — pure-logic unit tests.
 *
 * Covers the in-memory parts: secret generation, env parsing/merging,
 * Supabase CLI output parsing, flag parsing. Does NOT spawn `supabase`
 * or touch the filesystem.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  generateAllSecrets,
  isTodoMarker,
  SECRET_FIELDS,
  TODO_MARKER_PREFIX,
} from './lib/env-secrets.mjs';
import {
  parseEnvFile,
  serialiseEnvFile,
  mergeEnv,
  patchSupabaseKeys,
  isPlaceholder,
} from './lib/env-mutators.mjs';
import {
  parseFlags,
  parseSupabaseApiKeysOutput,
  parseSupabaseProjectCreateOutput,
  checkRequiredClis,
} from './setup-borjie-env.mjs';

// ---------------------------------------------------------------------------
// generateSecret — byte length, encoding shape, randomness
// ---------------------------------------------------------------------------
describe('generateSecret', () => {
  it('produces base64 strings of expected min length', () => {
    const s = generateSecret(32, 'base64');
    // base64 of 32 bytes is 44 chars (with padding)
    expect(s).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(s.length).toBeGreaterThanOrEqual(43);
  });

  it('produces hex strings of exact length', () => {
    const s = generateSecret(32, 'hex');
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-integer byte counts', () => {
    expect(() => generateSecret(1.5, 'hex')).toThrow(/integer/);
    expect(() => generateSecret(8, 'hex')).toThrow(/>= 16/);
  });

  it('rejects unsupported encodings', () => {
    expect(() => generateSecret(32, 'binary')).toThrow(/encoding/);
  });

  it('returns a different value on each call (statistical)', () => {
    const a = generateSecret(32, 'hex');
    const b = generateSecret(32, 'hex');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// generateAllSecrets — shape + uniqueness
// ---------------------------------------------------------------------------
describe('generateAllSecrets', () => {
  it('returns one key per SECRET_FIELDS entry', () => {
    const secrets = generateAllSecrets();
    expect(Object.keys(secrets).sort()).toEqual(SECRET_FIELDS.map((s) => s.key).sort());
  });

  it('every value is non-empty', () => {
    const secrets = generateAllSecrets();
    for (const v of Object.values(secrets)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(20);
    }
  });

  it('all secrets are unique within a single call', () => {
    const secrets = generateAllSecrets();
    const values = Object.values(secrets);
    expect(new Set(values).size).toBe(values.length);
  });

  it('accepts an injected RNG for determinism', () => {
    let counter = 0;
    const rng = () => `MOCK_${counter++}`;
    const secrets = generateAllSecrets(rng);
    expect(secrets.ENCRYPTION_MASTER_KEY).toBe('MOCK_0');
    expect(secrets.CRON_SECRET).toBe(`MOCK_${SECRET_FIELDS.length - 1}`);
  });
});

// ---------------------------------------------------------------------------
// isTodoMarker / isPlaceholder
// ---------------------------------------------------------------------------
describe('isTodoMarker', () => {
  it('flags empty string', () => {
    expect(isTodoMarker('')).toBe(true);
  });

  it('flags TODO_BORJIE_ values', () => {
    expect(isTodoMarker(`${TODO_MARKER_PREFIX}SUPABASE_PROJECT`)).toBe(true);
  });

  it('does not flag real-looking values', () => {
    expect(isTodoMarker('sbp_xxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
    expect(isTodoMarker('https://abcdefgh.supabase.co')).toBe(false);
  });

  it('handles non-string inputs defensively', () => {
    expect(isTodoMarker(undefined)).toBe(false);
    expect(isTodoMarker(null)).toBe(false);
    expect(isTodoMarker(123)).toBe(false);
  });
});

describe('isPlaceholder', () => {
  it('flags TODO_, your-, replace-me patterns', () => {
    expect(isPlaceholder('your-anon-key')).toBe(true);
    expect(isPlaceholder('replace-me-with-secret')).toBe(true);
    expect(isPlaceholder('TODO_BORJIE_X')).toBe(true);
  });

  it('does not flag plausible real values', () => {
    expect(isPlaceholder('sk-ant-api-real-key')).toBe(false);
    expect(isPlaceholder('eyJhbGciOi...')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseEnvFile / serialiseEnvFile — round-trip + comment preservation
// ---------------------------------------------------------------------------
describe('parseEnvFile', () => {
  it('parses simple KEY=value lines', () => {
    const out = parseEnvFile('FOO=bar\nBAR=baz\n');
    expect(out).toEqual({ FOO: 'bar', BAR: 'baz' });
  });

  it('ignores comments and blank lines', () => {
    const out = parseEnvFile('# header\n\nFOO=bar\n# trailing\n');
    expect(out).toEqual({ FOO: 'bar' });
  });

  it('preserves literal values including special chars', () => {
    const out = parseEnvFile('URL=postgresql://u:p@h:5432/d?ssl=true\n');
    expect(out.URL).toBe('postgresql://u:p@h:5432/d?ssl=true');
  });

  it('skips lowercase keys (which dotenv treats as comments)', () => {
    const out = parseEnvFile('lowercase=skip\nUPPER=keep\n');
    expect(out).toEqual({ UPPER: 'keep' });
  });
});

describe('serialiseEnvFile', () => {
  it('updates existing keys in place and preserves comments', () => {
    const original = '# top\nFOO=old\n# mid\nBAR=keep\n';
    const next = { FOO: 'new', BAR: 'keep' };
    const out = serialiseEnvFile(original, next);
    expect(out).toContain('# top');
    expect(out).toContain('# mid');
    expect(out).toContain('FOO=new');
    expect(out).toContain('BAR=keep');
    expect(out).not.toContain('FOO=old');
  });

  it('appends brand-new keys under a marker comment', () => {
    const original = 'FOO=old\n';
    const next = { FOO: 'old', NEW_KEY: 'shiny' };
    const out = serialiseEnvFile(original, next);
    expect(out).toContain('# === Added by scripts/setup-borjie-env.mjs ===');
    expect(out).toContain('NEW_KEY=shiny');
  });

  it('handles empty original text gracefully', () => {
    const out = serialiseEnvFile('', { FOO: 'bar' });
    expect(out).toContain('FOO=bar');
  });
});

// ---------------------------------------------------------------------------
// mergeEnv — immutability + onlyIfPlaceholder gate
// ---------------------------------------------------------------------------
describe('mergeEnv', () => {
  it('never mutates inputs', () => {
    const a = { FOO: 'one' };
    const b = { FOO: 'two', BAR: 'three' };
    const out = mergeEnv(a, b);
    expect(a).toEqual({ FOO: 'one' });
    expect(b).toEqual({ FOO: 'two', BAR: 'three' });
    expect(out).toEqual({ FOO: 'two', BAR: 'three' });
  });

  it('preserves user-set value when onlyIfPlaceholder=true', () => {
    const base = { JWT_SECRET: 'real-secret-already-set' };
    const patch = { JWT_SECRET: 'newly-generated' };
    const out = mergeEnv(base, patch, { onlyIfPlaceholder: true });
    expect(out.JWT_SECRET).toBe('real-secret-already-set');
  });

  it('overwrites placeholder when onlyIfPlaceholder=true', () => {
    const base = { JWT_SECRET: 'TODO_BORJIE_GENERATE_openssl_rand_base64_48' };
    const patch = { JWT_SECRET: 'fresh-secret' };
    const out = mergeEnv(base, patch, { onlyIfPlaceholder: true });
    expect(out.JWT_SECRET).toBe('fresh-secret');
  });

  it('overwrites unconditionally without onlyIfPlaceholder', () => {
    const base = { JWT_SECRET: 'real-secret' };
    const patch = { JWT_SECRET: 'rotated' };
    const out = mergeEnv(base, patch);
    expect(out.JWT_SECRET).toBe('rotated');
  });

  it('adds new keys regardless of mode', () => {
    const base = {};
    const patch = { CRON_SECRET: 'abc' };
    expect(mergeEnv(base, patch).CRON_SECRET).toBe('abc');
    expect(mergeEnv(base, patch, { onlyIfPlaceholder: true }).CRON_SECRET).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// patchSupabaseKeys
// ---------------------------------------------------------------------------
describe('patchSupabaseKeys', () => {
  it('overrides the four Supabase fields', () => {
    const base = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://TODO_BORJIE_SUPABASE_PROJECT.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'TODO',
      SOMETHING_ELSE: 'preserved',
    };
    const patch = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcd1234.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJ-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJ-svc',
      SUPABASE_JWT_SECRET: 'jwt-real',
    };
    const out = patchSupabaseKeys(base, patch);
    expect(out.NEXT_PUBLIC_SUPABASE_URL).toBe('https://abcd1234.supabase.co');
    expect(out.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('eyJ-anon');
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('eyJ-svc');
    expect(out.SUPABASE_JWT_SECRET).toBe('jwt-real');
    expect(out.SOMETHING_ELSE).toBe('preserved');
  });

  it('only patches fields present in the patch', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'old-url' };
    const out = patchSupabaseKeys(base, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'new' });
    expect(out.NEXT_PUBLIC_SUPABASE_URL).toBe('old-url');
    expect(out.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// parseSupabaseApiKeysOutput — CLI output parsing
// ---------------------------------------------------------------------------
describe('parseSupabaseApiKeysOutput', () => {
  it('extracts anon / service_role / jwt_secret rows', () => {
    const raw = [
      'NAME           VALUE',
      '-------------  -------',
      'anon           eyJanon...',
      'service_role   eyJsvc...',
      'jwt_secret     hmacsecret123',
    ].join('\n');
    const out = parseSupabaseApiKeysOutput(raw);
    expect(out.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('eyJanon...');
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe('eyJsvc...');
    expect(out.SUPABASE_JWT_SECRET).toBe('hmacsecret123');
  });

  it('returns empty object on garbage input', () => {
    expect(parseSupabaseApiKeysOutput('')).toEqual({});
    expect(parseSupabaseApiKeysOutput('no api keys found')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// parseSupabaseProjectCreateOutput
// ---------------------------------------------------------------------------
describe('parseSupabaseProjectCreateOutput', () => {
  it('extracts ref and URL from typical CLI output', () => {
    const raw = 'Created a new project at https://abcdefgh12345678ijkl.supabase.co (ref: abcdefgh12345678ijkl)';
    const out = parseSupabaseProjectCreateOutput(raw);
    expect(out.ref).toMatch(/^[a-z0-9]{20}$/);
    expect(out.url).toContain('supabase.co');
  });

  it('returns undefined ref/url when nothing matches', () => {
    const out = parseSupabaseProjectCreateOutput('nothing useful here');
    expect(out.ref).toBeUndefined();
    expect(out.url).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseFlags — argv handling
// ---------------------------------------------------------------------------
describe('parseFlags', () => {
  it('defaults are safe', () => {
    const f = parseFlags([]);
    expect(f.dryRun).toBe(false);
    expect(f.yes).toBe(false);
    expect(f.skipSupabase).toBe(false);
    expect(f.projectName).toBe('borjie-dev');
  });

  it('parses --dry-run, --yes, --skip-supabase', () => {
    const f = parseFlags(['--dry-run', '--yes', '--skip-supabase']);
    expect(f.dryRun).toBe(true);
    expect(f.yes).toBe(true);
    expect(f.skipSupabase).toBe(true);
  });

  it('parses --project-name in both --x=v and --x v forms', () => {
    expect(parseFlags(['--project-name=foo']).projectName).toBe('foo');
    expect(parseFlags(['--project-name', 'bar']).projectName).toBe('bar');
  });

  it('parses --region', () => {
    expect(parseFlags(['--region', 'us-east-1']).region).toBe('us-east-1');
  });

  it('parses --help', () => {
    expect(parseFlags(['--help']).help).toBe(true);
    expect(parseFlags(['-h']).help).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkRequiredClis — mocked spawn
// ---------------------------------------------------------------------------
describe('checkRequiredClis', () => {
  it('returns empty when every CLI is found', () => {
    const fakeSpawn = () => ({ status: 0, stdout: 'v1.0.0' });
    const missing = checkRequiredClis(fakeSpawn);
    expect(missing).toEqual([]);
  });

  it('returns the missing CLIs when spawn fails', () => {
    const fakeSpawn = (cmd) => {
      if (cmd === 'supabase') return { status: 127, stdout: '' };
      return { status: 0, stdout: 'ok' };
    };
    const missing = checkRequiredClis(fakeSpawn);
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('supabase');
  });
});
