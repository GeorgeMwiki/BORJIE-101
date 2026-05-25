/**
 * Reflexion retriever — read-at-session-start side of the verbal-RL
 * loop. Fetches the last N reflections for a (tenant, user) and
 * renders them into a system-prompt addendum.
 *
 * The injected fragment looks like:
 *
 *   **Recent reflections (most recent first):**
 *   - [outcome] reflection-text-line-1
 *     reflection-text-line-2
 *   - [outcome] ...
 *
 * The retriever caps the byte budget so a chatty reflection doesn't
 * blow up the system prompt — older / longer reflections get truncated.
 */

export type ReflexionOutcome = 'success' | 'failure' | 'mixed';

export interface ReflexionEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly reflection: string;
  readonly outcome: ReflexionOutcome;
  readonly recordedAt: string;
}

export interface ReflexionRetrieverPort {
  recall(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly limit?: number;
    readonly bumpTelemetry?: boolean;
  }): Promise<ReadonlyArray<ReflexionEntry>>;
}

export interface RetrieveReflectionsArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly limit?: number;
  readonly bumpTelemetry?: boolean;
}

export const DEFAULT_REFLEXION_LIMIT = 3;
const DEFAULT_FRAGMENT_BUDGET = 1_800;
const PER_ENTRY_MAX_CHARS = 400;

export interface ReflexionRetriever {
  retrieve(
    args: RetrieveReflectionsArgs,
  ): Promise<ReadonlyArray<ReflexionEntry>>;
  renderPromptFragment(entries: ReadonlyArray<ReflexionEntry>): string;
}

export interface ReflexionRetrieverDeps {
  readonly port: ReflexionRetrieverPort;
  readonly maxFragmentChars?: number;
}

export function createReflexionRetriever(
  deps: ReflexionRetrieverDeps,
): ReflexionRetriever {
  const port = deps.port;
  const budget = deps.maxFragmentChars ?? DEFAULT_FRAGMENT_BUDGET;

  return {
    async retrieve(args) {
      if (!args.tenantId || !args.userId) return [];
      try {
        const rowsArgs: {
          tenantId: string;
          userId: string;
          limit?: number;
          bumpTelemetry?: boolean;
        } = {
          tenantId: args.tenantId,
          userId: args.userId,
        };
        if (args.limit !== undefined) rowsArgs.limit = args.limit;
        else rowsArgs.limit = DEFAULT_REFLEXION_LIMIT;
        if (args.bumpTelemetry !== undefined) {
          rowsArgs.bumpTelemetry = args.bumpTelemetry;
        }
        const rows = await port.recall(rowsArgs);
        return rows ?? [];
      } catch {
        return [];
      }
    },
    renderPromptFragment(entries) {
      if (!Array.isArray(entries) || entries.length === 0) return '';
      const lines: string[] = ['**Recent reflections (most recent first):**'];
      let used = lines[0]!.length;
      for (const e of entries) {
        const body = truncate(e.reflection, PER_ENTRY_MAX_CHARS);
        const next = `- [${e.outcome}] ${body}`;
        if (used + next.length + 1 > budget) {
          lines.push('- …');
          break;
        }
        lines.push(next);
        used += next.length + 1;
      }
      return lines.join('\n');
    },
  };
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
