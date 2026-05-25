/**
 * Anthropic Batch API wrapper — submits batched LLM calls for the
 * nightly consolidation cycle (50% cost cut, ≤ 24 h SLA).
 *
 * Used by `services/consolidation-worker`. The wrapper is intentionally
 * provider-agnostic at the boundary: callers see `submitBatch(jobs)` and
 * `pollBatch(handle)`; the composition root injects the concrete
 * Anthropic SDK adapter.
 *
 * Three lifecycle states are surfaced:
 *
 *   - 'submitted'  — accepted by the upstream queue
 *   - 'processing' — at least one job has been dispatched
 *   - 'complete'   — every job has terminated (success OR failure)
 *
 * Tests inject a fake `BatchTransport` so the substrate can be exercised
 * without network I/O. Production binds an Anthropic SDK transport.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type BatchJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BatchJobRequest {
  readonly jobId: string;
  readonly system: string;
  readonly userMessage: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface BatchJobResult {
  readonly jobId: string;
  readonly status: BatchJobStatus;
  readonly text: string | null;
  readonly errorMessage: string | null;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usdCost: number;
}

export interface BatchHandle {
  readonly batchId: string;
  readonly state: 'submitted' | 'processing' | 'complete';
  readonly submittedAt: string;
  readonly jobIds: ReadonlyArray<string>;
}

export interface BatchPollResult {
  readonly handle: BatchHandle;
  readonly results: ReadonlyArray<BatchJobResult>;
  readonly complete: boolean;
}

export interface BatchTransport {
  submit(jobs: ReadonlyArray<BatchJobRequest>): Promise<BatchHandle>;
  poll(batchId: string): Promise<BatchPollResult>;
  cancel(batchId: string): Promise<void>;
}

export interface BatchApi {
  submitBatch(jobs: ReadonlyArray<BatchJobRequest>): Promise<BatchHandle>;
  pollBatch(handle: BatchHandle): Promise<BatchPollResult>;
  cancelBatch(handle: BatchHandle): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createBatchApi(transport: BatchTransport): BatchApi {
  return {
    async submitBatch(
      jobs: ReadonlyArray<BatchJobRequest>,
    ): Promise<BatchHandle> {
      if (jobs.length === 0) {
        throw new Error('submitBatch: cannot submit zero jobs');
      }
      return transport.submit(jobs);
    },
    async pollBatch(handle: BatchHandle): Promise<BatchPollResult> {
      return transport.poll(handle.batchId);
    },
    async cancelBatch(handle: BatchHandle): Promise<void> {
      await transport.cancel(handle.batchId);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory transport — test fixture. Runs every job synchronously
// against a caller-supplied executor so the test can assert outputs.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryBatchTransportDeps {
  execute: (job: BatchJobRequest) => Promise<{
    readonly text: string;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly usdCost: number;
  }>;
  clock?: () => Date;
}

export function createInMemoryBatchTransport(
  deps: InMemoryBatchTransportDeps,
): BatchTransport {
  const clock = deps.clock ?? (() => new Date());
  const batches = new Map<
    string,
    { handle: BatchHandle; jobs: ReadonlyArray<BatchJobRequest>; results: BatchJobResult[]; cancelled: boolean }
  >();
  let counter = 0;

  async function submit(
    jobs: ReadonlyArray<BatchJobRequest>,
  ): Promise<BatchHandle> {
    counter += 1;
    const handle: BatchHandle = {
      batchId: `batch_${counter.toString(36)}`,
      state: 'submitted',
      submittedAt: clock().toISOString(),
      jobIds: jobs.map((j) => j.jobId),
    };
    batches.set(handle.batchId, { handle, jobs, results: [], cancelled: false });
    return handle;
  }

  async function poll(batchId: string): Promise<BatchPollResult> {
    const entry = batches.get(batchId);
    if (!entry) throw new Error(`unknown batch: ${batchId}`);
    if (entry.cancelled) {
      return {
        handle: { ...entry.handle, state: 'complete' },
        results: entry.results,
        complete: true,
      };
    }
    if (entry.results.length === 0) {
      for (const job of entry.jobs) {
        const started = Date.now();
        try {
          const out = await deps.execute(job);
          entry.results.push({
            jobId: job.jobId,
            status: 'succeeded',
            text: out.text,
            errorMessage: null,
            latencyMs: Date.now() - started,
            tokensIn: out.tokensIn,
            tokensOut: out.tokensOut,
            usdCost: out.usdCost,
          });
        } catch (err) {
          entry.results.push({
            jobId: job.jobId,
            status: 'failed',
            text: null,
            errorMessage: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - started,
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          });
        }
      }
    }
    return {
      handle: { ...entry.handle, state: 'complete' },
      results: entry.results,
      complete: true,
    };
  }

  async function cancel(batchId: string): Promise<void> {
    const entry = batches.get(batchId);
    if (!entry) return;
    entry.cancelled = true;
  }

  return { submit, poll, cancel };
}
