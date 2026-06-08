/**
 * Unit tests for `check-client-bundle-clean.mjs` (client-inspection hardening,
 * 2026-06-09; adversarial-review fixes 2026-06-09).
 *
 * These prove the scanner WITHOUT a heavy Next.js build by planting fixture
 * files into temp dirs. Every planted secret is OBVIOUSLY fake (clearly not a
 * real value) so the gitleaks pre-commit hook stays clean. The pure helpers
 * are exercised directly, and the CLI is spawned end-to-end to assert exit
 * codes.
 *
 * Adversarial-review hardening covered here:
 *   1. Service-role JWT bypass — a 3-segment JWT whose base64url payload
 *      decodes to `role:"service_role"` (NO literal in the file) is caught;
 *      an anon JWT PASSES (anon keys are public).
 *   2. Expanded deny-list — Google/GCP/GitHub/Slack/Twilio/OpenAI-org/Bearer.
 *   3. Structural sentinel completeness — sentinels are derived from server
 *      prompt source at scan time; coverage scales with the codebase.
 *   4. Binary skip + UTF-8 best-effort (no extension allow-list).
 *   5. Base64-wrapped-secret rescan.
 *   6. Empty `.next/static` is an explicit loud FAIL (exit 2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  scanText,
  scanDir,
  runScan,
  maskValue,
  collectFiles,
  dirHasFiles,
  decodeJwtServiceRole,
  findServiceRoleJwt,
  extractBase64Decodes,
  derivePromptSentinels,
  SECRET_RULES,
  PROMPT_SENTINELS,
  CURATED_SENTINELS,
  PROMPT_SOURCE_ROOTS,
} from '../check-client-bundle-clean.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT = resolve(__filename, '..', '..', 'check-client-bundle-clean.mjs');

// ---------------------------------------------------------------------------
// Fixture builders — all OBVIOUSLY fake (gitleaks-safe).
// ---------------------------------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const FAKE_SIG = 'FAKESIGNATURE0000000000';

/** A FAKE but real-SHAPE service JWT whose payload base64url-decodes to service_role. */
const FAKE_SERVICE_JWT = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ role: 'service_role', iss: 'supabase', ref: 'FAKEPROJ' }),
  FAKE_SIG,
].join('.');

/** A FAKE anon JWT (public — must PASS). */
const FAKE_ANON_JWT = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ role: 'anon', iss: 'supabase', ref: 'FAKEPROJ' }),
  FAKE_SIG,
].join('.');

const FAKE_SK = 'sk_test_FAKEPLANTED000000000000000000';
// Legacy fixture kept for the literal-`service_role` rule.
const FAKE_SERVICE_ROLE_LINE =
  'const k="service_role";const j="eyJhbGciOiJFAKE.eyJyb2xlIjoic2VydmljZV9yb2xlIn0FAKE.SIGFAKE000000";';
const FAKE_PEM = '-----BEGIN RSA PRIVATE KEY-----\nFAKEPLANTEDKEYBYTES\n-----END RSA PRIVATE KEY-----';
const FAKE_AKIA = 'AKIAFAKEPLANTED00000';
const FAKE_GOOGLE = `AIza${'FAKEPLANTED00000000000000000000000000'.slice(0, 35)}`; // AIza + exactly 35
const FAKE_GITHUB = 'ghp_FAKEPLANTED0000000000000000000000000000'; // ghp_ + 40
const FAKE_SLACK = 'xoxb-FAKEPLANTED-000000000000';
const FAKE_TWILIO_AC = 'ACFIXTUREPLACEHOLDERNOTAREALSECRETX';
const FAKE_TWILIO_SK = 'SKFIXTUREPLACEHOLDERNOTAREALSECRETX';
const FAKE_OPENAI_ORG = 'org-FAKEPLANTED0000000000000';
const FAKE_GCP_SA =
  '{"type":"service_account","private_key":"FAKEPLANTEDPRIVATEKEYBYTES0000000000000000000000000000"}';
const FAKE_BEARER =
  'Authorization: Bearer FAKEPLANTEDBEARERTOKEN0000000000000000';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'borjie-client-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('maskValue', () => {
  it('masks the middle of a long value, keeping a short forensic prefix/suffix', () => {
    const masked = maskValue('sk_test_ABCDEFGHIJKLMNOP');
    expect(masked).not.toContain('ABCDEFGHIJKLMNOP');
    expect(masked.startsWith('sk_')).toBe(true);
    expect(masked).toContain('*');
  });
  it('does not echo short values verbatim', () => {
    expect(maskValue('secret12')).not.toBe('secret12');
  });
  it('handles empty / non-string input', () => {
    expect(maskValue('')).toBe('<empty>');
    expect(maskValue(undefined)).toBe('<empty>');
  });
});

