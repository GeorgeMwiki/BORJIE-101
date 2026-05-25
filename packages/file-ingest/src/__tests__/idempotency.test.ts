/**
 * Idempotency tests — re-ingesting the same file with the same plan must:
 *   - produce the same provenance hashes
 *   - NOT create duplicate entities
 *   - report attributes_skipped > 0 on the second pass
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCsv } from '../schema-sniff/csv-adapter.js';
import { inferSchema } from '../schema-sniff/infer.js';
import { proposeMappingHeuristic } from '../proposal/heuristic-map.js';
import { InMemoryEntityStoreService } from '../entity-store/InMemoryEntityStoreService.js';
import {
  ApprovalLedger,
  IngestExecutor,
  buildIngestPlan,
} from '../approval/index.js';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const TENANT = 'tenant-idem';

async function setup(fixture: string) {
  const store = new InMemoryEntityStoreService();
  const types = await store.listEntityTypes(TENANT);
  const text = read(fixture);
  const table = parseCsv(text);
  const schema = inferSchema(table);
  const proposal = proposeMappingHeuristic({
    schema,
    availableEntityTypes: types,
  });
  return { store, table, schema, proposal };
}

describe('idempotency', () => {
  it('re-running the SAME plan produces zero new entities + all attrs skipped', async () => {
    const { store, table, schema, proposal } = await setup('hr-roster.csv');
    const planArgs = {
      ingest_plan_id: 'plan-idem-1',
      file_hash: 'file-hash-fixed',
      conversation_id: 'conv-1',
      message_id: 'msg-1',
      table,
      schema,
      proposal,
      dryRun: false,
    };
    const plan = buildIngestPlan(planArgs);

    const ledger = new ApprovalLedger();
    ledger.propose(plan, 'alice');
    ledger.approve(plan.ingest_plan_id, 'bob');
    const executor = new IngestExecutor(store, ledger);

    const first = await executor.execute(plan, {
      tenant_id: TENANT,
      executor_actor_id: 'carol',
    });
    expect(first.entities_created).toEqual(8);
    expect(first.attributes_skipped).toEqual(0);
    expect(store.count(TENANT, 'employee')).toEqual(8);

    // Build a NEW plan with the SAME identity-bearing fields, then approve
    // + execute again via a fresh ledger + executor (real-world: a
    // re-ingest is a brand-new approval flow). Provenance hashes are
    // deterministic so every attribute write should be a no-op.
    const plan2 = buildIngestPlan({ ...planArgs, ingest_plan_id: 'plan-idem-1' });
    const ledger2 = new ApprovalLedger();
    ledger2.propose(plan2, 'alice');
    ledger2.approve(plan2.ingest_plan_id, 'bob');
    const executor2 = new IngestExecutor(store, ledger2);
    const second = await executor2.execute(plan2, {
      tenant_id: TENANT,
      executor_actor_id: 'carol',
    });

    expect(second.entities_created).toEqual(0);
    expect(second.attributes_written).toEqual(0);
    expect(second.attributes_skipped).toBeGreaterThan(0);
    // Crucially: no new entities created.
    expect(store.count(TENANT, 'employee')).toEqual(8);
  });

  it('re-running with a different plan_id but same file → still idempotent on overlapping rows', async () => {
    // The provenance hash depends on ingest_plan_id, so two DIFFERENT
    // plan ids over the same file produce DIFFERENT provenance hashes.
    // But entity_ids are derived deterministically from the dedup-key
    // columns + tenant + entity_type, so the SAME logical entities are
    // upserted (no duplicate rows in the store). attributes_written on
    // pass 2 may be > 0 because each is a fresh provenance hash, but the
    // entity count stays constant.
    const { store, table, schema, proposal } = await setup('hr-roster.csv');

    const plan1 = buildIngestPlan({
      ingest_plan_id: 'plan-A',
      file_hash: 'file-hash-fixed',
      conversation_id: 'conv-1',
      message_id: 'msg-1',
      table,
      schema,
      proposal,
      dryRun: false,
    });
    const plan2 = buildIngestPlan({
      ingest_plan_id: 'plan-B',
      file_hash: 'file-hash-fixed',
      conversation_id: 'conv-1',
      message_id: 'msg-2',
      table,
      schema,
      proposal,
      dryRun: false,
    });

    const ledger1 = new ApprovalLedger();
    ledger1.propose(plan1, 'alice');
    ledger1.approve(plan1.ingest_plan_id, 'bob');
    const ledger2 = new ApprovalLedger();
    ledger2.propose(plan2, 'alice');
    ledger2.approve(plan2.ingest_plan_id, 'bob');

    const executor = new IngestExecutor(store, ledger1);
    const first = await executor.execute(plan1, {
      tenant_id: TENANT,
      executor_actor_id: 'carol',
    });
    expect(first.entities_created).toEqual(8);

    const executor2 = new IngestExecutor(store, ledger2);
    const second = await executor2.execute(plan2, {
      tenant_id: TENANT,
      executor_actor_id: 'carol',
    });

    expect(second.entities_created).toEqual(0); // entities already exist
    // Total entity count is unchanged — no duplicates.
    expect(store.count(TENANT, 'employee')).toEqual(8);
  });

  it('hasProvenanceHash returns false for never-seen hashes after a write', async () => {
    // Sanity check on the negative side of the API contract: the store
    // can report "this hash was never written here" even after unrelated
    // writes have happened.
    const { store, table, schema, proposal } = await setup('vendor-list.csv');
    const plan = buildIngestPlan({
      ingest_plan_id: 'plan-vendors',
      file_hash: 'file-hash-vendors',
      conversation_id: 'conv-1',
      message_id: 'msg-1',
      table,
      schema,
      proposal,
      dryRun: false,
    });
    const ledger = new ApprovalLedger();
    ledger.propose(plan, 'alice');
    ledger.approve(plan.ingest_plan_id, 'bob');
    const executor = new IngestExecutor(store, ledger);
    await executor.execute(plan, {
      tenant_id: TENANT,
      executor_actor_id: 'carol',
    });

    const fakeHashSeen = await store.hasProvenanceHash(TENANT, 'definitely-not-real');
    expect(fakeHashSeen).toBe(false);
  });
});
