/**
 * IngestToolStub — proves the API surface the ai-copilot package will wire
 * into Mr. Mwikila's tool list (post-CL-B2). This test is *not* an LLM tool
 * implementation; it is a contract test demonstrating that the public
 * surface of @borjie/file-ingest supports the end-to-end conversational
 * flow:
 *
 *   1. user uploads CSV → handler hashes file
 *   2. parser produces a ParsedTable
 *   3. schema-sniffer infers the schema
 *   4. heuristic proposal — sufficient confidence → auto-map (no LLM call)
 *   5. plan built → ledger records propose
 *   6. owner approves (4-eye)
 *   7. executor commits + ledger marks executed
 *   8. handler returns chat-ready report with tab link
 *
 * If ai-copilot eventually wraps this flow in a "ingest-file" tool, this
 * test acts as the API contract.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ApprovalLedger,
  AUTO_MAP_THRESHOLD,
  IngestExecutor,
  InMemoryEntityStoreService,
  buildIngestPlan,
  hashFileBytes,
  inferSchema,
  parseCsv,
  proposeMappingHeuristic,
  routeByConfidence,
} from '../index.js';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__');

interface ChatIngestRequest {
  readonly tenant_id: string;
  readonly conversation_id: string;
  readonly message_id: string;
  readonly fileBytes: Buffer;
  readonly fileFormat: 'csv';
  readonly proposer_actor_id: string;
  readonly approver_actor_id: string;
  /** 4-eye: executor must differ from BOTH proposer and approver. */
  readonly executor_actor_id: string;
}

interface ChatIngestResponse {
  readonly summary: string;
  readonly tab_link: string;
  readonly entities_created: number;
  readonly entities_processed: number;
  readonly route: ReturnType<typeof routeByConfidence>;
}

/**
 * The reference flow the ai-copilot tool will invoke. Production wiring
 * will branch on `route === 'llm-proposal'` and call an LLM; this stub
 * proves the surface is sufficient for the auto-map path (the easy case).
 */
async function runIngestFlow(req: ChatIngestRequest): Promise<ChatIngestResponse> {
  const store = new InMemoryEntityStoreService();
  const types = await store.listEntityTypes(req.tenant_id);

  const fileHash = hashFileBytes(req.fileBytes);

  if (req.fileFormat !== 'csv') {
    throw new Error('stub only handles csv');
  }
  const table = parseCsv(req.fileBytes.toString('utf8'));
  const schema = inferSchema(table);
  const heuristic = proposeMappingHeuristic({
    schema,
    availableEntityTypes: types,
  });
  const route = routeByConfidence(heuristic.confidence);

  const planId = `plan-${fileHash.slice(0, 12)}`;
  const plan = buildIngestPlan({
    ingest_plan_id: planId,
    file_hash: fileHash,
    conversation_id: req.conversation_id,
    message_id: req.message_id,
    table,
    schema,
    proposal: heuristic,
    dryRun: false,
  });

  const ledger = new ApprovalLedger();
  ledger.propose(plan, req.proposer_actor_id);
  ledger.approve(plan.ingest_plan_id, req.approver_actor_id);

  const executor = new IngestExecutor(store, ledger);
  const report = await executor.execute(plan, {
    tenant_id: req.tenant_id,
    executor_actor_id: req.executor_actor_id,
  });

  return {
    summary:
      `Ingested ${report.entities_created} new ${report.entity_type} entities ` +
      `(${report.attributes_written} attributes). ${report.attributes_skipped} ` +
      `duplicate attributes skipped.`,
    tab_link: report.tab_link,
    entities_created: report.entities_created,
    entities_processed: report.entities_processed,
    route,
  };
}

describe('IngestToolStub — end-to-end API surface', () => {
  it('HR roster CSV completes the auto-map happy path', async () => {
    const bytes = readFileSync(join(FIXTURES, 'hr-roster.csv'));
    const res = await runIngestFlow({
      tenant_id: 'tenant-1',
      conversation_id: 'conv-42',
      message_id: 'msg-1',
      fileBytes: bytes,
      fileFormat: 'csv',
      proposer_actor_id: 'mr-mwikila',
      approver_actor_id: 'owner-alice',
      executor_actor_id: 'system-executor',
    });
    expect(res.route).toEqual('auto-map');
    expect(res.entities_created).toEqual(8);
    expect(res.tab_link).toEqual('app://entities/employee');
    expect(res.summary).toContain('8 new employee');
  });

  it('property portfolio CSV completes the flow', async () => {
    const bytes = readFileSync(join(FIXTURES, 'property-portfolio.csv'));
    const res = await runIngestFlow({
      tenant_id: 'tenant-1',
      conversation_id: 'conv-42',
      message_id: 'msg-2',
      fileBytes: bytes,
      fileFormat: 'csv',
      proposer_actor_id: 'mr-mwikila',
      approver_actor_id: 'owner-alice',
      executor_actor_id: 'system-executor',
    });
    expect(res.entities_created).toEqual(8);
    expect(res.tab_link).toEqual('app://entities/property');
  });

  it('routes to llm-proposal when heuristic confidence is in the mid band', async () => {
    // Ambiguous headers — the heuristic produces a non-zero but
    // sub-auto-map confidence.
    const csv =
      'somekey,details,notes\n' +
      'X,foo,bar\n' +
      'Y,baz,qux\n';
    const bytes = Buffer.from(csv, 'utf8');
    const res = await runIngestFlow({
      tenant_id: 'tenant-1',
      conversation_id: 'conv-42',
      message_id: 'msg-3',
      fileBytes: bytes,
      fileFormat: 'csv',
      proposer_actor_id: 'mr-mwikila',
      approver_actor_id: 'owner-alice',
      executor_actor_id: 'system-executor',
    });
    expect(['llm-proposal', 'manual-review']).toContain(res.route);
  });

  it('AUTO_MAP_THRESHOLD constant remains stable contract', () => {
    expect(AUTO_MAP_THRESHOLD).toBeGreaterThan(0.7);
    expect(AUTO_MAP_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
