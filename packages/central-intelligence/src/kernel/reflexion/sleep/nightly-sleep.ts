/**
 * Nightly sleep — orchestrates the 4 reflexion consolidation passes.
 *
 * Sequence:
 *   1. Pass 1: dedupe + cluster recent reflexions     (writes cluster_id)
 *   2. Pass 2: extract "when X happens, do Y" patterns (read-only)
 *   3. Pass 3: update the persistent guidelines doc    (writes reflexion_guidelines)
 *   4. Pass 4: prune stale reflexions                  (writes pruned_at)
 *
 * The orchestrator is deliberately sequential — each pass depends on
 * the previous one's output:
 *   - Pass 2 reads pass-1 cluster representatives.
 *   - Pass 3 writes pass-2 candidates.
 *   - Pass 4 runs LAST so a freshly-promoted lesson isn't pruned the
 *     same night it gets crystallised.
 *
 * Errors in one pass do NOT abort the next pass — each pass returns
 * its own report and the orchestrator aggregates. The whole run
 * succeeds even when individual passes degrade.
 *
 * Cooperative cancellation: callers can pass an AbortSignal which is
 * checked between passes. Within a single pass, cancellation is
 * advisory only (the pass owns its own loop).
 */

import {
  runDedupeClusterPass,
  type DedupeClusterPort,
  type DedupeClusterReport,
} from './pass-1-dedupe-cluster.js';
import {
  runExtractPatternsPass,
  type ExtractPatternsPort,
  type ExtractPatternsReport,
} from './pass-2-extract-patterns.js';
import {
  runUpdateGuidelinesPass,
  type UpdateGuidelinesPort,
  type UpdateGuidelinesReport,
} from './pass-3-update-guidelines.js';
import {
  runPruneStalePass,
  type PruneStalePort,
  type PruneStaleReport,
} from './pass-4-prune-stale.js';

export interface NightlySleepPorts {
  readonly dedupe: DedupeClusterPort;
  readonly extract: ExtractPatternsPort;
  readonly guidelines: UpdateGuidelinesPort;
  readonly prune: PruneStalePort;
}

export interface NightlySleepArgs {
  readonly tenantId: string;
  /** Optional, lets callers tune the window each pass sees. */
  readonly windowDays?: number;
  readonly baseMaxAgeDays?: number;
  /** 0..1 minimum confidence for pass-3 writes. */
  readonly minGuidelineConfidence?: number;
  readonly abortSignal?: AbortSignal;
  readonly nowMs?: number;
}

export interface NightlySleepReport {
  readonly tenantId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly aborted: boolean;
  readonly pass1: DedupeClusterReport | null;
  readonly pass2: ExtractPatternsReport | null;
  readonly pass3: UpdateGuidelinesReport | null;
  readonly pass4: PruneStaleReport | null;
  readonly errors: ReadonlyArray<string>;
}

export async function runNightlySleep(
  ports: NightlySleepPorts,
  args: NightlySleepArgs,
): Promise<NightlySleepReport> {
  const startedAt = new Date(args.nowMs ?? Date.now()).toISOString();
  const errors: string[] = [];
  let pass1: DedupeClusterReport | null = null;
  let pass2: ExtractPatternsReport | null = null;
  let pass3: UpdateGuidelinesReport | null = null;
  let pass4: PruneStaleReport | null = null;

  if (!args.tenantId) {
    return Object.freeze({
      tenantId: args.tenantId,
      startedAt,
      completedAt: startedAt,
      aborted: false,
      pass1: null,
      pass2: null,
      pass3: null,
      pass4: null,
      errors: ['skipped: missing tenantId'],
    });
  }

  // Pass 1.
  if (args.abortSignal?.aborted) {
    return abortedReport(args.tenantId, startedAt, errors);
  }
  try {
    const pass1Args: {
      tenantId: string;
      windowDays?: number;
    } = { tenantId: args.tenantId };
    if (args.windowDays !== undefined) pass1Args.windowDays = args.windowDays;
    pass1 = await runDedupeClusterPass(ports.dedupe, pass1Args);
  } catch (e) {
    errors.push(`pass1: ${errString(e)}`);
  }

  // Pass 2.
  if (args.abortSignal?.aborted) {
    return abortedReport(args.tenantId, startedAt, errors, { pass1 });
  }
  try {
    const pass2Args: {
      tenantId: string;
      windowDays?: number;
    } = { tenantId: args.tenantId };
    if (args.windowDays !== undefined) pass2Args.windowDays = args.windowDays;
    pass2 = await runExtractPatternsPass(ports.extract, pass2Args);
  } catch (e) {
    errors.push(`pass2: ${errString(e)}`);
  }

  // Pass 3.
  if (args.abortSignal?.aborted) {
    return abortedReport(args.tenantId, startedAt, errors, { pass1, pass2 });
  }
  try {
    if (pass2 && pass2.candidates.length > 0) {
      const pass3Args: {
        tenantId: string;
        candidates: typeof pass2.candidates;
        minConfidence?: number;
      } = {
        tenantId: args.tenantId,
        candidates: pass2.candidates,
      };
      if (args.minGuidelineConfidence !== undefined) {
        pass3Args.minConfidence = args.minGuidelineConfidence;
      }
      pass3 = await runUpdateGuidelinesPass(ports.guidelines, pass3Args);
    } else {
      pass3 = Object.freeze({
        tenantId: args.tenantId,
        inserted: 0,
        overwritten: 0,
        appendedSourcesOnly: 0,
        skippedBelowConfidence: 0,
        errors: 0,
        notes: 'no candidates from pass-2',
      });
    }
  } catch (e) {
    errors.push(`pass3: ${errString(e)}`);
  }

  // Pass 4.
  if (args.abortSignal?.aborted) {
    return abortedReport(args.tenantId, startedAt, errors, {
      pass1,
      pass2,
      pass3,
    });
  }
  try {
    const pass4Args: {
      tenantId: string;
      baseMaxAgeDays?: number;
      nowMs?: number;
    } = { tenantId: args.tenantId };
    if (args.baseMaxAgeDays !== undefined) pass4Args.baseMaxAgeDays = args.baseMaxAgeDays;
    if (args.nowMs !== undefined) pass4Args.nowMs = args.nowMs;
    pass4 = await runPruneStalePass(ports.prune, pass4Args);
  } catch (e) {
    errors.push(`pass4: ${errString(e)}`);
  }

  const completedAt = new Date(args.nowMs ?? Date.now()).toISOString();
  return Object.freeze({
    tenantId: args.tenantId,
    startedAt,
    completedAt,
    aborted: false,
    pass1,
    pass2,
    pass3,
    pass4,
    errors: Object.freeze(errors),
  });
}

function abortedReport(
  tenantId: string,
  startedAt: string,
  errors: ReadonlyArray<string>,
  carry: {
    pass1?: DedupeClusterReport | null;
    pass2?: ExtractPatternsReport | null;
    pass3?: UpdateGuidelinesReport | null;
  } = {},
): NightlySleepReport {
  return Object.freeze({
    tenantId,
    startedAt,
    completedAt: new Date().toISOString(),
    aborted: true,
    pass1: carry.pass1 ?? null,
    pass2: carry.pass2 ?? null,
    pass3: carry.pass3 ?? null,
    pass4: null,
    errors: [...errors, 'aborted by caller signal'],
  });
}

function errString(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}
