/**
 * scripts/live-verify/verify-closed-loop.ts
 *
 * Closed-loop telemetry trace:
 *   1. INSERT a synthetic outcome_predictions row (with a 0-day
 *      horizon so the reconciler picks it up immediately).
 *   2. Run the outcome-reconciliation-worker tickOnce(). The
 *      tickOnce reads pending predictions, calls the registered
 *      observation resolver, and writes outcome_observations +
 *      outcome_reconciliations rows.
 *   3. Read back the three rows so the JSON evidence captures the
 *      full predict -> observe -> reconcile arc.
 *   4. Compute a calibration score over the just-written reconciliation.
 *
 * Writes /tmp/live-verify-closed-loop.json with each row preview.
 *
 * Usage
 *   pnpm tsx scripts/live-verify/verify-closed-loop.ts
 *
 * Env
 *   VERIFY_TENANT_ID  default 00000000-0000-0000-0000-000000000001
 *   DATABASE_URL      required, from .env.local
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import pino from 'pino';

import { createOutcomeReconciliationWorker } from '../../services/api-gateway/src/workers/outcome-reconciliation-worker';
import {
  createCalibrationTracker,
  type CalibrationTracker,
} from '../../services/api-gateway/src/services/calibration-monitor';

function loadDatabaseUrl(): string {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL'];
  // Fall back to .env.local at repo root.
  try {
    const env = readFileSync(resolvePath(__dirname, '../../.env.local'), 'utf8');
    const m = env.match(/^DATABASE_URL\s*=\s*(\S+)\s*$/m);
    if (m && m[1]) return m[1];
  } catch {
    // fallthrough
  }
  throw new Error('DATABASE_URL not configured');
}

const TENANT = process.env['VERIFY_TENANT_ID'] ?? '00000000-0000-0000-0000-000000000001';
const OUTPUT = process.env['VERIFY_OUTPUT'] ?? '/tmp/live-verify-closed-loop.json';

function log(line: string): void {
  process.stdout.write(line + '\n');
}

function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...[truncated]';
}

interface Phase {
  readonly name: string;
  readonly ok: boolean;
  readonly rows: number;
  readonly preview: string;
}

async function main(): Promise<void> {
  const dbUrl = loadDatabaseUrl();
  const client = postgres(dbUrl, { max: 2, prepare: false });
  const db = drizzle(client);
  const logger = pino({ level: 'warn', name: 'live-verify-closed-loop' });
  const phases: Phase[] = [];

  // Tag any rows we write so we can find them later
  const runTag = `live-verify-${Date.now()}`;
  const entityId = `mwadui-pml-${Date.now()}`;

  // --- bind the tenant GUC so RLS-bound rows are visible ---
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`);

  log('=== Phase 1. Insert outcome_predictions ===');

  await db.execute(sql`
    INSERT INTO outcome_predictions (
      tenant_id, actor_kind, actor_id,
      action_kind, action_target_entity_type, action_target_entity_id,
      predicted_outcome, prediction_confidence, prediction_horizon_days,
      predicted_value_tzs, rationale
    ) VALUES (
      ${TENANT}, 'brain', 'verify-runner',
      'mining.brain.scope.set', 'scope_node', ${entityId},
      ${sql`${JSON.stringify({ tag: runTag, royaltyFiled: true, value_tzs: 18_400_000 })}::jsonb`},
      0.78, 0, 18400000.00, 'live-verify closed-loop trace'
    )
  `);

  const predRows = await db.execute(sql`
    SELECT id, tenant_id, actor_kind, action_kind,
           action_target_entity_type, action_target_entity_id,
           predicted_outcome, prediction_confidence,
           prediction_horizon_days, predicted_value_tzs, created_at
      FROM outcome_predictions
     WHERE tenant_id = ${TENANT}
       AND action_target_entity_id = ${entityId}
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const predArr = (predRows as unknown as { rows?: unknown[] }).rows ?? (predRows as unknown as unknown[]);
  phases.push({
    name: 'insert.outcome_predictions',
    ok: Array.isArray(predArr) && predArr.length === 1,
    rows: Array.isArray(predArr) ? predArr.length : 0,
    preview: truncate(JSON.stringify(predArr)),
  });
  log(`  insert.outcome_predictions rows=${Array.isArray(predArr) ? predArr.length : 0}`);

  log('\n=== Phase 2. tickOnce() outcome-reconciliation-worker ===');
  // Build a one-off resolver for scope_node that returns a known observation.
  const observationResolvers = {
    scope_node: async () => ({
      observedOutcome: { tag: runTag, royaltyFiled: true, value_tzs: 18_200_000 },
      observedValueTzs: 18_200_000,
      narrative: 'live-verify observed scope_node state',
    }),
  };
  const worker = createOutcomeReconciliationWorker({
    db: db as unknown as { execute: (q: unknown) => Promise<unknown> },
    logger,
    resolvers: observationResolvers,
    enabled: false, // we drive tickOnce directly
  });
  const tickResult = await worker.tickOnce();
  phases.push({
    name: 'tickOnce.result',
    ok: tickResult.processed > 0 || tickResult.observed > 0,
    rows: tickResult.processed ?? 0,
    preview: truncate(JSON.stringify(tickResult)),
  });
  log(`  tickOnce processed=${tickResult.processed} observed=${tickResult.observed} matched=${tickResult.matched}`);

  log('\n=== Phase 3. Read outcome_observations ===');
  const obsRows = await db.execute(sql`
    SELECT id, prediction_id, tenant_id, observed_outcome,
           observed_value_tzs, narrative, observed_at
      FROM outcome_observations
     WHERE tenant_id = ${TENANT}
     ORDER BY observed_at DESC
     LIMIT 5
  `);
  const obsArr = (obsRows as unknown as { rows?: unknown[] }).rows ?? (obsRows as unknown as unknown[]);
  phases.push({
    name: 'read.outcome_observations',
    ok: Array.isArray(obsArr) && obsArr.length > 0,
    rows: Array.isArray(obsArr) ? obsArr.length : 0,
    preview: truncate(JSON.stringify(obsArr)),
  });
  log(`  outcome_observations rows=${Array.isArray(obsArr) ? obsArr.length : 0}`);

  log('\n=== Phase 4. Read outcome_reconciliations ===');
  const recRows = await db.execute(sql`
    SELECT id, prediction_id, observation_id, tenant_id,
           drift_score, status, learning_signal, reconciled_at
      FROM outcome_reconciliations
     WHERE tenant_id = ${TENANT}
     ORDER BY reconciled_at DESC
     LIMIT 5
  `);
  const recArr = (recRows as unknown as { rows?: unknown[] }).rows ?? (recRows as unknown as unknown[]);
  phases.push({
    name: 'read.outcome_reconciliations',
    ok: Array.isArray(recArr) && recArr.length > 0,
    rows: Array.isArray(recArr) ? recArr.length : 0,
    preview: truncate(JSON.stringify(recArr)),
  });
  log(`  outcome_reconciliations rows=${Array.isArray(recArr) ? recArr.length : 0}`);

  log('\n=== Phase 5. Calibration tracker score ===');
  const tracker: CalibrationTracker = createCalibrationTracker({
    db: db as unknown as { execute: (q: unknown) => Promise<unknown> },
    logger,
  });
  let calibrationScore: unknown = null;
  try {
    calibrationScore = await tracker.getCalibrationScore({ tenantId: TENANT, sinceDays: 30 });
    phases.push({
      name: 'calibration.score',
      ok: calibrationScore !== null,
      rows: 1,
      preview: truncate(JSON.stringify(calibrationScore)),
    });
    log(`  calibration.score ok preview=${JSON.stringify(calibrationScore).slice(0, 200)}`);
  } catch (err) {
    phases.push({
      name: 'calibration.score',
      ok: false,
      rows: 0,
      preview: `threw: ${(err as Error).message}`,
    });
    log(`  calibration.score THREW ${(err as Error).message}`);
  }

  // Persist
  const summary = {
    base: 'db-direct',
    tenant: TENANT,
    runAt: new Date().toISOString(),
    runTag,
    entityId,
    counts: {
      total: phases.length,
      pass: phases.filter((p) => p.ok).length,
      fail: phases.filter((p) => !p.ok).length,
    },
    phases,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));

  log('\n=== Summary ===');
  log(`Phases ${summary.counts.total} pass=${summary.counts.pass} fail=${summary.counts.fail}`);
  log(`Wrote ${OUTPUT}`);

  await client.end({ timeout: 5 });
}

main().catch((err) => {
  log(`FATAL: ${(err as Error).message}\n${(err as Error).stack}`);
  process.exitCode = 1;
});
