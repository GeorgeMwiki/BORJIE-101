#!/usr/bin/env node
/**
 * CLI: `borjie-bundle-check [path-to-stats.json] [budget-key…]`
 *
 *   borjie-bundle-check dist/stats.json ownerPortalDashboard
 *
 * Exits non-zero when any budget is breached. Designed for CI gating
 * after `pnpm --filter <app> build` so a regression cannot ship.
 */

import { readFileSync } from 'node:fs';
import {
  APP_BUDGETS,
  checkAllBudgets,
  parseStatsToSizes,
  type RollupLikeStats,
} from './check-bundle-budget.js';

function main(argv: string[]): number {
  const [statsPath, ...budgetKeys] = argv;
  if (statsPath === undefined) {
    console.error('usage: borjie-bundle-check <stats.json> [budgetKey…]');
    return 2;
  }
  const raw = readFileSync(statsPath, 'utf-8');
  let stats: RollupLikeStats;
  try {
    stats = JSON.parse(raw) as RollupLikeStats;
  } catch (err) {
    console.error(`bundle-check: failed to parse ${statsPath}: ${(err as Error).message}`);
    return 2;
  }
  const sizes = parseStatsToSizes(stats);
  const keys = budgetKeys.length > 0 ? budgetKeys : Object.keys(APP_BUDGETS);
  const budgets = keys
    .map((k) => (APP_BUDGETS as Record<string, (typeof APP_BUDGETS)[keyof typeof APP_BUDGETS] | undefined>)[k])
    .filter((b): b is (typeof APP_BUDGETS)[keyof typeof APP_BUDGETS] => b !== undefined);
  if (budgets.length === 0) {
    console.error(`bundle-check: no matching budget keys for ${keys.join(',')}`);
    return 2;
  }
  const summary = checkAllBudgets(budgets, sizes);
  for (const r of summary.results) {
    const prefix =
      r.status === 'ok'
        ? 'PASS'
        : r.status === 'warn'
          ? 'WARN'
          : r.status === 'error'
            ? 'FAIL'
            : 'MISS';
    process.stdout.write(`[${prefix}] ${r.message}\n`);
  }
  process.stdout.write(
    `\n${summary.passed} passed, ${summary.warned} warned, ${summary.failed} failed.\n`,
  );
  return summary.failed > 0 ? 1 : 0;
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('cli.js')
) {
  process.exit(main(process.argv.slice(2)));
}