describe('scanText — secret rules (existing)', () => {
  it('flags a literal service_role token', () => {
    const f = scanText('foo service_role bar', 'a.js');
    expect(f.some((x) => x.rule === 'supabase-service-role-literal')).toBe(true);
  });

  it('flags an sk_test style key', () => {
    const f = scanText(`const x="${FAKE_SK}"`, 'a.js');
    expect(f.some((x) => x.rule === 'openai-style-key')).toBe(true);
  });

  it('flags a PEM private-key header', () => {
    const f = scanText(FAKE_PEM, 'key.js');
    expect(f.some((x) => x.rule === 'pem-private-key-header')).toBe(true);
  });

  it('flags an AWS access-key id', () => {
    const f = scanText(`creds=${FAKE_AKIA}`, 'a.js');
    expect(f.some((x) => x.rule === 'aws-access-key-id')).toBe(true);
  });

  it('flags a high-entropy *_SECRET assignment', () => {
    const f = scanText('JWT_SECRET = "Zk39ahNXq72bcd84eHHfQ01ppLmZ0rT5xy"', 'a.js');
    expect(f.some((x) => x.rule === 'generic-secret-assignment')).toBe(true);
  });

  it('never echoes the matched secret value in the finding', () => {
    const f = scanText(`x="${FAKE_SK}"`, 'a.js');
    const hit = f.find((x) => x.rule === 'openai-style-key');
    expect(hit).toBeTruthy();
    expect(hit.sample).not.toContain('FAKEPLANTED');
  });
});

describe('scanText — expanded deny-list (hole #2)', () => {
  it('flags a Google API key (AIza…)', () => {
    const f = scanText(`const k="${FAKE_GOOGLE}"`, 'a.js');
    expect(f.some((x) => x.rule === 'google-api-key')).toBe(true);
  });

  it('flags a GCP service-account private_key field (header-agnostic)', () => {
    const f = scanText(FAKE_GCP_SA, 'a.js');
    expect(f.some((x) => x.rule === 'gcp-service-account-private-key')).toBe(true);
  });

  it('flags a GitHub token (ghp_…)', () => {
    const f = scanText(`token=${FAKE_GITHUB}`, 'a.js');
    expect(f.some((x) => x.rule === 'github-token')).toBe(true);
  });

  it('flags a Slack token (xoxb-…)', () => {
    const f = scanText(`const s="${FAKE_SLACK}"`, 'a.js');
    expect(f.some((x) => x.rule === 'slack-token')).toBe(true);
  });

  it('flags a Twilio Account SID (AC…) and API key SID (SK…)', () => {
    const fAc = scanText(`sid=${FAKE_TWILIO_AC}`, 'a.js');
    expect(fAc.some((x) => x.rule === 'twilio-account-sid')).toBe(true);
    const fSk = scanText(`key=${FAKE_TWILIO_SK}`, 'a.js');
    expect(fSk.some((x) => x.rule === 'twilio-api-key')).toBe(true);
  });

  it('flags an OpenAI organization id (org-…)', () => {
    const f = scanText(`const o="${FAKE_OPENAI_ORG}"`, 'a.js');
    expect(f.some((x) => x.rule === 'openai-org-id')).toBe(true);
  });

  it('flags an inlined Authorization: Bearer header', () => {
    const f = scanText(FAKE_BEARER, 'a.js');
    expect(f.some((x) => x.rule === 'authorization-bearer')).toBe(true);
  });
});

