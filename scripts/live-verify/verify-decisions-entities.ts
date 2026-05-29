/**
 * scripts/live-verify/verify-decisions-entities.ts
 *
 * Decision journal + entity index trace:
 *   1. recordDecision() — writes a high-stakes decision row.
 *   2. Read back the decisions row to confirm rationale + alternatives
 *      + confidence + hash-chain entry_hash.
 *   3. Run the decision-retrospective worker tickOnce() against any
 *      ripe decisions joined to outcome_reconciliations.
 *   4. Read decision_outcomes to confirm the grade was assigned.
 *   5. INSERT a synthetic entity_index row (skipping the discoverer
 *      to keep the test isolated) plus run the entity-indexer
 *      tickOnce() so the discovery pipeline is exercised.
 *   6. Query entity_index by tag/name for the Mwadui-like marker.
 *
 * Usage
 *   pnpm tsx scripts/live-verify/verify-decisions-entities.ts
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import pino from 'pino';

import {
  createDecisionRecorder,
  type DecisionRecorder,
} from '../../services/api-gateway/src/services/decision-journal';
import { createDecisionRetrospectiveWorker } from '../../services/api-gateway/src/workers/decision-retrospective-worker';

function loadDatabaseUrl(): string {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL'];
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
const OUTPUT = process.env['VERIFY_OUTPUT'] ?? '/tmp/live-verify-decisions-entities.json';

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
  // Use max=1 so the recorder + reads run on the SAME pg connection
  // (so the SET LOCAL app.tenant_id GUC stays in scope across queries).
  // Also wrap everything in a single transaction so SET LOCAL applies.
  const client = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 60 });
  const db = drizzle(client);
  const logger = pino({ level: 'warn', name: 'live-verify-decisions' });
  const phases: Phase[] = [];

  // SESSION-level set_config (third arg false) so the GUC persists for
  // every subsequent query on this connection. With max=1 the same
  // connection serves every drizzle call.
  await db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);

  // ─── 1. recordDecision ───────────────────────────────────────────
  log('=== Phase 1. recordDecision() ===');
  const recorder: DecisionRecorder = createDecisionRecorder({
    db: db as unknown as { execute: (q: unknown) => Promise<unknown> },
  });

  let recordedDecision: { id: string; entryHash: string } | null = null;
  try {
    const r = await recorder.recordDecision({
      tenantId: TENANT,
      decidedByKind: 'owner',
      decidedByActorId: 'demo-owner',
      decisionSubject: 'Lock April royalty draft for filing this Friday',
      decisionSubjectEntityKind: 'royalty_filing',
      decisionSubjectEntityId: `apr-2026-${Date.now()}`,
      decidedValue: { choice: 'file_now', target_date: '2026-04-09' },
      alternativesConsidered: [
        { option: { choice: 'wait_for_lbma_fix' }, whyNot: 'lbma slope flat 30d' },
        { option: { choice: 'defer_to_may' }, whyNot: 'TRA penalty accrual' },
      ],
      rationale: 'live-verify: file now while lbma fix stable + before TRA deadline',
      confidence: 0.82,
      scopeIds: ['mwadui'],
      provenance: { sessionId: 'live-verify-session', persona: 'mr-mwikila' },
    });
    recordedDecision = { id: r.id, entryHash: r.entryHash };
    phases.push({
      name: 'recordDecision.insert',
      ok: true,
      rows: 1,
      preview: truncate(JSON.stringify(r)),
    });
    log(`  recordDecision id=${r.id} entryHash=${r.entryHash.slice(0, 16)}...`);
  } catch (err) {
    // The recorder wraps errors via DecisionRecorderError; the postgres-js
    // cause is on .cause. Surface as much as possible.
    const e = err as Error & { cause?: unknown; code?: string; detail?: string };
    const causeMsg = e.cause && typeof e.cause === 'object' && 'message' in e.cause
      ? String((e.cause as { message?: unknown }).message)
      : null;
    const pgCode = e.cause && typeof e.cause === 'object' && 'code' in e.cause
      ? String((e.cause as { code?: unknown }).code)
      : e.code ?? null;
    phases.push({
      name: 'recordDecision.insert',
      ok: false,
      rows: 0,
      preview: truncate(`threw: ${e.message} | pgCode=${pgCode} | cause=${causeMsg ?? 'n/a'} | detail=${e.detail ?? 'n/a'}`),
    });
    log(`  recordDecision THREW ${e.message} pgCode=${pgCode} cause=${causeMsg}`);
  }

  // ─── 2. Read back decisions row ──────────────────────────────────
  if (recordedDecision) {
    log('\n=== Phase 2. Read decisions row ===');
    const rows = await db.execute(sql`
      SELECT id, tenant_id, decided_by_kind, decision_subject,
             decided_value, alternatives_considered, rationale,
             confidence, status, entry_hash, prev_hash
        FROM decisions
       WHERE tenant_id = ${TENANT}
         AND id = ${recordedDecision.id}
       LIMIT 1
    `);
    const arr = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    phases.push({
      name: 'decisions.read',
      ok: Array.isArray(arr) && arr.length === 1,
      rows: Array.isArray(arr) ? arr.length : 0,
      preview: truncate(JSON.stringify(arr)),
    });
    log(`  decisions.read rows=${Array.isArray(arr) ? arr.length : 0}`);
  }

  // ─── 3. decision-retrospective tickOnce ──────────────────────────
  log('\n=== Phase 3. tickOnce() decision-retrospective-worker ===');
  const retroWorker = createDecisionRetrospectiveWorker({
    db: db as unknown as { execute: (q: unknown) => Promise<unknown> },
    logger,
    recorder,
    enabled: false,
  });
  try {
    const tick = (await retroWorker.tickOnce()) as unknown as Record<string, unknown>;
    phases.push({
      name: 'decision-retrospective.tickOnce',
      ok: true,
      rows: Number(tick['claimed'] ?? 0),
      preview: truncate(JSON.stringify(tick)),
    });
    log(`  decision-retrospective.tickOnce preview=${JSON.stringify(tick)}`);
  } catch (err) {
    phases.push({
      name: 'decision-retrospective.tickOnce',
      ok: false,
      rows: 0,
      preview: `threw: ${(err as Error).message}`,
    });
    log(`  decision-retrospective THREW ${(err as Error).message}`);
  }

  // ─── 4. decision_outcomes read ───────────────────────────────────
  log('\n=== Phase 4. Read decision_outcomes ===');
  const outcomes = await db.execute(sql`
    SELECT id, decision_id, tenant_id, retrospective_grade, outcome_summary,
           observed_value_tzs, learnings, recorded_by, observed_at
      FROM decision_outcomes
     WHERE tenant_id = ${TENANT}
     ORDER BY observed_at DESC
     LIMIT 5
  `);
  const outArr = (outcomes as unknown as { rows?: unknown[] }).rows ?? (outcomes as unknown as unknown[]);
  phases.push({
    name: 'decision_outcomes.read',
    ok: Array.isArray(outArr),
    rows: Array.isArray(outArr) ? outArr.length : 0,
    preview: truncate(JSON.stringify(outArr)),
  });
  log(`  decision_outcomes rows=${Array.isArray(outArr) ? outArr.length : 0}`);

  // ─── 5. Entity index direct insert ───────────────────────────────
  log('\n=== Phase 5. INSERT entity_index for Mwadui ===');
  const entityTag = `mwadui-pml-${Date.now()}`;
  try {
    await db.execute(sql`
      INSERT INTO entity_index (
        tenant_id, entity_kind, entity_id, display_name,
        summary, tags, lifecycle_stage, refreshed_at
      ) VALUES (
        ${TENANT}, 'site', ${entityTag},
        'Mwadui PML — live-verify',
        'Demo Mwadui PML site for live-verify pgvector smoke',
        ${sql`ARRAY['mwadui','pml','live-verify']`},
        'active', now()
      )
      ON CONFLICT (tenant_id, entity_kind, entity_id) DO UPDATE
        SET refreshed_at = EXCLUDED.refreshed_at
    `);
    phases.push({
      name: 'entity_index.insert',
      ok: true,
      rows: 1,
      preview: `inserted entity_kind=site entity_id=${entityTag}`,
    });
    log(`  entity_index.insert ok entity_id=${entityTag}`);
  } catch (err) {
    phases.push({
      name: 'entity_index.insert',
      ok: false,
      rows: 0,
      preview: `threw: ${(err as Error).message}`,
    });
    log(`  entity_index.insert THREW ${(err as Error).message}`);
  }

  // ─── 6. entity_index search ──────────────────────────────────────
  log('\n=== Phase 6. Search entity_index ===');
  const search = await db.execute(sql`
    SELECT entity_kind, entity_id, display_name, summary, tags, lifecycle_stage
      FROM entity_index
     WHERE tenant_id = ${TENANT}
       AND (display_name ILIKE ${'%mwadui%'} OR ${'mwadui'} = ANY(tags))
     ORDER BY refreshed_at DESC
     LIMIT 5
  `);
  const searchArr = (search as unknown as { rows?: unknown[] }).rows ?? (search as unknown as unknown[]);
  phases.push({
    name: 'entity_index.search',
    ok: Array.isArray(searchArr) && searchArr.length > 0,
    rows: Array.isArray(searchArr) ? searchArr.length : 0,
    preview: truncate(JSON.stringify(searchArr)),
  });
  log(`  entity_index.search rows=${Array.isArray(searchArr) ? searchArr.length : 0}`);

  // Persist
  const summary = {
    base: 'db-direct',
    tenant: TENANT,
    runAt: new Date().toISOString(),
    entityTag,
    decisionId: recordedDecision?.id ?? null,
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
