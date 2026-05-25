import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scanHardcodedData,
  summarize,
} from '../scanners/hardcoded-data-scanner.js';

let rootDir = '';

function write(file: string, body: string): void {
  const full = join(rootDir, file);
  const dir = full.substring(0, full.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'audit-hd-'));
});

afterAll(() => {
  if (rootDir) rmSync(rootDir, { recursive: true, force: true });
});

describe('hardcoded-data-scanner', () => {
  it('catches Anthropic + OpenAI + Stripe-shaped tokens in production code', () => {
    // Strings built via concatenation so GitHub secret-scanning doesn't flag
    // THIS source file. The written fixture (in tmpdir) contains the literal
    // pattern the scanner is meant to catch; the test source does not.
    const fakeAntKey = 'sk-' + 'ant-' + 'api03-' + 'A'.repeat(41);
    const fakeOaiKey = 'sk-' + 'proj-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const fakeStripeKey = 'sk_' + 'live_' + 'abcdefghijklmnopqrstuvwx';
    write(
      'services/api-gateway/src/secrets.ts',
      `const ant = '${fakeAntKey}';\n` +
        `const oai = '${fakeOaiKey}';\n` +
        `const stripe = '${fakeStripeKey}';\n`,
    );
    const findings = scanHardcodedData({ root: rootDir });
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has('anthropic-api-key')).toBe(true);
    expect(kinds.has('openai-api-key')).toBe(true);
    expect(kinds.has('stripe-secret-key')).toBe(true);
    const critical = findings.filter((f) => f.severity === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(3);
  });

  it('does NOT flag tenant IDs inside seeds/ or __tests__/', () => {
    write(
      'packages/database/src/seeds/example-seed.ts',
      `export const seedTenantId = 'tnt_acme_fixture_123456';\n`,
    );
    write(
      'packages/some/src/foo/__tests__/example.test.ts',
      `const tenant = 'tnt_test_fixture_abc123';\n`,
    );
    const findings = scanHardcodedData({ root: rootDir });
    const tenantFindings = findings.filter((f) => f.kind === 'tenant-id');
    expect(tenantFindings.length).toBe(0);
  });

  it('DOES flag tenant IDs hardcoded in production paths', () => {
    write(
      'packages/somelib/src/leak.ts',
      `export const leakyId = 'tnt_acme_prod_abcdef123';\n`,
    );
    const findings = scanHardcodedData({ root: rootDir });
    const leak = findings.find(
      (f) =>
        f.kind === 'tenant-id' &&
        f.file.includes('packages/somelib/src/leak.ts'),
    );
    expect(leak).toBeDefined();
    expect(leak?.severity).toBe('high');
  });

  it('skips external URLs that match the vendor allow-list', () => {
    write(
      'apps/customer-app/src/api.ts',
      `const aiUrl = 'https://api.anthropic.com/v1/messages';\n` +
        `const evil = 'https://evil.example.io/exfiltrate';\n`,
    );
    const findings = scanHardcodedData({ root: rootDir });
    const urls = findings.filter((f) => f.kind === 'external-url');
    // anthropic allowed; evil flagged. The example.com is on the
    // allow-list (corporate website), example.io is NOT.
    expect(urls.some((u) => u.matched.includes('evil.example.io'))).toBe(true);
    expect(urls.some((u) => u.matched.includes('api.anthropic.com'))).toBe(
      false,
    );
  });

  it('flags not-implemented stubs', () => {
    write(
      'services/foo/src/wip.ts',
      `function todo() { throw new Error('not implemented yet'); }\n` +
        `function nullStub() { return null as any; }\n`,
    );
    const findings = scanHardcodedData({ root: rootDir });
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has('not-implemented-stub')).toBe(true);
    expect(kinds.has('null-as-any-stub')).toBe(true);
  });

  it('summarize() partitions findings correctly', () => {
    const sum = summarize([
      {
        file: 'a',
        line: 1,
        kind: 'tenant-id',
        snippet: '',
        severity: 'high',
        matched: '',
      },
      {
        file: 'a',
        line: 2,
        kind: 'anthropic-api-key',
        snippet: '',
        severity: 'critical',
        matched: '',
      },
      {
        file: 'b',
        line: 3,
        kind: 'tenant-id',
        snippet: '',
        severity: 'high',
        matched: '',
      },
    ]);
    expect(sum.total).toBe(3);
    expect(sum.critical).toBe(1);
    expect(sum.high).toBe(2);
    expect(sum.byKind['tenant-id']).toBe(2);
  });
});
