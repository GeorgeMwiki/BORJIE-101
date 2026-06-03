#!/usr/bin/env node
// @ts-check
// =============================================================================
// Borjie — Deploy Preflight (LP-22c)
// =============================================================================
// ONE command to de-risk a production deploy: the cron <-> handler coverage
// gate. Borjie's scheduled work runs as Kubernetes CronJob manifests under
// `infra/k8s/<name>/base/cronjob.yaml`; each must map to a REAL worker service
// directory under `services/<name>` and vice-versa. This is the Borjie analog
// of LITFIN's vercel-cron <-> route.ts gate (scripts/deploy-preflight.mjs).
//
// It asserts, and exits non-zero on any failure:
//
//   1. Orphan crons      — a CronJob manifest whose `<name>` has NO matching
//                          services/<name> directory (the schedule fires a
//                          handler that does not exist).
//   2. Image drift       — a CronJob whose container image basename does not
//                          encode its own `<name>` (a copy-paste manifest that
//                          would run the WRONG handler under the right
//                          schedule). E.g. cronjob "foo" shipping the
//                          "borjie-bar" image.
//   3. Uncovered workers — a worker service explicitly registered as
//                          cron-scheduled (in the CRON_WORKERS allowlist
//                          below) that has NO CronJob manifest (a scheduled
//                          job that will silently never run).
//
// Pure node, no external deps, no network. The check helpers are EXPORTED so
// scripts/__tests__/deploy-preflight.test.mjs can unit-test them against a
// synthetic tree without a live cluster.
//
// Usage:
//   node scripts/deploy-preflight.mjs            # gate the repo
//   node scripts/deploy-preflight.mjs --json     # machine-readable report
//   node scripts/deploy-preflight.mjs --root DIR # override repo root (tests)
// =============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');

/**
 * Worker services that MUST be backed by a CronJob manifest. Keep this list in
 * sync as scheduled workers are added — a worker named here with no
 * `infra/k8s/<name>/base/cronjob.yaml` fails the gate (uncovered worker). A
 * worker that runs as an always-on Deployment (interval loop) is deliberately
 * NOT listed.
 *
 * @type {ReadonlyArray<string>}
 */
export const CRON_WORKERS = ['apollo-gauntlet-runner', 'brain-evolution-worker'];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Parse the minimal fields the gate needs from a CronJob manifest body.
 * We do NOT pull in a YAML lib — a line scan for the two keys we care about
 * (`kind: CronJob`, the first container `image:`) is enough and keeps the
 * script dependency-free. Returns null when the doc is not a CronJob.
 *
 * @param {string} yamlText
 * @returns {{ isCronJob: boolean, image: string | null }}
 */
export function parseCronManifest(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  let isCronJob = false;
  let image = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^kind:\s*CronJob\b/.test(trimmed)) isCronJob = true;
    if (image === null) {
      const m = trimmed.match(/^image:\s*["']?([^"'\s]+)["']?/);
      if (m) image = m[1];
    }
  }
  return { isCronJob, image };
}

/**
 * Derive the service `<name>` a CronJob image is supposed to run. Borjie
 * images are `ghcr.io/<org>/borjie-<name>:<tag>` — strip the registry, the
 * `borjie-` prefix, and the `:tag`.
 *
 * @param {string | null} image
 * @returns {string | null}
 */
export function imageToServiceName(image) {
  if (!image) return null;
  const lastSeg = image.split('/').pop() ?? image;
  const noTag = lastSeg.split(':')[0];
  return noTag.replace(/^borjie-/, '');
}

/**
 * Cross-check declared CronJobs against the worker services that exist.
 *
 * @param {ReadonlyArray<{ name: string, image: string | null }>} cronJobs
 *   one entry per discovered CronJob manifest (name = its k8s dir).
 * @param {Set<string>} serviceDirs  every directory name under services/.
 * @param {ReadonlyArray<string>} cronWorkers  the CRON_WORKERS allowlist.
 * @returns {{
 *   orphanCrons: string[],
 *   imageDrift: Array<{ cron: string, expected: string, got: string | null }>,
 *   uncoveredWorkers: string[],
 * }}
 */
