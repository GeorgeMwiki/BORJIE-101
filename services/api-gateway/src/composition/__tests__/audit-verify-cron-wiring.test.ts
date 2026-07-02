/**
 * audit-verify-cron-wiring.test.ts — SOURCE guard proving the AI audit-chain
 * verify cron is actually STARTED (and STOPPED on shutdown) from the composition
 * root `index.ts`.
 *
 * The cron is CONSTRUCTED in `service-registry.ts` (`auditVerifyCron`), and its
 * job is to record every verify verdict through the observability integrity
 * recorder — the `audit_chain_integrity_failures_total` metric + pager alert on
 * tamper. If nothing calls `.start()` on it, that production tamper-alert path
 * stays DARK regardless of how well the cron is wired. This guard makes a revert
 * of the start/stop wiring go RED, mirroring the sibling sovereign-ledger and
 * wake-loop cron start assertions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readIndexSource(): string {
  const here = fileURLToPath(import.meta.url);
  const indexPath = here.replace(
    'composition/__tests__/audit-verify-cron-wiring.test.ts',
    'index.ts',
  );
  return readFileSync(indexPath, 'utf8');
}

describe('audit-verify-cron wiring — started + stopped from index.ts', () => {
  it('index.ts CALLS serviceRegistry.auditVerifyCron?.start()', () => {
    const src = readIndexSource();
    expect(src).toMatch(/serviceRegistry\.auditVerifyCron\?\.start\(\)/);
  });

  it('index.ts CALLS serviceRegistry.auditVerifyCron?.stop() on shutdown', () => {
    const src = readIndexSource();
    expect(src).toMatch(/serviceRegistry\.auditVerifyCron\?\.stop\(\)/);
  });

  it('the start call sits beside the sibling sovereign-ledger verify start', () => {
    const src = readIndexSource();
    const sovereignIdx = src.indexOf(
      'serviceRegistry.sovereignLedgerVerifyCron?.start()',
    );
    const auditIdx = src.indexOf('serviceRegistry.auditVerifyCron?.start()');
    expect(sovereignIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    // Adjacent in the start block (audit start follows the sovereign sibling).
    expect(auditIdx).toBeGreaterThan(sovereignIdx);
  });
});
