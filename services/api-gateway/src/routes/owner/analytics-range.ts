/**
 * Shared range resolver for the owner-portal Analytics routers.
 *
 * Maps a coarse UI range token (`30d` | `90d` | `12m`) to a concrete UTC
 * `{ from, to }` window ending at "now". `undefined` ⇒ no window (the repo
 * returns the most-recent `limit` rows instead). Pure + immutable.
 */

export type RangeToken = '30d' | '90d' | '12m';

/**
 * `{ from, to }` window. Structurally identical to `@borjie/database`'s
 * `AnalyticsDateRange`; declared locally to dodge the package-barrel TS2709
 * "namespace-as-type" drift (a re-exported type alias resolves to a namespace
 * through the gateway's barrel — see services/.../middleware/database.ts).
 */
export interface AnalyticsDateRange {
  readonly from: Date;
  readonly to: Date;
}

export function resolveRange(token: RangeToken | undefined): AnalyticsDateRange | undefined {
  if (!token) return undefined;
  const to = new Date();
  const from = new Date(to.getTime());
  switch (token) {
    case '30d':
      from.setUTCDate(from.getUTCDate() - 30);
      break;
    case '90d':
      from.setUTCDate(from.getUTCDate() - 90);
      break;
    case '12m':
      from.setUTCMonth(from.getUTCMonth() - 12);
      break;
  }
  return { from, to };
}
