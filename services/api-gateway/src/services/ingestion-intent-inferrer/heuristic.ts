/**
 * Deterministic heuristic intent generator — Wave COMPANY-BRAIN (Y-A).
 *
 * The brilliant LLM path is the production default, but we ALWAYS have a
 * deterministic fallback because:
 *
 *   1. CI / dev runs lack an LLM key. The full ingest → intent demo must
 *      still produce a credible proposal so the owner-web tests cover
 *      the happy path.
 *   2. The LLM may be down or rate-limited. The owner-cockpit must still
 *      show SOMETHING actionable, not a blank card.
 *   3. The deterministic path is the regression test bed for the
 *      "every proposal cites evidence" invariant. If the heuristic ever
 *      emits a proposal without an evidence id, CI fails immediately.
 *
 * The heuristic uses pattern-matching over the snapshot's entity counts
 * + key facts to surface up to:
 *
 *   - 3 tabs        (buyers / sales / regulator-deadlines if data justifies)
 *   - 3 reminders   (royalty filings, licence renewals, overdue invoices)
 *   - 3 opportunities (re-engage lapsed buyer, price arbitrage by mineral)
 *   - 3 risks       (overdue royalty, missing chain-of-custody, expiring permit)
 *
 * Every proposal pulls its evidence id from the actual chunk samples
 * passed in — we NEVER fabricate a chunk id, so the recall layer can
 * always render the source.
 */

import type {
  IngestIntent,
  IngestSnapshot,
  ProposedOpportunity,
  ProposedReminder,
  ProposedRisk,
  ProposedTab,
} from './types.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

function pickEvidenceIds(
  snapshot: IngestSnapshot,
  max: number,
): ReadonlyArray<string> {
  const ids = snapshot.chunkSamples
    .map((c) => c.chunkId)
    .filter((id) => id.length > 0);
  return ids.slice(0, Math.max(1, Math.min(max, 5)));
}

function entityCountByKind(snapshot: IngestSnapshot): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of snapshot.availableEntities) {
    out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
  }
  return out;
}

