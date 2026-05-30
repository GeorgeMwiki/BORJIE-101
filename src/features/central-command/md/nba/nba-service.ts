/**
 * NbaService — public API consumed by the MD orchestrator.
 *
 * Implements `NbaServicePort` with four pure-ish entry points:
 *   - rankActions(snapshot, k)
 *   - getNextLowHangingFruit(snapshot)
 *   - getNextHighImpact(snapshot)
 *   - getDailyAgenda(snapshot)
 *
 * Inputs are Zod-validated at the boundary. The service is stateless and
 * safe to instantiate per request.
 *
 * @module features/central-command/md/nba/nba-service
 */

import { createLogger } from "@/lib/logger";

import { generateCandidates } from "./candidate-generator";
import { dedupeRankings, rankCandidates } from "./context-aware-ranker";
import { findHighImpact } from "./high-impact-finder";
import { findLowHangingFruit } from "./low-hanging-fruit-finder";
import { businessSnapshotSchema } from "./schemas";
import type { BusinessSnapshot, NbaServicePort, RankedAction } from "./types";

const log = createLogger("md.nba");

/** Default cap on returned actions for `rankActions`. */
const DEFAULT_RANK_LIMIT = 10;
const DAILY_AGENDA_SIZE = 5;

export class NbaService implements NbaServicePort {
  async rankActions(
    snapshot: BusinessSnapshot,
    k: number = DEFAULT_RANK_LIMIT,
  ): Promise<readonly RankedAction[]> {
    const validated = this.validateSnapshot(snapshot);
    if (!Number.isFinite(k) || k <= 0) {
      throw new Error("NbaService.rankActions requires k > 0");
    }
    const candidates = generateCandidates(validated);
    const ranked = rankCandidates(candidates, validated);
    const deduped = dedupeRankings(ranked);
    return Object.freeze(deduped.slice(0, k));
  }

  async getNextLowHangingFruit(
    snapshot: BusinessSnapshot,
  ): Promise<RankedAction | null> {
    const ranked = await this.rankActions(snapshot, 50);
    const fruit = findLowHangingFruit(ranked, 1);
    return fruit[0] ?? null;
  }

  async getNextHighImpact(
    snapshot: BusinessSnapshot,
  ): Promise<RankedAction | null> {
    const ranked = await this.rankActions(snapshot, 50);
    const impact = findHighImpact(ranked, 1);
    return impact[0] ?? null;
  }

  /**
   * Daily agenda: a balanced mix designed for the owner's morning briefing.
   *   - The single top low-hanging fruit
   *   - The single top high-impact item
   *   - The next 3 do-now Eisenhower items
   *   - De-duped against the first two.
   */
  async getDailyAgenda(
    snapshot: BusinessSnapshot,
  ): Promise<readonly RankedAction[]> {
    const ranked = await this.rankActions(snapshot, 100);
    const seen = new Set<string>();
    const picks: RankedAction[] = [];

    const addUnique = (action: RankedAction | undefined): void => {
      if (!action) return;
      const key = `${action.templateId}::${action.subjectRef ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      picks.push(action);
    };

    const fruit = findLowHangingFruit(ranked, 1);
    addUnique(fruit[0]);

    const impact = findHighImpact(ranked, 1);
    addUnique(impact[0]);

    const doNow = ranked.filter((r) => r.eisenhower.quadrant === "do-now");
    for (const a of doNow) {
      if (picks.length >= DAILY_AGENDA_SIZE) break;
      addUnique(a);
    }

    // Fill remaining slots with the overall top ranking.
    for (const a of ranked) {
      if (picks.length >= DAILY_AGENDA_SIZE) break;
      addUnique(a);
    }

    log.debug("daily agenda built", {
      orgId: snapshot.orgId,
      count: picks.length,
    });

    return Object.freeze(picks);
  }

  private validateSnapshot(snapshot: BusinessSnapshot): BusinessSnapshot {
    const parsed = businessSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      log.error("invalid business snapshot", {
        issues: parsed.error.issues.slice(0, 5),
      });
      throw new Error(
        `NbaService: invalid BusinessSnapshot (${parsed.error.issues.length} issue(s))`,
      );
    }
    return parsed.data as BusinessSnapshot;
  }
}

/** Default singleton — stateless. Safe to reuse across requests. */
export const nbaService: NbaServicePort = new NbaService();
