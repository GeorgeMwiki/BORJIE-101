/**
 * Consent gate.
 *
 * Looks up the user's `user_consent_preferences` row (best-effort) and
 * returns one of `granted | implicit | revoked`. The fallback `implicit`
 * reflects our lawful basis for advisory features: legitimate interest
 * grounded in records the user owns (their lease, their payments, their
 * maintenance tickets). We never use `implicit` for marketing or
 * profiling — those paths must use `granted`.
 *
 * If the table doesn't exist (dev DB, fresh tenant) the function
 * returns `implicit` rather than throwing — the advisor stays usable.
 */
import type { ConsentDecision } from '../types.js';

export interface ConsentCheckArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly purpose: 'advisor' | 'marketing' | 'analytics' | (string & {});
  readonly db: unknown;
}

interface DrizzleLike {
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

/**
 * Resolve the user's consent state for a purpose. Returns:
 *   - 'granted'  — explicit opt-in recorded
 *   - 'implicit' — no explicit opt-in, lawful basis is legitimate interest
 *   - 'revoked'  — explicit opt-out recorded; downstream MUST drop snippets
 */
export async function consentCheck(args: ConsentCheckArgs): Promise<ConsentDecision> {
  try {
    const db = asDrizzle(args.db);
    const exec = db.execute;
    if (!exec) return 'implicit';
    const result = await exec({
      sql: `
        SELECT decision FROM user_consent_preferences
        WHERE tenant_id = $1 AND user_id = $2 AND purpose = $3
        ORDER BY recorded_at DESC
        LIMIT 1
      `,
      params: [args.tenantId, args.userId, args.purpose],
    });
    const row = result.rows[0];
    if (!row) return 'implicit';
    const decision = row['decision'];
    if (decision === 'granted' || decision === 'revoked' || decision === 'implicit') {
      return decision;
    }
    return 'implicit';
  } catch {
    return 'implicit';
  }
}
