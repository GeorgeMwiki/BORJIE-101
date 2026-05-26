/**
 * `ScorecardRepository` — in-memory reference impl + SQL port shape.
 *
 * The in-memory impl exists for tests and ephemeral workers. The SQL
 * port is defined as a thin interface that a production host
 * implements with `@borjie/database`'s drizzle bindings against the
 * `employee_scorecards` table (migration 0058).
 */

import {
  EmployeePerfFollowupError,
  type EmployeeScorecard,
  type ScorecardRepository,
} from '../types.js';

export function createInMemoryScorecardRepository(): ScorecardRepository {
  const rows = new Map<string, EmployeeScorecard>();
  const keyOf = (
    tenant_id: string,
    employee_user_id: string,
    date: string,
  ): string => `${tenant_id}::${employee_user_id}::${date}`;
  return {
    async insert(card) {
      const k = keyOf(card.tenant_id, card.employee_user_id, card.date);
      if (rows.has(k)) {
        throw new EmployeePerfFollowupError(
          `Scorecard already exists for ${k}`,
          'scorecard_exists',
        );
      }
      rows.set(k, card);
    },
    async findByDate(tenant_id, employee_user_id, date) {
      return rows.get(keyOf(tenant_id, employee_user_id, date)) ?? null;
    },
    async listForDate(tenant_id, date) {
      const out: EmployeeScorecard[] = [];
      for (const c of rows.values()) {
        if (c.tenant_id === tenant_id && c.date === date) {
          out.push(c);
        }
      }
      out.sort((a, b) => a.employee_user_id.localeCompare(b.employee_user_id));
      return out;
    },
    async latestPrior(tenant_id, employee_user_id, before_date) {
      let best: EmployeeScorecard | null = null;
      for (const c of rows.values()) {
        if (c.tenant_id !== tenant_id) continue;
        if (c.employee_user_id !== employee_user_id) continue;
        if (c.date >= before_date) continue;
        if (best === null || c.date > best.date) best = c;
      }
      return best;
    },
  };
}

/**
 * SQL-port shape — the host adapter must implement
 * `ScorecardRepository` against migration 0058's
 * `employee_scorecards` table. RLS is enforced via the
 * `app.tenant_id` GUC, set by the host's connection wrapper.
 */
export type { ScorecardRepository } from '../types.js';