export function findCronCoverage(cronJobs, serviceDirs, cronWorkers) {
  const orphanCrons = [];
  const imageDrift = [];
  const coveredNames = new Set();

  for (const cj of cronJobs) {
    coveredNames.add(cj.name);
    if (!serviceDirs.has(cj.name)) {
      orphanCrons.push(cj.name);
    }
    const imageName = imageToServiceName(cj.image);
    if (imageName !== null && imageName !== cj.name) {
      imageDrift.push({ cron: cj.name, expected: cj.name, got: imageName });
    }
  }

  const uncoveredWorkers = cronWorkers.filter((w) => !coveredNames.has(w));
  return { orphanCrons, imageDrift, uncoveredWorkers };
}

// ---------------------------------------------------------------------------
// Filesystem discovery (thin; the pure helpers above hold the logic)
// ---------------------------------------------------------------------------

/**
 * Discover every CronJob manifest under `infra/k8s/<name>/base/cronjob.yaml`.
 *
 * @param {string} root
 * @returns {Array<{ name: string, image: string | null }>}
 */
export function discoverCronJobs(root) {
  const k8sDir = join(root, 'infra', 'k8s');
  if (!existsSync(k8sDir)) return [];
  /** @type {Array<{ name: string, image: string | null }>} */
  const out = [];
  for (const entry of readdirSync(k8sDir)) {
    const cronPath = join(k8sDir, entry, 'base', 'cronjob.yaml');
    if (!existsSync(cronPath)) continue;
    const parsed = parseCronManifest(readFileSync(cronPath, 'utf8'));
    if (parsed.isCronJob) out.push({ name: entry, image: parsed.image });
  }
  return out;
}

/**
 * List every directory name under `services/`.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
export function discoverServiceDirs(root) {
  const servicesDir = join(root, 'services');
  if (!existsSync(servicesDir)) return new Set();
  return new Set(
    readdirSync(servicesDir).filter((n) =>
      statSync(join(servicesDir, n)).isDirectory(),
    ),
  );
}

/**
 * Run the full gate against a repo root.
 *
 * @param {{ root?: string, cronWorkers?: ReadonlyArray<string> }} [opts]
 * @returns {{
 *   scannedAt: string,
 *   cronJobs: number,
 *   serviceDirs: number,
 *   orphanCrons: string[],
 *   imageDrift: Array<{ cron: string, expected: string, got: string | null }>,
 *   uncoveredWorkers: string[],
 *   passed: boolean,
 * }}
 */
export function runPreflight(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const cronWorkers = opts.cronWorkers ?? CRON_WORKERS;
  const cronJobs = discoverCronJobs(root);
  const serviceDirs = discoverServiceDirs(root);
  const { orphanCrons, imageDrift, uncoveredWorkers } = findCronCoverage(
    cronJobs,
    serviceDirs,
    cronWorkers,
  );
  const passed =
    orphanCrons.length === 0 &&
    imageDrift.length === 0 &&
    uncoveredWorkers.length === 0;
  return {
    scannedAt: new Date().toISOString(),
    cronJobs: cronJobs.length,
    serviceDirs: serviceDirs.size,
    orphanCrons,
    imageDrift,
    uncoveredWorkers,
    passed,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { json: false, root: undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const report = runPreflight(args.root ? { root: args.root } : {});

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stderr.write(
      `deploy-preflight: ${report.cronJobs} cronjob(s), ${report.serviceDirs} service(s) — ${report.passed ? 'PASS' : 'FAIL'}\n`,
    );
    for (const c of report.orphanCrons) {
      process.stderr.write(`  [orphan-cron] '${c}' has no services/${c}\n`);
    }
    for (const d of report.imageDrift) {
      process.stderr.write(
        `  [image-drift] cron '${d.cron}' ships image for '${d.got}'\n`,
      );
    }
    for (const w of report.uncoveredWorkers) {
      process.stderr.write(
        `  [uncovered-worker] '${w}' is cron-registered but has no cronjob.yaml\n`,
      );
    }
  }
  process.exit(report.passed ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === __filename;
if (invokedDirectly) main();
