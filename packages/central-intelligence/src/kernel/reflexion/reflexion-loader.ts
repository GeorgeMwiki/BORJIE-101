/**
 * Reflexion loader — pre-task read side of the verbal RL loop.
 *
 * Fetches the most-recent non-pruned reflexions for a tenant and
 * renders them as a prompt fragment to prepend to the agent's next
 * iteration. Sibling of `reflexion-retriever.ts` which scopes by
 * (tenant, user) for session-based UX; this loader is task-scoped so
 * cron / agent pipelines can pull lessons without a user context.
 *
 * The loader ALSO consumes the pass-3 `reflexion_guidelines` doc when
 * available — those crystallised "when X happens, do Y" rules outrank
 * raw reflexions and get prepended ABOVE the bullet list.
 */

import type { ReflexionOutcome } from './reflexion-writer.js';
import { truncate } from './reflexion-recorder.js';

export interface LoadedReflexion {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly reflection: string;
  readonly outcome: ReflexionOutcome;
  readonly importance: number;
  readonly recordedAt: string;
  readonly clusterId: string | null;
}

export interface LoadedGuideline {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly slug: string;
  readonly body: string;
  readonly confidence: number;
  readonly updatedAt: string;
}

export interface ReflexionLoaderPort {
  /** Recent NON-PRUNED reflexions for the tenant. */
  recentReflexions(args: {
    readonly tenantId: string;
    readonly limit: number;
    readonly userId?: string;
  }): Promise<ReadonlyArray<LoadedReflexion>>;
  /** Most-recent guidelines for the tenant (pass-3 output). */
  recentGuidelines(args: {
    readonly tenantId: string;
    readonly limit: number;
    readonly userId?: string;
  }): Promise<ReadonlyArray<LoadedGuideline>>;
}

export interface LoadReflexionsArgs {
  readonly tenantId: string;
  /** Optional. Scope to a specific user; omit for tenant-wide recall. */
  readonly userId?: string;
  /** Default 5 reflexions, 3 guidelines. */
  readonly limit?: number;
}

export interface LoadReflexionsResult {
  readonly reflexions: ReadonlyArray<LoadedReflexion>;
  readonly guidelines: ReadonlyArray<LoadedGuideline>;
  /** Pre-rendered prompt fragment, ready to prepend. Empty when nothing recallable. */
  readonly promptFragment: string;
}

export const DEFAULT_REFLEXION_LIMIT = 5;
export const DEFAULT_GUIDELINE_LIMIT = 3;
const PER_BULLET_MAX_CHARS = 400;
const PER_GUIDELINE_MAX_CHARS = 600;
const TOTAL_FRAGMENT_BUDGET = 3_200;

/**
 * Public entry point. Returns `{ reflexions, guidelines, promptFragment }`.
 * Errors swallowed — the prepend path must never throw.
 */
export async function loadReflexions(
  port: ReflexionLoaderPort,
  args: LoadReflexionsArgs,
): Promise<LoadReflexionsResult> {
  const empty: LoadReflexionsResult = Object.freeze({
    reflexions: [],
    guidelines: [],
    promptFragment: '',
  });
  if (!args.tenantId) return empty;

  const limit = clampInt(args.limit ?? DEFAULT_REFLEXION_LIMIT, 1, 25);

  let reflexions: ReadonlyArray<LoadedReflexion> = [];
  let guidelines: ReadonlyArray<LoadedGuideline> = [];
  try {
    const reflexionArgs: {
      tenantId: string;
      limit: number;
      userId?: string;
    } = { tenantId: args.tenantId, limit };
    if (args.userId) reflexionArgs.userId = args.userId;
    reflexions = (await port.recentReflexions(reflexionArgs)) ?? [];
  } catch {
    reflexions = [];
  }
  try {
    const guidelineArgs: {
      tenantId: string;
      limit: number;
      userId?: string;
    } = {
      tenantId: args.tenantId,
      limit: DEFAULT_GUIDELINE_LIMIT,
    };
    if (args.userId) guidelineArgs.userId = args.userId;
    guidelines = (await port.recentGuidelines(guidelineArgs)) ?? [];
  } catch {
    guidelines = [];
  }

  const promptFragment = renderPromptFragment(reflexions, guidelines);
  return Object.freeze({ reflexions, guidelines, promptFragment });
}

/**
 * Pure renderer — exported so the caller can re-render after filtering
 * (e.g. dropping low-importance reflexions when the budget is tight).
 */
export function renderPromptFragment(
  reflexions: ReadonlyArray<LoadedReflexion>,
  guidelines: ReadonlyArray<LoadedGuideline>,
): string {
  const lines: string[] = [];
  let used = 0;

  // Guidelines first — crystallised rules outrank raw reflexions.
  if (guidelines.length > 0) {
    const header = '**Operating guidelines (most recent first):**';
    lines.push(header);
    used += header.length + 1;
    // Dedupe by slug — pass-3 should already do this but defence-in-depth.
    const seenSlugs = new Set<string>();
    for (const g of guidelines) {
      if (seenSlugs.has(g.slug)) continue;
      seenSlugs.add(g.slug);
      const body = truncate(g.body, PER_GUIDELINE_MAX_CHARS);
      const next = `- ${body}`;
      if (used + next.length + 1 > TOTAL_FRAGMENT_BUDGET) {
        lines.push('- …');
        break;
      }
      lines.push(next);
      used += next.length + 1;
    }
  }

  // Then reflexions — collapse clusters by representative id.
  // Each cluster contributes ONE bullet (the representative); duplicates
  // (rows whose cluster_id points elsewhere) are suppressed.
  const seenCluster = new Set<string>();
  const survivors: LoadedReflexion[] = [];
  for (const r of reflexions) {
    if (r.clusterId) {
      if (seenCluster.has(r.clusterId)) continue;
      seenCluster.add(r.clusterId);
    } else {
      // Self-cluster: id IS the representative.
      if (seenCluster.has(r.id)) continue;
      seenCluster.add(r.id);
    }
    survivors.push(r);
  }

  if (survivors.length > 0) {
    if (lines.length > 0) lines.push('');
    const header = '**Recent reflexions (most recent first):**';
    lines.push(header);
    used += header.length + 1;
    for (const r of survivors) {
      const body = truncate(r.reflection, PER_BULLET_MAX_CHARS);
      const next = `- [${r.outcome}] ${body}`;
      if (used + next.length + 1 > TOTAL_FRAGMENT_BUDGET) {
        lines.push('- …');
        break;
      }
      lines.push(next);
      used += next.length + 1;
    }
  }

  return lines.join('\n');
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const v = Math.trunc(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
