/**
 * Unit tests for the deploy-preflight cron <-> handler coverage gate
 * (LP-22c). The pure helpers are tested directly against synthetic inputs;
 * the CLI is spawned against a temp repo tree so the real repo layout never
 * influences the outcome, and the real-repo invocation is asserted to PASS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseCronManifest,
  imageToServiceName,
  findCronCoverage,
  runPreflight,
} from '../deploy-preflight.mjs';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT = resolve(__filename, '..', '..', 'deploy-preflight.mjs');
const REPO_ROOT = resolve(__filename, '..', '..', '..');

describe('parseCronManifest', () => {
  it('detects a CronJob and its first image', () => {
    const yaml = [
      'apiVersion: batch/v1',
      'kind: CronJob',
      'spec:',
      '  containers:',
      '    - name: foo',
      '      image: ghcr.io/org/borjie-foo:latest',
    ].join('\n');
    expect(parseCronManifest(yaml)).toEqual({
      isCronJob: true,
      image: 'ghcr.io/org/borjie-foo:latest',
    });
  });

  it('returns isCronJob=false for a Deployment', () => {
    expect(parseCronManifest('kind: Deployment\n')).toEqual({
      isCronJob: false,
      image: null,
    });
  });
});

describe('imageToServiceName', () => {
  it('strips registry, borjie- prefix, and tag', () => {
    expect(imageToServiceName('ghcr.io/org/borjie-brain-evolution-worker:latest')).toBe(
      'brain-evolution-worker',
    );
  });
  it('handles a bare image without prefix or tag', () => {
    expect(imageToServiceName('apollo-gauntlet-runner')).toBe('apollo-gauntlet-runner');
  });
  it('returns null for null', () => {
    expect(imageToServiceName(null)).toBeNull();
  });
});

describe('findCronCoverage', () => {
  const services = new Set(['svc-a', 'svc-b', 'cron-worker']);

  it('passes when crons map to services with matching images', () => {
    const res = findCronCoverage(
      [{ name: 'cron-worker', image: 'ghcr.io/o/borjie-cron-worker:latest' }],
      services,
      ['cron-worker'],
    );
    expect(res.orphanCrons).toEqual([]);
    expect(res.imageDrift).toEqual([]);
    expect(res.uncoveredWorkers).toEqual([]);
  });

  it('flags an orphan cron (no matching service dir)', () => {
    const res = findCronCoverage(
      [{ name: 'ghost', image: 'ghcr.io/o/borjie-ghost:latest' }],
      services,
      [],
    );
    expect(res.orphanCrons).toEqual(['ghost']);
  });

  it('flags image drift (cron ships the wrong handler image)', () => {
    const res = findCronCoverage(
      [{ name: 'svc-a', image: 'ghcr.io/o/borjie-svc-b:latest' }],
      services,
      [],
    );
    expect(res.imageDrift).toEqual([
      { cron: 'svc-a', expected: 'svc-a', got: 'svc-b' },
    ]);
  });

  it('flags an uncovered cron-registered worker', () => {
    const res = findCronCoverage([], services, ['cron-worker']);
    expect(res.uncoveredWorkers).toEqual(['cron-worker']);
  });
});

describe('runPreflight against a synthetic tree', () => {
  let root;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'borjie-preflight-'));
    // Two services; one cron-worker, one always-on.
    mkdirSync(join(root, 'services', 'good-worker'), { recursive: true });
    mkdirSync(join(root, 'services', 'http-svc'), { recursive: true });
    // A matching CronJob for good-worker.
    mkdirSync(join(root, 'infra', 'k8s', 'good-worker', 'base'), { recursive: true });
    writeFileSync(
      join(root, 'infra', 'k8s', 'good-worker', 'base', 'cronjob.yaml'),
      'kind: CronJob\nspec:\n  image: ghcr.io/o/borjie-good-worker:latest\n',
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes a clean synthetic tree', () => {
    const report = runPreflight({ root, cronWorkers: ['good-worker'] });
    expect(report.passed).toBe(true);
    expect(report.cronJobs).toBe(1);
  });

  it('fails when a required cron worker has no manifest', () => {
    const report = runPreflight({ root, cronWorkers: ['good-worker', 'missing-worker'] });
    expect(report.passed).toBe(false);
    expect(report.uncoveredWorkers).toContain('missing-worker');
  });
});

describe('deploy-preflight CLI', () => {
  it('exits 0 against the real repo (crons all map to real services)', () => {
    const r = spawnSync('node', [SCRIPT, '--json', '--root', REPO_ROOT], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.passed).toBe(true);
    expect(out.orphanCrons).toEqual([]);
  });

  it('exits 1 when a synthetic tree has an orphan cron', () => {
    const root = mkdtempSync(join(tmpdir(), 'borjie-preflight-fail-'));
    mkdirSync(join(root, 'infra', 'k8s', 'ghost', 'base'), { recursive: true });
    writeFileSync(
      join(root, 'infra', 'k8s', 'ghost', 'base', 'cronjob.yaml'),
      'kind: CronJob\n',
    );
    mkdirSync(join(root, 'services'), { recursive: true });
    try {
      const r = spawnSync('node', [SCRIPT, '--json', '--root', root], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).orphanCrons).toContain('ghost');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
