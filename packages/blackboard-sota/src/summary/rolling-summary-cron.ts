/**
 * Rolling-summary cron — fire every 30 minutes for active regions
 * older than 2 hours (spec §8).
 *
 * Wave BLACKBOARD-CORE. Pure orchestration; the actual summarisation
 * is delegated to the `SummaryGenerator`. Side effects: persists a
 * fresh `rolling` summary per qualifying region.
 *
 * The cron is the *runner*. The runtime wraps it in a `setInterval`
 * or a scheduled job — this module exposes only the per-tick
 * function so the host runtime owns the scheduling.
 */

import {
  BLACKBOARD_CONSTANTS,
  type Region,
  type RegionsRepository,
  type PostsRepository,
  type SummariesRepository,
} from '../types.js';
import type { SummaryGenerator } from './summary-generator.js';

export interface RollingSummaryCronDeps {
  readonly regions: RegionsRepository;
  readonly posts: PostsRepository;
  readonly summaries: SummariesRepository;
  readonly generator: SummaryGenerator;
  readonly now?: () => Date;
  /** Override the "region is old enough" threshold. */
  readonly regionAgeMs?: number;
  /** Tenant scope — when omitted the cron must be run per-tenant by the host. */
  readonly tenantId: string;
}

export interface RollingSummaryCronTickResult {
  readonly evaluated: number;
  readonly emitted: number;
  readonly skipped: number;
}

export interface RollingSummaryCron {
  /** Single tick — evaluate every active region and emit summaries. */
  tick(): Promise<RollingSummaryCronTickResult>;
}

export function createRollingSummaryCron(
  deps: RollingSummaryCronDeps,
): RollingSummaryCron {
  const now = deps.now ?? (() => new Date());
  const regionAgeMs =
    deps.regionAgeMs ?? BLACKBOARD_CONSTANTS.ROLLING_SUMMARY_REGION_AGE_MS;

  return {
    async tick() {
      const t = now();
      const candidates: Region[] = [];
      const open = await deps.regions.listByTenant(deps.tenantId, {
        status: 'active',
      });
      for (const region of open) candidates.push(region);
      const opened = await deps.regions.listByTenant(deps.tenantId, {
        status: 'open',
      });
      for (const region of opened) candidates.push(region);

      let emitted = 0;
      let skipped = 0;
      for (const region of candidates) {
        const ageMs = t.getTime() - region.openedAt.getTime();
        if (ageMs < regionAgeMs) {
          skipped += 1;
          continue;
        }
        // Find the latest rolling summary so we summarise only the
        // posts produced since then. If none exists, summarise the
        // whole region.
        const last = await deps.summaries.latestForRegion(
          deps.tenantId,
          region.id,
          'rolling',
        );
        const coversFrom = last?.coversTo ?? region.openedAt;
        const posts = await deps.posts.listByRegion(
          deps.tenantId,
          region.id,
          { ascending: true },
        );
        // First rolling summary: include posts back to and including
        // openedAt (postedAt >= coversFrom). Subsequent rolls: strict
        // greater-than so the same post is not summarised twice.
        const isFirstRoll = last === null;
        const fresh = posts.filter((p) =>
          isFirstRoll
            ? p.postedAt.getTime() >= coversFrom.getTime()
            : p.postedAt.getTime() > coversFrom.getTime(),
        );
        if (fresh.length === 0) {
          skipped += 1;
          continue;
        }
        const summary = await deps.generator.generate({
          tenantId: deps.tenantId,
          regionId: region.id,
          summaryKind: 'rolling',
          posts: fresh,
          coversFrom,
          coversTo: t,
          regionKindHint: region.regionKind,
        });
        await deps.summaries.append(summary);
        emitted += 1;
      }
      return Object.freeze({
        evaluated: candidates.length,
        emitted,
        skipped,
      });
    },
  };
}