describe('scanText — service-role JWT bypass (hole #1)', () => {
  it('catches a 3-segment JWT whose decoded payload is service_role (no literal)', () => {
    // Sanity: the JWT shape contains NO literal `service_role` substring.
    expect(FAKE_SERVICE_JWT.includes('service_role')).toBe(false);
    const f = scanText(`const key="${FAKE_SERVICE_JWT}"`, 'env.js');
    expect(f.some((x) => x.rule === 'jwt-service-role-claim')).toBe(true);
    // The literal rule must NOT have fired (proves the decode path is what caught it).
    expect(f.some((x) => x.rule === 'supabase-service-role-literal')).toBe(false);
  });

  it('PASSES an anon JWT (anon keys are public)', () => {
    expect(FAKE_ANON_JWT.includes('service_role')).toBe(false);
    const f = scanText(`const anon="${FAKE_ANON_JWT}"`, 'env.js');
    expect(f.some((x) => x.kind === 'secret')).toBe(false);
  });

  it('still flags the legacy literal-service_role fixture line', () => {
    const f = scanText(FAKE_SERVICE_ROLE_LINE, 'env.js');
    expect(f.some((x) => x.rule === 'supabase-service-role-literal')).toBe(true);
  });

  it('decodeJwtServiceRole returns the role only for non-public roles', () => {
    const svcPayload = b64url({ role: 'service_role' });
    const anonPayload = b64url({ role: 'anon' });
    const authedPayload = b64url({ role: 'authenticated' });
    expect(decodeJwtServiceRole(svcPayload)).toBe('service_role');
    expect(decodeJwtServiceRole(anonPayload)).toBeNull();
    expect(decodeJwtServiceRole(authedPayload)).toBeNull();
    expect(decodeJwtServiceRole('not-base64-$$$')).toBeNull();
    expect(decodeJwtServiceRole(123)).toBeNull();
  });

  it('findServiceRoleJwt returns the match + role for a service JWT, null otherwise', () => {
    const hit = findServiceRoleJwt(`x=${FAKE_SERVICE_JWT}`);
    expect(hit).toBeTruthy();
    expect(hit.role).toBe('service_role');
    expect(findServiceRoleJwt(`x=${FAKE_ANON_JWT}`)).toBeNull();
    expect(findServiceRoleJwt('no jwt here')).toBeNull();
  });
});

describe('scanText — base64-wrapped secret rescan (hole #5)', () => {
  it('catches a service-role JWT hidden inside a base64 string literal', () => {
    const wrapped = Buffer.from(`leak=${FAKE_SERVICE_JWT}`, 'utf8').toString('base64');
    // Sanity: the outer text has no literal/raw JWT or service_role.
    expect(wrapped.includes('service_role')).toBe(false);
    expect(wrapped.includes('eyJ')).toBe(false);
    const f = scanText(`const blob="${wrapped}";`, 'chunk.js');
    expect(f.some((x) => x.kind === 'secret')).toBe(true);
    expect(f.some((x) => /base64-wrapped/.test(x.description))).toBe(true);
  });

  it('catches an sk_ key hidden inside a base64 string literal', () => {
    const wrapped = Buffer.from(`token ${FAKE_SK}`, 'utf8').toString('base64');
    const f = scanText(`const b="${wrapped}"`, 'chunk.js');
    expect(f.some((x) => x.kind === 'secret')).toBe(true);
  });

  it('extractBase64Decodes ignores short / non-printable blobs', () => {
    expect(extractBase64Decodes('short')).toEqual([]);
    // A long blob that decodes to binary noise should be dropped.
    const binBlob = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 255, 254, 253]).toString('base64').repeat(6);
    const decodes = extractBase64Decodes(binBlob);
    expect(decodes.every((d) => !d.includes('service_role'))).toBe(true);
  });
});

describe('scanText — clean / NEXT_PUBLIC + anon values pass', () => {
  it('passes a bundle that only references NEXT_PUBLIC_* env values', () => {
    const text =
      'const u=process.env.NEXT_PUBLIC_SUPABASE_URL;' +
      'const k=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;' +
      'export function App(){return u+k}';
    expect(scanText(text, 'app.js')).toEqual([]);
  });

  it('passes a bundle that inlines a public anon JWT', () => {
    const f = scanText(`const anon="${FAKE_ANON_JWT}";export default anon;`, 'app.js');
    expect(f).toEqual([]);
  });
});

describe('scanText — prompt-IP sentinels (curated floor)', () => {
  it('flags every curated server-only persona / kernel sentinel phrase', () => {
    for (const sentinel of CURATED_SENTINELS) {
      const f = scanText(`leading ${sentinel.phrase} trailing`, 'bundle.js');
      expect(f.some((x) => x.kind === 'prompt-ip')).toBe(true);
    }
  });

  it('does not flag ordinary app strings', () => {
    const f = scanText('export const Dashboard = () => <div>Welcome</div>', 'page.js');
    expect(f).toEqual([]);
  });
});

