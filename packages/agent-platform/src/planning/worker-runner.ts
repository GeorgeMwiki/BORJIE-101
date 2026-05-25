/**
 * Worker-runner — runs a single batch of steps in parallel via the
 * injected StepExecutor port. Respects `maxParallelism`. Captures every
 * execution into the audit sink.
 *
 * Pure orchestration. The actual tool invocation is the StepExecutor's
 * job, and the audit storage is the AuditSink's.
 */

import type {
  AuditSink,
  ExecutionRecord,
  Step,
  StepExecutor,
} from './types.js';
import { nextEntryId } from './audit-trail.js';

export interface RunBatchOptions {
  readonly maxParallelism: number;
}

export async function runBatch(
  batch: ReadonlyArray<Step>,
  executor: StepExecutor,
  audit: AuditSink,
  options: RunBatchOptions,
): Promise<ReadonlyArray<ExecutionRecord>> {
  await audit.append({
    entryId: nextEntryId(),
    kind: 'batch_started',
    at: new Date().toISOString(),
    payload: { stepIds: batch.map((s) => s.id) },
  });

  const records: ExecutionRecord[] = [];

  // Cap parallelism by chunking the batch into max-N windows.
  const window = Math.max(1, options.maxParallelism);
  for (let i = 0; i < batch.length; i += window) {
    const slice = batch.slice(i, i + window);
    const sliceResults = await Promise.all(
      slice.map(async (step) => {
        await audit.append({
          entryId: nextEntryId(),
          kind: 'step_started',
          at: new Date().toISOString(),
          payload: { stepId: step.id, toolName: step.toolName },
        });
        const rec = await executor.execute(step);
        await audit.append({
          entryId: nextEntryId(),
          kind: rec.status === 'failed' ? 'step_failed' : 'step_completed',
          at: new Date().toISOString(),
          payload: rec,
        });
        return rec;
      }),
    );
    for (const r of sliceResults) records.push(r);
  }

  await audit.append({
    entryId: nextEntryId(),
    kind: 'batch_completed',
    at: new Date().toISOString(),
    payload: {
      stepIds: batch.map((s) => s.id),
      successCount: records.filter((r) => r.status === 'completed').length,
      failureCount: records.filter((r) => r.status === 'failed').length,
    },
  });

  return Object.freeze(records);
}
