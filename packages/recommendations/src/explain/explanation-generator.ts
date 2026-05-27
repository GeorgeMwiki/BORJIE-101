/**
 * Recommendation explanation generator.
 *
 * Port-shaped. The production wiring calls Claude / Gemini to produce
 * a one-paragraph narrative explaining "why this item ranks here for
 * this user". The deterministic in-process default emits a feature-
 * grounded explanation string by reading the candidate's `features`
 * and the user's `features` directly — useful for tests and for
 * offline runs.
 *
 * Citation: Tintarev & Masthoff — "Explaining Recommendations:
 * Design and Evaluation", in the Recommender Systems Handbook 3rd
 * ed., 2024 — chapter on explainability standards.
 */

import type { Item, RecommendationResult, ScoredItem, User } from '../types.js';

export interface Explanation {
  readonly itemId: string;
  readonly summary: string;
  readonly drivers: ReadonlyArray<string>;
}

export interface ExplainArgs {
  readonly result: RecommendationResult;
  readonly user?: User;
  readonly items: ReadonlyArray<Item>;
}

export interface ExplanationPort {
  explain(args: ExplainArgs): Promise<ReadonlyArray<Explanation>>;
}

/** Default in-process explainer. Feature-grounded, deterministic. */
export function createDefaultExplanationGenerator(): ExplanationPort {
  return {
    async explain(args: ExplainArgs): Promise<ReadonlyArray<Explanation>> {
      const itemById = new Map<string, Item>();
      for (const item of args.items) itemById.set(item.id, item);
      return args.result.topK.map((scored) =>
        buildExplanation(
          scored,
          itemById.get(scored.itemId),
          args.user,
          args.result.algorithm,
        ),
      );
    },
  };
}

/** Claude / Gemini backed port. Caller wires the LLM brain. */
export function createLLMExplanationGenerator(opts: {
  readonly brain: (prompt: string) => Promise<string>;
}): ExplanationPort {
  return {
    async explain(args: ExplainArgs): Promise<ReadonlyArray<Explanation>> {
      const out: Explanation[] = [];
      const itemById = new Map<string, Item>();
      for (const item of args.items) itemById.set(item.id, item);
      for (const scored of args.result.topK) {
        const item = itemById.get(scored.itemId);
        const prompt = buildPrompt(scored, item, args.user, args.result.algorithm);
        const summary = (await opts.brain(prompt)).trim();
        out.push({
          itemId: scored.itemId,
          summary:
            summary.length > 0
              ? summary
              : `Recommended via ${args.result.algorithm}.`,
          drivers: driversFor(scored, item, args.user),
        });
      }
      return out;
    },
  };
}

function buildExplanation(
  scored: ScoredItem,
  item: Item | undefined,
  user: User | undefined,
  algorithm: string,
): Explanation {
  const drivers = driversFor(scored, item, user);
  const summary =
    drivers.length === 0
      ? `Top match by ${algorithm} (score=${scored.score.toFixed(3)}).`
      : `Top match by ${algorithm} (score=${scored.score.toFixed(3)}) — drivers: ${drivers.join(', ')}.`;
  return { itemId: scored.itemId, summary, drivers };
}

function driversFor(
  scored: ScoredItem,
  item: Item | undefined,
  user: User | undefined,
): string[] {
  const drivers: string[] = [];
  if (scored.reason) drivers.push(scored.reason);
  if (item?.features) {
    for (const [k, v] of Object.entries(item.features).slice(0, 3)) {
      drivers.push(`${k}=${v}`);
    }
  }
  if (user?.features) {
    for (const [k, v] of Object.entries(user.features).slice(0, 2)) {
      drivers.push(`user.${k}=${v}`);
    }
  }
  return drivers;
}

function buildPrompt(
  scored: ScoredItem,
  item: Item | undefined,
  user: User | undefined,
  algorithm: string,
): string {
  const itemFeatures = item?.features ? JSON.stringify(item.features) : '{}';
  const userFeatures = user?.features ? JSON.stringify(user.features) : '{}';
  return [
    `Explain in 1-2 sentences why item ${scored.itemId} is a strong match.`,
    `Algorithm: ${algorithm}.`,
    `Score: ${scored.score.toFixed(3)}.`,
    `Reason: ${scored.reason ?? '(none)'}.`,
    `Item features: ${itemFeatures}.`,
    `User features: ${userFeatures}.`,
    `Speak as Mr. Mwikila, the operator's autonomous MD.`,
  ].join(' ');
}
