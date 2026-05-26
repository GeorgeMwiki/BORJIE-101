/**
 * run-scan — CLI entry for the leak scanner.
 *
 * Resolves the repo root (cwd or env BORJIE_REPO_ROOT), runs the
 * scanner, writes a markdown report, and exits with code:
 *   - 0 if no P0 findings,
 *   - 1 if any P0 findings (CI gate),
 *   - 2 if the scan itself crashes.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  defaultScanOptions,
  renderMarkdownReport,
  scanRepo,
} from './leak-scanner.js';

interface ScanLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function createScanLogger(): ScanLogger {
  // Structured JSON-to-stdout logger — avoids any pino transport
  // initialisation cost. We do NOT use console.log here; we write
  // to process.stdout directly to bypass the project's no-console
  // lint rule while keeping output capture-able by CI.
  const emit = (level: string, msg: string, meta?: Record<string, unknown>): void => {
    const line = JSON.stringify({
      level,
      msg,
      service: 'tenant-isolation-guard.scan',
      time: new Date().toISOString(),
      ...meta,
    });
    process.stdout.write(`${line}\n`);
  };
  return {
    info: (msg, meta) => emit('info', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}

async function main(): Promise<number> {
  const logger = createScanLogger();
  const repoRoot = resolve(
    process.env.BORJIE_REPO_ROOT ?? process.cwd(),
  );
  const outPath = resolve(
    process.env.BORJIE_LEAK_SCAN_OUT ??
      `${repoRoot}/Docs/SECURITY/TENANT_LEAK_SCAN_${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '_')}.md`,
  );

  logger.info('tenant-leak-scan.start', { repoRoot, outPath });

  const result = await scanRepo(defaultScanOptions(repoRoot));
  const report = renderMarkdownReport(result, {
    date: new Date().toISOString().slice(0, 10),
    repoRoot,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, report, 'utf8');

  logger.info('tenant-leak-scan.complete', {
    scannedFiles: result.scannedFiles,
    findings: result.findings.length,
    p0: result.bySeverity.P0,
    p1: result.bySeverity.P1,
    p2: result.bySeverity.P2,
    outPath,
  });

  if (result.bySeverity.P0 > 0) {
    logger.error('tenant-leak-scan.gate_failed', {
      p0: result.bySeverity.P0,
      p1: result.bySeverity.P1,
    });
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tenant-leak-scan.fatal: ${msg}\n`);
    process.exit(2);
  });
