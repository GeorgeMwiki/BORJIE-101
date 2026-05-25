/**
 * slo-stream-writer.ts — JSONL persistence for sub-MD SLO events.
 *
 * Mirrors the `SloEvent` shape from `@borjie/autonomy-governance`. The
 * shapes are kept structurally identical so a future Phase F can pipe these
 * directly into the autonomy-governance stream sink without translation.
 *
 * The writer is a tiny side-effect — open-append per call, no buffering.
 * Bench runs are 50 tasks * k runs * 4 scorers ≈ 1000 lines max; the
 * overhead is irrelevant next to the LLM calls.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Mirror of `autonomy-governance/src/types.ts:SloEvent`. The two must be
 * kept in lockstep. Field names + types match exactly.
 */
export interface BenchSloEvent {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly timestamp: string;
  readonly metric:
    | 'resolution-quality'
    | 'task-completion-rate'
    | 'owner-cs-score'
    | 'cost-per-resolution';
  readonly actualValue: number;
  readonly predictedValue?: number;
  readonly delta: number;
}

export interface SloStreamWriter {
  /** Append a single event. */
  emit(event: BenchSloEvent): Promise<void>;
  /** Where events are being persisted (for the report's footer). */
  readonly outputPath: string;
}

export interface SloStreamWriterOptions {
  readonly outputPath: string;
}

/**
 * Factory for the file-backed writer. The output path is created lazily on
 * the first emit so empty runs don't litter the filesystem.
 */
export function createSloStreamWriter(opts: SloStreamWriterOptions): SloStreamWriter {
  let dirEnsured = false;
  return Object.freeze({
    outputPath: opts.outputPath,
    async emit(event: BenchSloEvent): Promise<void> {
      if (!dirEnsured) {
        await mkdir(dirname(opts.outputPath), { recursive: true });
        dirEnsured = true;
      }
      await appendFile(opts.outputPath, `${JSON.stringify(event)}\n`, 'utf8');
    },
  });
}

/**
 * No-op writer for tests that don't care about persistence.
 */
export function createNoopSloStreamWriter(): SloStreamWriter {
  return Object.freeze({
    outputPath: '(noop)',
    async emit(_event: BenchSloEvent): Promise<void> {
      // no-op
    },
  });
}
