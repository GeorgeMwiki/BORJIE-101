/**
 * `checkBundleBudget` — pre-shipped per-app budgets and a runtime
 * check that fails CI if any entry blows its cap.
 *
 *   - Landing page         100 KB  (LCP-critical, must stay tiny)
 *   - Marketing pages      150 KB
 *   - Owner-portal dash    250 KB  (rich UI, charts lazy)
 *   - Estate-manager dash  280 KB
 *   - Admin-platform-portal 220 KB (advisor pages dynamic-imported)
 *   - Customer-app default 180 KB
 *
 * Numbers are gzipped size of the entry chunk only (route-split). The
 * smaller it is, the faster the user gets to first interaction.
 */

import type { BundleBudget, BundleCheckResult } from '../types.js';

export const APP_BUDGETS = {
  landing: { entry: 'landing', maxKB: 100, warnKB: 80 },
  marketing: { entry: 'marketing', maxKB: 150, warnKB: 120 },
  ownerPortalDashboard: { entry: 'owner-portal-dashboard', maxKB: 250, warnKB: 200 },
  estateManagerDashboard: {
    entry: 'estate-manager-dashboard',
    maxKB: 280,
    warnKB: 230,
  },
  adminPlatformPortal: {
    entry: 'admin-web',
    maxKB: 220,
    warnKB: 180,
  },
  customerApp: { entry: 'customer-app', maxKB: 180, warnKB: 150 },
} as const satisfies Record<string, BundleBudget>;

export interface BundleSizeMap {
  readonly [entryName: string]: number; // KB
}

/**
 * Check a single budget against an entry's actual size. Returns a
 * structured result the CLI / CI can render or fail on.
 */
export function checkBundleBudget(
  budget: BundleBudget,
  sizes: BundleSizeMap,
): BundleCheckResult {
  const actualKB = sizes[budget.entry];
  if (actualKB === undefined) {
    return {
      entry: budget.entry,
      actualKB: 0,
      maxKB: budget.maxKB,
      ...(budget.warnKB !== undefined ? { warnKB: budget.warnKB } : {}),
      status: 'missing',
      message: `bundle-budget: entry "${budget.entry}" not found in stats — did the build emit it?`,
    };
  }
  if (actualKB > budget.maxKB) {
    return {
      entry: budget.entry,
      actualKB,
      maxKB: budget.maxKB,
      ...(budget.warnKB !== undefined ? { warnKB: budget.warnKB } : {}),
      status: 'error',
      message: `bundle-budget: ${budget.entry} = ${actualKB.toFixed(1)} KB exceeds cap ${budget.maxKB} KB`,
    };
  }
  if (budget.warnKB !== undefined && actualKB > budget.warnKB) {
    return {
      entry: budget.entry,
      actualKB,
      maxKB: budget.maxKB,
      warnKB: budget.warnKB,
      status: 'warn',
      message: `bundle-budget: ${budget.entry} = ${actualKB.toFixed(1)} KB > warn ${budget.warnKB} KB (still under cap ${budget.maxKB} KB)`,
    };
  }
  return {
    entry: budget.entry,
    actualKB,
    maxKB: budget.maxKB,
    ...(budget.warnKB !== undefined ? { warnKB: budget.warnKB } : {}),
    status: 'ok',
    message: `bundle-budget: ${budget.entry} = ${actualKB.toFixed(1)} KB ≤ cap ${budget.maxKB} KB`,
  };
}

/** Run all budgets at once. Returns summary + per-entry results. */
export function checkAllBudgets(
  budgets: readonly BundleBudget[],
  sizes: BundleSizeMap,
): {
  results: BundleCheckResult[];
  failed: number;
  warned: number;
  passed: number;
} {
  const results = budgets.map((b) => checkBundleBudget(b, sizes));
  return {
    results,
    failed: results.filter((r) => r.status === 'error' || r.status === 'missing').length,
    warned: results.filter((r) => r.status === 'warn').length,
    passed: results.filter((r) => r.status === 'ok').length,
  };
}

/**
 * Adapter: parse a Vite / Rollup `stats.html`-companion `stats.json`
 * into a `BundleSizeMap`. Keep this conservative — different bundlers
 * emit different shapes; the adapter only knows about chunk size +
 * fileName, which all of them include.
 */
export interface RollupLikeStats {
  readonly chunks?: ReadonlyArray<{
    readonly name?: string;
    readonly fileName?: string;
    readonly gzipSize?: number;
    readonly size?: number;
  }>;
}

export function parseStatsToSizes(stats: RollupLikeStats): BundleSizeMap {
  const out: Record<string, number> = {};
  for (const c of stats.chunks ?? []) {
    const name = c.name ?? c.fileName?.replace(/\.[^.]+$/, '');
    if (name === undefined) continue;
    const bytes = c.gzipSize ?? c.size ?? 0;
    out[name] = bytes / 1024;
  }
  return out;
}