function buildTabsForBuyers(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedTab | null {
  // Heuristic: when at least one buyer-shaped entity is found (or the
  // doc clearly enumerates a buyer list via headers in a CSV), propose
  // a buyers tab. The text-evidence is the actual headers / entities.
  const counts = entityCountByKind(snapshot);
  const candidateCount = counts.get('candidate_entity') ?? 0;
  const isBuyersDoc =
    /buyer|client|customer|nunua|mteja/i.test(snapshot.filename) ||
    snapshot.keyFacts.some((f) =>
      /buyer|customer|client/i.test(f.value),
    ) ||
    candidateCount >= 5;
  if (!isBuyersDoc) return null;
  return {
    tabType: 'buyers',
    titleEn: 'Buyers — top 12',
    titleSw: 'Wanunuzi — 12 wakuu',
    reasonEn: `Detected ${candidateCount} candidate entities and a buyer-shaped filename — recommend cataloging the top counterparties into a dedicated tab.`,
    reasonSw: `Imegundua wahusika ${candidateCount} na jina la faili linaonyesha wanunuzi — pendekeza kuandika wanunuzi wakuu kwenye kichupo.`,
    evidenceIds,
    confidence: candidateCount >= 12 ? 0.82 : 0.62,
    config: {
      ranking: 'volume_desc',
      limit: 12,
      sourceUpload: snapshot.receipt.uploadId,
    },
  };
}

function buildTabsForRoyaltyCalendar(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedTab | null {
  const counts = entityCountByKind(snapshot);
  const royaltyHit = counts.get('concept') ?? 0;
  const regulatorHit = counts.get('regulator') ?? 0;
  if (royaltyHit === 0 && regulatorHit === 0) return null;
  return {
    tabType: 'compliance',
    titleEn: 'Royalty & licence calendar',
    titleSw: 'Kalenda ya mrabaha na leseni',
    reasonEn: `Detected ${royaltyHit} royalty mention(s) and ${regulatorHit} regulator mention(s) — recommend a compliance calendar tab so deadlines stay visible.`,
    reasonSw: `Imegundua ya mrabaha ${royaltyHit} na ya mdhibiti ${regulatorHit} — pendekeza kichupo cha kalenda ya utiifu ili tarehe zionekane.`,
    evidenceIds,
    confidence: 0.7,
    config: {
      lookAheadDays: 90,
      sourceUpload: snapshot.receipt.uploadId,
    },
  };
}

function buildTabsForMineralBreakdown(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedTab | null {
  const minerals = snapshot.availableEntities.filter(
    (e) => e.kind === 'mineral',
  );
  if (minerals.length < 2) return null;
  const sample = minerals.slice(0, 4).map((m) => m.displayName).join(', ');
  return {
    tabType: 'production',
    titleEn: `Production by mineral (${minerals.length})`,
    titleSw: `Uzalishaji kwa madini (${minerals.length})`,
    reasonEn: `Detected ${minerals.length} distinct minerals in this doc (${sample}) — recommend a per-mineral production-vs-sales tab.`,
    reasonSw: `Imegundua madini ${minerals.length} (${sample}) — pendekeza kichupo cha uzalishaji-na-mauzo kwa kila aina ya madini.`,
    evidenceIds,
    confidence: 0.65,
    config: {
      mineralIds: minerals.map((m) => m.id).slice(0, 8),
      view: 'quarterly',
      sourceUpload: snapshot.receipt.uploadId,
    },
  };
}

function buildRemindersForRoyalty(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
  now: Date,
): ProposedReminder | null {
  const hasRoyalty = snapshot.keyFacts.some((f) =>
    /royalty|mrabaha|tra/i.test(f.value),
  ) || /royalty|mrabaha/i.test(snapshot.filename);
  if (!hasRoyalty) return null;
  // 14 days out — gives the owner time to gather docs.
  const triggerAt = new Date(now.getTime() + 14 * SECONDS_PER_DAY * 1000);
  return {
    titleEn: 'File royalty return (14d notice)',
    titleSw: 'Wasilisha mrabaha (siku 14)',
    bodyEn: `This ingested doc references royalties — schedule the monthly TRA filing reminder so it lands two weeks before deadline.`,
    bodySw: `Hati uliyowasilisha inahusu mrabaha — panga kumbusho la kufungua TRA wiki mbili kabla ya mwisho.`,
    triggerAtIso: triggerAt.toISOString(),
    channel: 'email',
    reasonEn: 'Royalty mention found in upload — preemptive reminder reduces 5% late-penalty risk.',
    reasonSw: 'Mrabaha umetajwa kwenye hati — kumbusho la mapema linapunguza adhabu ya 5%.',
    evidenceIds,
    confidence: 0.75,
  };
}

function buildRemindersForReceivables(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
  now: Date,
): ProposedReminder | null {
  const moneyFacts = snapshot.availableEntities.filter(
    (e) => e.kind === 'money_mention',
  );
  if (moneyFacts.length < 3) return null;
  // 7 days out — receivables age fast.
  const triggerAt = new Date(now.getTime() + 7 * SECONDS_PER_DAY * 1000);
  return {
    titleEn: `Follow up on ${moneyFacts.length} outstanding amounts`,
    titleSw: `Fuatilia kiasi ${moneyFacts.length} kilichobaki`,
    bodyEn: `Detected ${moneyFacts.length} monetary mentions in this doc — many docs of this shape are unpaid invoices. Worth following up in a week.`,
    bodySw: `Imegundua kiasi cha pesa ${moneyFacts.length} — hati za aina hii mara nyingi ni ankara ambazo hazijalipwa. Fuatilia ndani ya wiki moja.`,
    triggerAtIso: triggerAt.toISOString(),
    channel: 'email',
    reasonEn: 'High count of monetary mentions; following up early reduces DSO.',
    reasonSw: 'Idadi kubwa ya kiasi cha pesa; ufuatiliaji wa mapema unapunguza muda wa kulipwa.',
    evidenceIds,
    confidence: 0.6,
  };
}

function buildOpportunityReengageLapsed(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedOpportunity | null {
  const candidates = snapshot.availableEntities.filter(
    (e) => e.kind === 'candidate_entity',
  );
  if (candidates.length < 3) return null;
  const sample = candidates.slice(0, 3).map((c) => c.displayName).join(', ');
  return {
    kind: 'reengage_lapsed_buyer',
    titleEn: 'Re-engage lapsed buyers',
    titleSw: 'Rejea wanunuzi waliokoma',
    reasonEn: `Identified candidate buyers (${sample}) — if their last purchase is >60 days old, a personalised outreach is a typical 6-15% conversion bet.`,
    reasonSw: `Wahusika wanaowezekana (${sample}) — kama hawajanunua kwa siku 60+, mawasiliano binafsi mara nyingi yanafanikiwa 6-15%.`,
    expectedValueTzs: null,
    timeWindowDays: 30,
    evidenceIds,
    confidence: 0.55,
  };
}

function buildOpportunityPriceArbitrage(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedOpportunity | null {
  const minerals = snapshot.availableEntities.filter(
    (e) => e.kind === 'mineral',
  );
  if (minerals.length < 2) return null;
  return {
    kind: 'price_arbitrage_check',
    titleEn: 'Check price arbitrage across minerals',
    titleSw: 'Angalia tofauti ya bei kati ya madini',
    reasonEn: `Doc references ${minerals.length} different minerals — pulling current LME / TUMEMADINI prices reveals which mineral has the widest realised-vs-market gap.`,
    reasonSw: `Hati inataja madini ${minerals.length} — kuangalia bei za LME / TUMEMADINI kunaweza kuonyesha madini yenye tofauti kubwa ya bei.`,
    expectedValueTzs: null,
    timeWindowDays: 14,
    evidenceIds,
    confidence: 0.5,
  };
}

function buildRiskOverdueRoyalty(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedRisk | null {
  const dateFacts = snapshot.availableEntities.filter(
    (e) => e.kind === 'date_mention',
  );
  const hasRoyalty = snapshot.keyFacts.some((f) =>
    /royalty|mrabaha/i.test(f.value),
  );
  if (!hasRoyalty || dateFacts.length === 0) return null;
  return {
    kind: 'overdue_royalty_filing',
    titleEn: 'Verify royalty filings are not overdue',
    titleSw: 'Hakikisha mrabaha haujachelewa',
    reasonEn: `Royalty mentions + ${dateFacts.length} date(s) in this doc — confirm the most recent filing was lodged within the 7-day TRA window.`,
    reasonSw: `Mrabaha umetajwa na tarehe ${dateFacts.length} — hakikisha uwasilishaji wa hivi karibuni umefanyika ndani ya siku 7 za TRA.`,
    severity: 'high',
    evidenceIds,
    confidence: 0.65,
  };
}

function buildRiskMissingChainOfCustody(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedRisk | null {
  const moneyFacts = snapshot.availableEntities.filter(
    (e) => e.kind === 'money_mention',
  );
  const candidates = snapshot.availableEntities.filter(
    (e) => e.kind === 'candidate_entity',
  );
  // If we see lots of money and buyers but no mineral-class context, the
  // chain-of-custody backfill is the right risk to surface.
  if (moneyFacts.length < 3 || candidates.length < 2) return null;
  return {
    kind: 'missing_chain_of_custody',
    titleEn: 'Backfill chain-of-custody for these sales',
    titleSw: 'Jaza historia ya umiliki wa madini kwa mauzo haya',
    reasonEn: `${moneyFacts.length} sales references against ${candidates.length} candidate buyers — without a per-sale chain-of-custody record, the regulator may flag an audit.`,
    reasonSw: `Mauzo ${moneyFacts.length} kwa wanunuzi ${candidates.length} — bila historia ya umiliki kwa kila mauzo, mdhibiti anaweza kuhoji ukaguzi.`,
    severity: 'medium',
    evidenceIds,
    confidence: 0.55,
  };
}

function buildRiskExpiringPermit(
  snapshot: IngestSnapshot,
  evidenceIds: ReadonlyArray<string>,
): ProposedRisk | null {
  const licenceHits = snapshot.availableEntities.filter(
    (e) => e.kind === 'licence_kind',
  );
  if (licenceHits.length === 0) return null;
  return {
    kind: 'expiring_permit',
    titleEn: 'Check PML / licence expiry windows',
    titleSw: 'Angalia muda wa kuisha kwa leseni ya PML',
    reasonEn: `Detected ${licenceHits.length} licence reference(s) — confirm none of them expire within the next 90 days.`,
    reasonSw: `Imegundua leseni ${licenceHits.length} — hakikisha hakuna inayoisha ndani ya siku 90.`,
    severity: 'high',
    evidenceIds,
    confidence: 0.7,
  };
}

export interface HeuristicOptions {
  readonly now?: () => Date;
}

export function generateHeuristicIntent(
  snapshot: IngestSnapshot,
  options?: HeuristicOptions,
): IngestIntent {
  const now = options?.now?.() ?? new Date();
  const evidenceIds = pickEvidenceIds(snapshot, 3);

  // If we have ZERO chunk samples, we still need at least one evidence
  // id (the upload id) to satisfy the brilliance contract.
  const finalEvidenceIds =
    evidenceIds.length > 0
      ? evidenceIds
      : Object.freeze([`upload:${snapshot.receipt.uploadId}`]);

  const tabs = [
    buildTabsForBuyers(snapshot, finalEvidenceIds),
    buildTabsForRoyaltyCalendar(snapshot, finalEvidenceIds),
    buildTabsForMineralBreakdown(snapshot, finalEvidenceIds),
  ].filter((t): t is ProposedTab => t !== null);

  const reminders = [
    buildRemindersForRoyalty(snapshot, finalEvidenceIds, now),
    buildRemindersForReceivables(snapshot, finalEvidenceIds, now),
  ].filter((r): r is ProposedReminder => r !== null);

  const opportunities = [
    buildOpportunityReengageLapsed(snapshot, finalEvidenceIds),
    buildOpportunityPriceArbitrage(snapshot, finalEvidenceIds),
  ].filter((o): o is ProposedOpportunity => o !== null);

  const risks = [
    buildRiskOverdueRoyalty(snapshot, finalEvidenceIds),
    buildRiskMissingChainOfCustody(snapshot, finalEvidenceIds),
    buildRiskExpiringPermit(snapshot, finalEvidenceIds),
  ].filter((r): r is ProposedRisk => r !== null);

  const total = tabs.length + reminders.length + opportunities.length + risks.length;
  const narrativeEn = total === 0
    ? `Borjie ingested ${snapshot.filename} — no high-confidence proposals from the deterministic pass; the brilliant LLM pass will run when reachable.`
    : `Borjie scanned ${snapshot.filename} and surfaced ${tabs.length} tab idea(s), ${reminders.length} reminder(s), ${opportunities.length} opportunity, ${risks.length} risk(s) — accept any below to act on them.`;
  const narrativeSw = total === 0
    ? `Borjie imeingiza ${snapshot.filename} — hakuna mapendekezo ya juu kutoka kwa mfumo wa kawaida.`
    : `Borjie imechanganua ${snapshot.filename} na imependekeza vichupo ${tabs.length}, kumbusho ${reminders.length}, fursa ${opportunities.length}, hatari ${risks.length} — kubali yoyote ili kufanya kazi.`;

  return Object.freeze({
    proposedTabs: Object.freeze(tabs),
    proposedReminders: Object.freeze(reminders),
    proposedOpportunities: Object.freeze(opportunities),
    proposedRisks: Object.freeze(risks),
    confidence: total === 0 ? 0.2 : 0.55,
    narrativeEn,
    narrativeSw,
    reasonTag: 'heuristic-v1',
    provider: 'heuristic',
    generatedAtIso: now.toISOString(),
  });
}
