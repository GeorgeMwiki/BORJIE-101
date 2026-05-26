/**
 * Bank of Tanzania (BoT) gold-window + FX rules.
 *
 * The BoT gold window is the central-bank facility through which a
 * minimum share of producer gold must be sold (vs exported as bullion).
 * See gh-issue #31: confirm latest minimum-share % from BoT directives;
 * current rule uses 20% placeholder.
 */

import type { RegulatoryRule, RuleResult } from '../types.js';

const MIN_WINDOW_SHARE = 0.2;

export const botGoldWindowShareRule: RegulatoryRule = {
  id: 'bot.gold-window.share',
  regulator: 'bot',
  title: 'Producer must route the BoT-mandated minimum share of gold via the gold window',
  citation: 'BoT Gold Purchase Directive (latest circular pending — see gh-issue #31)',
  evaluate(facts): RuleResult {
    const tonnesInWindow = facts.goldWindowReceipts.reduce(
      (s, r) => s + r.tonnes,
      0,
    );
    const total = tonnesInWindow + facts.goldSoldOutsideWindowTonnes;
    if (total === 0) {
      return result('unknown', 'No gold sales recorded for the period.', []);
    }
    const share = tonnesInWindow / total;
    if (share < MIN_WINDOW_SHARE) {
      return result(
        'breach',
        `BoT window share ${(share * 100).toFixed(1)}% below required ${(MIN_WINDOW_SHARE * 100).toFixed(0)}%.`,
        facts.goldWindowReceipts.map((r) => `gold-window.${r.id}`),
      );
    }
    return result(
      'compliant',
      `BoT window share ${(share * 100).toFixed(1)}% meets minimum.`,
      facts.goldWindowReceipts.map((r) => `gold-window.${r.id}`),
    );
  },
};

export const botFxRepatriationRule: RegulatoryRule = {
  id: 'bot.fx.repatriation',
  regulator: 'bot',
  title: 'Export proceeds must be repatriated within the regulated FX window',
  citation: 'Foreign Exchange Act (Cap. 271) (specific section pending — see gh-issue #31)',
  evaluate(facts): RuleResult {
    // Heuristic stand-in until the exact repatriation rule is encoded:
    // require at least one gold-window receipt in the last 30 days when
    // there is any sale activity at all.
    if (facts.goldSoldOutsideWindowTonnes === 0 && facts.goldWindowReceipts.length === 0) {
      return result('unknown', 'No FX-relevant sales in the period.', []);
    }
    const recent = facts.goldWindowReceipts.filter(
      (r) => daysBetween(facts.asOfISO, r.receivedISO) <= 30,
    );
    if (recent.length === 0 && facts.goldSoldOutsideWindowTonnes > 0) {
      return result(
        'warning',
        'No BoT-window receipts in the last 30 days despite active sales — review FX repatriation status.',
        [],
      );
    }
    return result('compliant', 'FX repatriation pattern within window.', recent.map((r) => `gold-window.${r.id}`));
  },
};

export const BOT_RULES: ReadonlyArray<RegulatoryRule> = [
  botGoldWindowShareRule,
  botFxRepatriationRule,
];

function result(
  verdict: RuleResult['verdict'],
  message: string,
  pointers: ReadonlyArray<string>,
): RuleResult {
  return {
    ruleId: 'bot.gold-window.share',
    regulator: 'bot',
    title: botGoldWindowShareRule.title,
    citation: botGoldWindowShareRule.citation,
    verdict,
    message,
    evidence: pointers.map((p) => ({
      id: `gw:${p}`,
      kind: 'gold-window',
      pointer: p,
    })),
  };
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000),
  );
}