describe('prompt-sentinel structural derivation (hole #3)', () => {
  it('derives many sentinels from real server prompt source (not just the floor)', () => {
    // Real repo extraction: must be substantially more than the curated floor.
    expect(PROMPT_SENTINELS.length).toBeGreaterThan(CURATED_SENTINELS.length + 50);
    // Curated phrases are always present (the floor).
    for (const c of CURATED_SENTINELS) {
      expect(PROMPT_SENTINELS.some((s) => s.phrase === c.phrase)).toBe(true);
    }
  });

  it('is deterministic — two derivations produce identical phrase lists', () => {
    const a = derivePromptSentinels().map((s) => s.phrase);
    const b = derivePromptSentinels().map((s) => s.phrase);
    expect(a).toEqual(b);
  });

  it('falls back to exactly the curated floor when no source roots resolve', () => {
    const only = derivePromptSentinels({ roots: ['no/such/path/here'], repoRoot: root });
    expect(only.length).toBe(CURATED_SENTINELS.length);
    expect(only.map((s) => s.phrase).sort()).toEqual(
      CURATED_SENTINELS.map((s) => s.phrase).sort(),
    );
  });

  it('catches a derived sentinel lifted verbatim into a client chunk', () => {
    // Pick a long DERIVED sentinel (not one of the curated four) and plant it.
    const derivedOnly = PROMPT_SENTINELS.find(
      (s) => !CURATED_SENTINELS.some((c) => c.phrase === s.phrase),
    );
    expect(derivedOnly).toBeTruthy();
    const f = scanText(`const leaked="${derivedOnly.phrase}";`, 'chunk.js');
    expect(f.some((x) => x.kind === 'prompt-ip' && x.rule === derivedOnly.id)).toBe(true);
  });

  it('PROMPT_SOURCE_ROOTS names the persona, juniors, and kernel prompt sources', () => {
    expect(PROMPT_SOURCE_ROOTS.some((r) => r.includes('personas'))).toBe(true);
    expect(PROMPT_SOURCE_ROOTS.some((r) => r.includes('juniors'))).toBe(true);
    expect(PROMPT_SOURCE_ROOTS.some((r) => r.includes('prompt-layers'))).toBe(true);
  });
});

describe('scanDir + runScan — planted leak dir fails', () => {
  it('exits 1, names the planted secret file AND the planted .map file', () => {
    writeFileSync(join(root, 'chunk.js'), `console.log("${FAKE_SK}");${FAKE_SERVICE_ROLE_LINE}`);
    writeFileSync(join(root, 'chunk.js.map'), '{"version":3,"sources":["../src/secret.ts"]}');
    writeFileSync(join(root, 'safe.js'), 'export const ok=1');

    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(1);
    expect(result.report.passed).toBe(false);

    const files = result.report.findings.map((f) => f.file);
    expect(files).toContain('chunk.js');
    expect(files).toContain('chunk.js.map');
    expect(result.report.forbiddenFiles).toContain('chunk.js.map');

    expect(result.report.findings.some((f) => f.kind === 'source-map')).toBe(true);
    const secret = result.report.findings.find((f) => f.kind === 'secret');
    expect(secret).toBeTruthy();
    expect(secret.sample).not.toContain('FAKEPLANTED');
  });

  it('flags a base64url service-role JWT planted into a chunk', () => {
    writeFileSync(join(root, 'env-inline.js'), `export const K="${FAKE_SERVICE_JWT}";`);
    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.some((f) => f.rule === 'jwt-service-role-claim')).toBe(true);
  });

  it('flags a planted prompt-IP leak in a nested dir', () => {
    mkdirSync(join(root, 'chunks'), { recursive: true });
    writeFileSync(
      join(root, 'chunks', 'persona.js'),
      `const p="You are ${CURATED_SENTINELS[0].phrase} here";`,
    );
    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.some((f) => f.kind === 'prompt-ip')).toBe(true);
    expect(result.report.findings[0].file).toBe(join('chunks', 'persona.js'));
  });
});

describe('scanDir — binary skip + UTF-8 best-effort (hole #4)', () => {
  it('scans an extensionless text file (no allow-list) and catches its secret', () => {
    writeFileSync(join(root, 'LICENSE'), `embedded ${FAKE_SK}`);
    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.some((f) => f.file === 'LICENSE')).toBe(true);
  });

  it('skips a binary file with NUL bytes without crashing', () => {
    const bin = Buffer.concat([Buffer.from('PNG'), Buffer.from([0, 0, 0, 1, 2, 3])]);
    writeFileSync(join(root, 'image.bin'), bin);
    writeFileSync(join(root, 'ok.js'), 'export const a=1');
    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(0);
    expect(result.report.passed).toBe(true);
  });

  it('still flags a .map file even though its presence is the failure', () => {
    writeFileSync(join(root, 'app.js'), 'export const a=1');
    writeFileSync(join(root, 'app.js.map'), '{"version":3}');
    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(1);
    expect(result.report.forbiddenFiles).toContain('app.js.map');
  });
});

