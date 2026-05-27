/**
 * Money-path audit (CLAUDE.md HARD RULE).
 *
 * Invariant: the IMMUTABLE money ledger (`ledgerEntries` table) may
 * only be written by `LedgerService.postJournalEntry`, which in turn
 * delegates to `DrizzleLedgerRepository.createEntries` (the single
 * authorised persistence point).
 *
 * This test greps the entire workspace for files that look like they
 * write to the money ledger directly and fails loudly if any new
 * caller appears. When the rule legitimately changes (e.g. a new
 * approved persistence layer), update {@link ALLOWED_LEDGER_WRITERS}
 * with an explicit justification.
 */
import { execSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { describe, it, expect } from 'vitest';

// Repo root is 4 levels up from this test file at runtime:
//   .../services/payments-ledger/src/__tests__/invariants
const REPO_ROOT = resolvePath(__dirname, '..', '..', '..', '..', '..');

/**
 * Allowed money-ledger writers — every entry must be justified. Adding
 * a new file here requires reviewer sign-off (it widens the financial
 * invariant blast radius).
 */
const ALLOWED_LEDGER_WRITERS = new Set<string>([
  // The authoritative persistence layer. Called only from LedgerService.
  'services/payments-ledger/src/repositories/drizzle-ledger-entry.repository.ts',
  // Demo-tenant seeder — never runs in production. Seeds canonical
  // sample transactions for the pilot demo org. Guarded by the
  // DEMO_TENANT_ID constant and the seed-only invocation path.
  'packages/database/src/seeds/demo-org-seed.ts',
]);

/**
 * Run a grep across services + packages and return the list of files
 * that match. Patterns target the canonical "direct money-ledger
 * write" signatures we want to forbid outside the allowed set.
 */
function findLedgerWriters(): readonly string[] {
  // `-l` lists matching files; `--include` restricts to TS sources;
  // multiple `-e` patterns OR together. We exclude tests, node_modules,
  // and dist directories explicitly via `--exclude-dir` so the grep
  // only inspects source under `services/` and `packages/`.
  const cmd = [
    'grep -r -l --binary-files=without-match',
    "--include='*.ts'",
    "--exclude-dir=node_modules",
    "--exclude-dir=dist",
    "--exclude-dir=__tests__",
    "--exclude-dir=.next",
    "-e 'INSERT INTO ledger_entries'",
    "-e '\\.insert(ledgerEntries)'",
    "-e 'drizzle.*ledgerEntries.*insert'",
    "services packages 2>/dev/null || true",
  ].join(' ');
  const out = execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Strip any leading `./` for portability across grep implementations.
    .map((line) => (line.startsWith('./') ? line.slice(2) : line));
}

describe('money-path audit', () => {
  it('only the allow-listed files write to the money ledger', () => {
    const writers = findLedgerWriters();
    const unexpected = writers.filter((file) => !ALLOWED_LEDGER_WRITERS.has(file));
    if (unexpected.length > 0) {
      const message = [
        'HARD RULE VIOLATION (CLAUDE.md): direct money-ledger writes detected.',
        'The only path to the immutable double-entry ledger is',
        'LedgerService.postJournalEntry → DrizzleLedgerRepository.createEntries.',
        'Offending files:',
        ...unexpected.map((file) => `  - ${file}`),
        '',
        'If this is intentional, add the file to ALLOWED_LEDGER_WRITERS in',
        'services/payments-ledger/src/__tests__/invariants/money-path-audit.test.ts',
        'with an inline justification and require reviewer sign-off.',
      ].join('\n');
      expect.fail(message);
    }
  });

  it('the allow-list still includes the authoritative drizzle repository', () => {
    expect(
      ALLOWED_LEDGER_WRITERS.has(
        'services/payments-ledger/src/repositories/drizzle-ledger-entry.repository.ts',
      ),
    ).toBe(true);
  });

  it('the demo-tenant seeder is allow-listed (seed-only, non-prod)', () => {
    expect(
      ALLOWED_LEDGER_WRITERS.has('packages/database/src/seeds/demo-org-seed.ts'),
    ).toBe(true);
  });
});
