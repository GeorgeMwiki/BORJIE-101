/**
 * In-memory reflective store + Reflexion-style note builder.
 *
 * `reflect()` is parametrized over a Brain port — when no brain is
 * supplied, it falls back to a deterministic heuristic summariser
 * (top-tags, message count, role distribution). This keeps tests
 * dependency-free while leaving room for an LLM in production.
 */

import type {
  Brain,
  ReflectiveNote,
  ReflectiveStore,
  TenantId,
} from '../types.js';

export function createInMemoryReflectiveStore(): ReflectiveStore {
  const notes = new Map<string, ReflectiveNote>();

  return {
    async upsertNote(note: ReflectiveNote): Promise<ReflectiveNote> {
      notes.set(note.id, note);
      return note;
    },

    async getLatestForTenant(
      tenantId: TenantId,
    ): Promise<ReflectiveNote | null> {
      const list = Array.from(notes.values())
        .filter((n) => n.tenantId === tenantId)
        .sort(
          (a, b) =>
            Date.parse(b.periodEnd) - Date.parse(a.periodEnd),
        );
      return list[0] ?? null;
    },
  };
}

interface ReflectInputs {
  readonly tenantId: TenantId;
  readonly userId: string | null;
  readonly transcript: ReadonlyArray<{ role: string; content: string }>;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly idFactory: () => string;
  readonly now: () => string;
  readonly brain?: Brain;
}

/**
 * Build a ReflectiveNote from a transcript. If a Brain is supplied,
 * its JSON output is parsed; otherwise a deterministic fallback runs.
 */
export async function reflect(args: ReflectInputs): Promise<ReflectiveNote> {
  let insight = '';
  let adjustments: ReadonlyArray<string> = [];
  let selfScore = 0.5;

  if (args.brain && args.transcript.length > 0) {
    const systemPrompt = [
      'You are a reflective agent reviewing your own work.',
      'Return JSON: { "insight": string, "adjustments": string[], "self_score": number }',
      'No preamble, no markdown.',
    ].join('\n');
    try {
      const raw = await args.brain.summarise(args.transcript, systemPrompt);
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? raw) as {
        insight?: string;
        adjustments?: string[];
        self_score?: number;
      };
      insight = String(parsed.insight ?? '');
      adjustments = parsed.adjustments ?? [];
      const score = Number(parsed.self_score);
      if (Number.isFinite(score)) {
        selfScore = Math.max(0, Math.min(1, score));
      }
    } catch {
      // Fall through to heuristic.
    }
  }

  if (!insight) {
    insight = deterministicInsight(args.transcript);
    adjustments = deterministicAdjustments(args.transcript);
    selfScore = deterministicSelfScore(args.transcript);
  }

  return {
    id: args.idFactory(),
    tenantId: args.tenantId,
    userId: args.userId,
    insight,
    adjustments,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    selfScore,
    createdAt: args.now(),
  };
}

function deterministicInsight(
  transcript: ReadonlyArray<{ role: string; content: string }>,
): string {
  if (transcript.length === 0) return 'No turns recorded for this period.';
  const userTurns = transcript.filter((t) => t.role === 'user').length;
  const assistantTurns = transcript.filter(
    (t) => t.role === 'assistant',
  ).length;
  return [
    `Observed ${transcript.length} turns this period`,
    `(user=${userTurns}, assistant=${assistantTurns}).`,
    'Heuristic summary — no brain attached.',
  ].join(' ');
}

function deterministicAdjustments(
  transcript: ReadonlyArray<{ role: string; content: string }>,
): ReadonlyArray<string> {
  const adjustments: string[] = [];
  if (transcript.length > 50) {
    adjustments.push('Consider summarising long sessions sooner.');
  }
  const longTurns = transcript.filter((t) => t.content.length > 1000).length;
  if (longTurns > 5) {
    adjustments.push('Split long responses into smaller chunks.');
  }
  if (adjustments.length === 0) {
    adjustments.push('Behavior within expected envelope.');
  }
  return adjustments;
}

function deterministicSelfScore(
  transcript: ReadonlyArray<{ role: string; content: string }>,
): number {
  if (transcript.length === 0) return 0.5;
  return Math.min(0.9, 0.5 + transcript.length / 200);
}
