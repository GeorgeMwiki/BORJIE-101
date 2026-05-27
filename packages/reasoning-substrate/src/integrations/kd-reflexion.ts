/**
 * Integration shim — K-D Reflexion tagging.
 *
 * K-D ships a Reflexion outer loop: at session end, a verbal
 * reflection is written into the Reflection memory tier so the next
 * session can read it. To make those reflections retrievable by
 * task_class (so a future eviction turn loads "lessons from last
 * eviction"), each reflection should carry a `taskClass` tag matching
 * the discovered Self-Discover structure.
 *
 * This shim takes a free-form Reflexion writer port and a discovered
 * `ReasoningStructure`, and writes a TAGGED reflection. Duck-typed —
 * no compile-time dep on @borjie/central-intelligence.
 *
 * The api-gateway composition root binds the writer port to K-D's
 * Drizzle-backed reflexion_writer service.
 */

import type {
  BorjieTaskClass,
  ReasoningStructure,
} from '../self-discover/types.js';

// ─────────────────────────────────────────────────────────────────────
// K-D port (duck-typed)
// ─────────────────────────────────────────────────────────────────────

export type ReflexionOutcome = 'success' | 'failure' | 'mixed';

export interface ReflexionWriterPort {
  record(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly reflection: string;
    readonly outcome: ReflexionOutcome;
    /** Optional task-class tag — K-D's Drizzle store supports it. */
    readonly taskClass?: BorjieTaskClass;
    /** Optional jurisdiction tag. */
    readonly jurisdiction?: string;
  }): Promise<{ readonly id: string }>;
}

// ─────────────────────────────────────────────────────────────────────
// Compose + record
// ─────────────────────────────────────────────────────────────────────

export interface RecordTaggedReflectionArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly structure: ReasoningStructure;
  readonly outcome: ReflexionOutcome;
  /** Free-text body — what worked / what didn't. */
  readonly body: string;
  /** Optional list of lessons (up to 3 bullets). */
  readonly lessons?: ReadonlyArray<string>;
}

const MAX_LESSONS = 3;
const MAX_TOTAL_CHARS = 1_200;

/**
 * Build the reflection text and record it via the K-D writer port.
 * The reflection is tagged with `taskClass` and `jurisdiction` so
 * retrieval can filter by them.
 */
export async function recordTaggedReflection(
  port: ReflexionWriterPort,
  args: RecordTaggedReflectionArgs,
): Promise<{ readonly id: string } | null> {
  if (!args.tenantId || !args.userId || !args.sessionId) return null;
  const reflection = buildTaggedReflectionText({
    structure: args.structure,
    body: args.body,
    outcome: args.outcome,
    ...(args.lessons !== undefined ? { lessons: args.lessons } : {}),
  });
  if (!reflection.trim()) return null;
  try {
    return await port.record({
      tenantId: args.tenantId,
      userId: args.userId,
      sessionId: args.sessionId,
      reflection,
      outcome: args.outcome,
      taskClass: args.structure.taskClass,
      jurisdiction: args.structure.jurisdiction,
    });
  } catch {
    return null;
  }
}

export function buildTaggedReflectionText(args: {
  readonly structure: ReasoningStructure;
  readonly outcome: ReflexionOutcome;
  readonly body: string;
  readonly lessons?: ReadonlyArray<string>;
}): string {
  const lines: string[] = [];
  lines.push(`[${args.structure.taskClass}/${args.structure.jurisdiction}] outcome=${args.outcome}`);
  const body = (args.body ?? '').trim();
  if (body) {
    lines.push(body);
  }
  const lessons = (args.lessons ?? [])
    .map((l) => (typeof l === 'string' ? l.trim() : ''))
    .filter((l) => l.length > 0)
    .slice(0, MAX_LESSONS);
  if (lessons.length > 0) {
    lines.push('Lessons:');
    for (const l of lessons) lines.push(`- ${l}`);
  }
  return truncate(lines.join('\n'), MAX_TOTAL_CHARS);
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
