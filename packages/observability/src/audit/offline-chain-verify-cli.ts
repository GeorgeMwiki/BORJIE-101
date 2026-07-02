#!/usr/bin/env node
/**
 * Offline audit-chain verify CLI.
 *
 * Recomputes the hash-chain head of an EXPORTED audit chain (a portable JSON
 * dump produced by the recorder's export path or a DB snapshot serialized into
 * `AuditChainExport` shape) with ZERO database access, and prints a
 * machine-readable verdict. Fires the OTel integrity-failure metric + alert
 * hook on tamper so a paging integration wakes the security team even for an
 * offline batch run.
 *
 * This is the deliverable an external auditor runs: hand them a JSON export +
 * the signing secret (via env), they recompute the head themselves.
 *
 * Exit codes:
 *   0 — every chain verified clean
 *   1 — at least one broken chain (tamper / gap / head-mismatch)
 *   2 — usage / IO error
 *
 * Usage
 *   node offline-chain-verify-cli.js --export <path.json> [--json]
 *   # export may be a single AuditChainExport or an array of them (one/tenant)
 *
 * Environment
 *   AUDIT_TRAIL_SIGNING_SECRET — optional; when set, signatures are re-verified.
 */

import { readFileSync } from 'node:fs';
import {
  verifyAuditChainExport,
  type OfflineVerifyResult,
} from './offline-chain-verify.js';
import { createAuditIntegrityRecorder } from './integrity-metric.js';

interface CliArgs {
  readonly exportPath: string | null;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let exportPath: string | null = null;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--export') {
      exportPath = argv[++i] ?? null;
    } else if (a === '--json') {
      json = true;
    }
  }
  return { exportPath, json };
}

export function verifyExportsPayload(
  payload: unknown,
  signingSecret: string | null,
): OfflineVerifyResult[] {
  const recorder = createAuditIntegrityRecorder({
    onIntegrityFailure: (alert) => {
      // Structured stderr line so an offline run is greppable + pageable via
      // log-based alerting when no live OTel collector is attached.
      process.stderr.write(
        `AUDIT_INTEGRITY_FAILURE ${JSON.stringify(alert)}\n`,
      );
    },
  });
  const list = Array.isArray(payload) ? payload : [payload];
  return list.map((exp) =>
    recorder.record(verifyAuditChainExport(exp, { signingSecret })),
  );
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.exportPath) {
    process.stderr.write(
      'offline-chain-verify: --export <path.json> is required\n',
    );
    return 2;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(args.exportPath, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `offline-chain-verify: failed to read export: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 2;
  }

  const secret = process.env.AUDIT_TRAIL_SIGNING_SECRET ?? null;
  const results = verifyExportsPayload(payload, secret);
  const broken = results.filter((r) => !r.valid);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        { chainsVerified: results.length, broken: broken.length, results },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stderr.write(
      `offline-chain-verify: ${results.length} chain(s) checked, ${broken.length} broken — ${
        broken.length === 0 ? 'PASS' : 'FAIL'
      }\n`,
    );
    for (const b of broken) {
      process.stderr.write(
        `  [BROKEN] tenant=${b.tenantId} reason=${b.reason} brokenAt=${b.brokenAt} — ${b.detail}\n`,
      );
    }
  }

  return broken.length === 0 ? 0 : 1;
}

// Only run when invoked directly (not when imported by tests).
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /offline-chain-verify-cli\.(js|ts)$/.test(process.argv[1] ?? '');

if (isDirectRun) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(
        `offline-chain-verify: fatal ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(2);
    });
}
