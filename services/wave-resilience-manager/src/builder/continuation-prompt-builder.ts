/**
 * Continuation-prompt builder.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §8 — assembles the resume prompt fed to
 * the freshly-dispatched continuation agent.
 *
 * Pure function. No I/O.
 */

import type { WaveProgressEntry } from '../types.js';

export interface BuildContinuationPromptInput {
  readonly waveId: string;
  readonly originalPrompt: string;
  readonly checkpoint: WaveProgressEntry | null;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

const TEMPLATE_HEADER =
  'You are RESUMING wave {wave_id} which was previously dispatched but crashed mid-flight.';

const TEMPLATE_VERIFY_BLOCK = `Before each step, verify it has not already been done by checking:
  - \`git log --oneline -20\` for commits matching the expected prefixes
  - \`git ls-files\` for files already tracked
  - the filesystem for already-written artefacts

Skip any step whose output already exists. Complete the remaining
steps. Do not re-create files that already exist; modify in place if
needed.`;

function stringifyPayload(payload: Record<string, unknown> | null): string {
  if (payload === null || Object.keys(payload).length === 0) return '{}';
  try {
    return JSON.stringify(payload);
  } catch {
    return '{}';
  }
}

export function buildContinuationPrompt(
  input: BuildContinuationPromptInput,
): string {
  const header = TEMPLATE_HEADER.replace('{wave_id}', input.waveId);
  const cp = input.checkpoint;
  const checkpointBlock = cp
    ? `Last successful checkpoint:
  label:   ${cp.checkpoint_label ?? '(none)'}
  seq:     ${cp.checkpoint_seq}
  payload: ${stringifyPayload(cp.checkpoint_payload)}`
    : `Last successful checkpoint: (none — start from scratch but verify nothing has been done already)`;

  const trailer = `This is attempt ${input.attemptNumber} of ${input.maxAttempts}. Be efficient — every minute counts. Report when complete.`;

  return [
    header,
    '',
    'Original prompt (verbatim):',
    input.originalPrompt,
    '',
    checkpointBlock,
    '',
    TEMPLATE_VERIFY_BLOCK,
    '',
    trailer,
  ].join('\n');
}
