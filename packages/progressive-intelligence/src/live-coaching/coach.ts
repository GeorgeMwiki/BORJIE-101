/**
 * Live coaching orchestrator. Combines heuristic + brain-assisted
 * hints, debounces calls, and falls back gracefully when no brain is
 * configured.
 *
 * The brain is read-only: it consumes work-in-progress + schema and
 * returns natural-language hints. We deliberately do NOT stream
 * coaching hints — the consumer wants a stable bundle to render at
 * once.
 */
import type {
  Brain,
  CoachingHint,
  CoachingSchema,
  CoachingSeverity,
} from '../types.js';
import { heuristicCoach } from './heuristics.js';

export interface CoachArgs {
  readonly workInProgress: Readonly<Record<string, unknown>>;
  readonly schema: CoachingSchema;
  /** Optional conversational history the brain can use as context. */
  readonly history?: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>;
  readonly brain?: Brain;
  /** Soft cap on tokens the brain can produce per coaching call. */
  readonly maxTokens?: number;
}

interface BrainHintPayload {
  field?: string;
  severity?: CoachingSeverity;
  message?: string;
  confidence?: number;
  suggestion?: string;
  reason?: string;
}

function tryParseBrainHints(raw: string): BrainHintPayload[] {
  if (!raw || raw.trim().length === 0) return [];
  // Extract a JSON array from the brain output. Be lenient — accept
  // either a bare array or an object with a `hints` key.
  const trimmed = raw.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as BrainHintPayload[];
    if (
      parsed &&
      typeof parsed === 'object' &&
      'hints' in parsed &&
      Array.isArray((parsed as { hints?: unknown }).hints)
    ) {
      return (parsed as { hints: BrainHintPayload[] }).hints;
    }
    return [];
  } catch {
    return [];
  }
}

async function consumeBrain(
  brain: Brain,
  workInProgress: Readonly<Record<string, unknown>>,
  schema: CoachingSchema,
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> | undefined,
  maxTokens: number | undefined,
): Promise<string> {
  const system =
    'You are a real-time data-entry coach. Given a partial form and its schema, ' +
    'identify suspicious values, missing-but-recommended evidence, or fields that ' +
    'might be wrong. Reply with a JSON array of {field,severity,message,suggestion,reason,confidence}. ' +
    'severity must be one of info|warn|block. If nothing to flag, reply [].';
  const prompt =
    `SCHEMA: ${JSON.stringify(schema)}\n` +
    `WIP: ${JSON.stringify(workInProgress)}\n` +
    (history && history.length > 0
      ? `HISTORY: ${JSON.stringify(history.slice(-6))}\n`
      : '');
  let acc = '';
  try {
    const stream = brain.stream({
      system,
      prompt,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      temperature: 0,
    });
    for await (const chunk of stream) {
      if (chunk.kind === 'token') acc += chunk.text;
      if (chunk.kind === 'error') return '';
      if (chunk.kind === 'done') break;
    }
  } catch {
    return '';
  }
  return acc;
}

function brainHintsToCoachingHints(
  raw: BrainHintPayload[],
  schemaFieldNames: ReadonlySet<string>,
  existingIds: ReadonlySet<string>,
): CoachingHint[] {
  const out: CoachingHint[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i] as BrainHintPayload;
    if (!r || typeof r !== 'object') continue;
    const field = typeof r.field === 'string' ? r.field : 'unknown';
    if (field !== 'unknown' && !schemaFieldNames.has(field)) {
      // Brain hallucinated a field — drop the hint.
      continue;
    }
    const severity: CoachingSeverity =
      r.severity === 'block' || r.severity === 'warn' || r.severity === 'info'
        ? r.severity
        : 'info';
    const message = typeof r.message === 'string' ? r.message : '';
    if (message.length === 0) continue;
    const reason = typeof r.reason === 'string' ? r.reason : 'brain_hint';
    const id = `brain_${i}_${field}_${reason}`.slice(0, 64);
    if (existingIds.has(id)) continue;
    out.push({
      id,
      field,
      severity,
      message,
      confidence:
        typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
          ? r.confidence
          : 0.6,
      ...(typeof r.suggestion === 'string' ? { suggestion: r.suggestion } : {}),
      reason,
    });
  }
  return out;
}

/**
 * Synchronous-ish coach — calls heuristics, then (if a brain is
 * supplied) appends LLM-generated hints. Brain failures degrade
 * silently to heuristics-only.
 */
export async function coach(args: CoachArgs): Promise<ReadonlyArray<CoachingHint>> {
  const heuristic = heuristicCoach({
    workInProgress: args.workInProgress,
    schema: args.schema,
  });
  if (!args.brain) return heuristic;

  const raw = await consumeBrain(
    args.brain,
    args.workInProgress,
    args.schema,
    args.history,
    args.maxTokens,
  );
  const parsed = tryParseBrainHints(raw);
  const fieldNames = new Set(args.schema.fields.map((f) => f.name));
  const existing = new Set(heuristic.map((h) => h.id));
  const brainHints = brainHintsToCoachingHints(parsed, fieldNames, existing);
  return [...heuristic, ...brainHints];
}