describe('scanDir + runScan — clean dir passes', () => {
  it('exits 0 for a dir with only NEXT_PUBLIC values + ordinary JS/CSS', () => {
    writeFileSync(
      join(root, 'main.js'),
      'const url=process.env.NEXT_PUBLIC_SUPABASE_URL;export default url;',
    );
    writeFileSync(join(root, 'app.css'), '.btn{color:#0a0}');
    mkdirSync(join(root, 'chunks'), { recursive: true });
    writeFileSync(join(root, 'chunks', 'vendor.js'), 'export const v="1.2.3"');

    const result = runScan({ dir: root });
    expect(result.exitCode).toBe(0);
    expect(result.report.passed).toBe(true);
    expect(result.report.scannedFiles).toBeGreaterThanOrEqual(3);
    expect(result.report.forbiddenFiles).toEqual([]);
    expect(result.report.sentinelCount).toBeGreaterThan(0);
  });
});

describe('runScan — missing / empty dir is a loud FAIL (hole #6)', () => {
  it('exits 2 when the target dir does not exist (build skipped)', () => {
    const result = runScan({ dir: join(root, 'does-not-exist') });
    expect(result.exitCode).toBe(2);
    expect(result.missing).toBe(true);
    expect(result.report).toBeNull();
  });

  it('exits 2 when the target dir exists but is EMPTY (no client output)', () => {
    mkdirSync(join(root, 'empty-static'), { recursive: true });
    const result = runScan({ dir: join(root, 'empty-static') });
    expect(result.exitCode).toBe(2);
    expect(result.empty).toBe(true);
    expect(result.missing).toBe(false);
    expect(result.report).toBeNull();
  });

  it('dirHasFiles is false for empty/missing and true for a populated dir', () => {
    expect(dirHasFiles(join(root, 'nope'))).toBe(false);
    mkdirSync(join(root, 'e'), { recursive: true });
    expect(dirHasFiles(join(root, 'e'))).toBe(false);
    writeFileSync(join(root, 'e', 'f.js'), 'x');
    expect(dirHasFiles(join(root, 'e'))).toBe(true);
  });
});

describe('collectFiles', () => {
  it('walks nested directories', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'deep.js'), 'x');
    writeFileSync(join(root, 'top.js'), 'y');
    const files = collectFiles(root);
    expect(files.length).toBe(2);
  });
});

describe('config invariants', () => {
  it('every secret rule has a stable id, description, and RegExp pattern', () => {
    for (const r of SECRET_RULES) {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.description).toBe('string');
      expect(r.pattern).toBeInstanceOf(RegExp);
    }
  });
  it('every prompt sentinel has an id and a non-trivial phrase', () => {
    for (const s of PROMPT_SENTINELS) {
      expect(typeof s.id).toBe('string');
      expect(s.phrase.length).toBeGreaterThan(8);
    }
  });
  it('the expanded deny-list includes the new high-value rules', () => {
    const ids = new Set(SECRET_RULES.map((r) => r.id));
    for (const want of [
      'google-api-key',
      'gcp-service-account-private-key',
      'github-token',
      'slack-token',
      'twilio-account-sid',
      'twilio-api-key',
      'openai-org-id',
      'authorization-bearer',
    ]) {
      expect(ids.has(want)).toBe(true);
    }
  });
});

describe('CLI end-to-end', () => {
  it('exits 0 against a clean fixture dir (human output)', () => {
    writeFileSync(join(root, 'ok.js'), 'export const a=process.env.NEXT_PUBLIC_X');
    const r = spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('CLEAN');
  });

  it('exits 1 against a planted-secret fixture dir and names the file (masked)', () => {
    writeFileSync(join(root, 'leak.js'), `const k="${FAKE_SK}"`);
    const r = spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('LEAK DETECTED');
    expect(r.stderr).toContain('leak.js');
    expect(r.stderr).not.toContain('FAKEPLANTED');
  });

  it('exits 2 when the dir is missing', () => {
    const r = spawnSync('node', [SCRIPT, join(root, 'nope')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not found');
  });

  it('exits 2 when the dir is empty (loud build-skipped fail)', () => {
    mkdirSync(join(root, 'empty'), { recursive: true });
    const r = spawnSync('node', [SCRIPT, join(root, 'empty')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('EMPTY');
  });

  it('emits valid JSON with --json', () => {
    writeFileSync(join(root, 'ok.js'), 'export const a=1');
    const r = spawnSync('node', [SCRIPT, root, '--json'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.passed).toBe(true);
    expect(parsed.findings).toEqual([]);
  });
});
