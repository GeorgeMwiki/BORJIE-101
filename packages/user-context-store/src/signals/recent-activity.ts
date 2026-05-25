/**
 * Recent activity signal.
 *
 * Reads the kernel_action_audit event log (every executor step transition)
 * and condenses it into a {@link RecentActivity} summary. The audit log
 * is shared across all features so this single source covers logins,
 * searches, page navigations, and tool calls.
 */
import type { RecentActivity } from '../types.js';

export interface RecentActivityArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly db: unknown;
  readonly days?: number;
}

interface DrizzleLike {
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickDate(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/**
 * Build a {@link RecentActivity} snapshot for the user over the window.
 * Defaults to 14 days — long enough to catch weekly patterns, short
 * enough to keep the dossier responsive to recent intent.
 */
export async function recentActivity(
  args: RecentActivityArgs,
): Promise<RecentActivity> {
  const days = args.days ?? 14;
  const fallback: RecentActivity = {
    windowDays: days,
    loginCount: 0,
    pagesViewed: 0,
    featuresTouched: [],
    searchQueries: [],
  };
  return safe(async () => {
    const db = asDrizzle(args.db);
    const exec = db.execute;
    if (!exec) return fallback;
    const result = await exec({
      sql: `
        SELECT tool_name, captured_at, payload_hash, outcome
        FROM kernel_action_audit
        WHERE tenant_id = $1 AND user_id = $2
          AND captured_at >= NOW() - INTERVAL '${days} days'
        ORDER BY captured_at DESC
        LIMIT 500
      `,
      params: [args.tenantId, args.userId],
    });

    const featuresTouched = new Set<string>();
    const searchQueries: { query: string; timestamp: string }[] = [];
    let loginCount = 0;
    let pagesViewed = 0;
    let lastInteractionAt: string | undefined;
    let lastSeenTs: number = 0;

    for (const row of result.rows) {
      const tool = pickString(row, 'tool_name');
      if (tool) {
        featuresTouched.add(tool);
        if (tool === 'auth.login') loginCount += 1;
        if (tool === 'page.view') pagesViewed += 1;
        if (tool === 'search.run') {
          const ts = pickDate(row, 'captured_at') ?? new Date(0).toISOString();
          const queryHash = pickString(row, 'payload_hash') ?? '';
          searchQueries.push({
            query: queryHash, // We only have the hash at this layer.
            timestamp: ts,
          });
        }
      }
      const ts = pickDate(row, 'captured_at');
      if (ts) {
        const tsMs = Date.parse(ts);
        if (Number.isFinite(tsMs) && tsMs > lastSeenTs) {
          lastSeenTs = tsMs;
          lastInteractionAt = ts;
        }
      }
    }

    const out: RecentActivity = {
      windowDays: days,
      loginCount,
      pagesViewed,
      featuresTouched: [...featuresTouched],
      searchQueries: searchQueries.slice(0, 25),
    };
    if (lastInteractionAt) out.lastInteractionAt = lastInteractionAt;
    return out;
  }, fallback);
}

// Re-export the helper for downstream signals.
export { pickNumber as _pickNumberForSignals };
