/**
 * Voice narrator — converts a BriefingDocument into a spoken script.
 *
 * Target: 60-90 seconds of natural speech when read at ~170 words per
 * minute. Skips table-heavy sections (KPI table) in favour of a 1-2
 * sentence trend summary. Anomalies and recommendations are trimmed to
 * the top 2 so the script stays focused.
 *
 * Returns a plain string suitable for downstream TTS (ElevenLabs,
 * OpenAI Voice, etc.). No SSML — the TTS provider can apply its own
 * prosody rules.
 */

import type {
  BriefingDocument,
  BriefingRecommendation,
  EscalationsSection,
  KpiDeltasSection,
  OvernightSection,
  PendingApprovalsSection,
} from './types.js';

/** Average English speaking rate used for the 60-90s budget check. */
export const WORDS_PER_MINUTE = 170;
export const MAX_NARRATION_SECONDS = 90;
export const MIN_NARRATION_SECONDS = 15;

export function narrateForVoice(doc: BriefingDocument): string {
  const paragraphs: string[] = [];

  paragraphs.push(greet(doc));
  paragraphs.push(narrateOvernight(doc.overnight));
  paragraphs.push(narratePendingApprovals(doc.pendingApprovals));
  paragraphs.push(narrateEscalations(doc.escalations));
  paragraphs.push(narrateKpiTrend(doc.kpiDeltas));

  const topRec = doc.recommendations[0];
  if (topRec) paragraphs.push(narrateRecommendation(topRec));

  const topAnomaly = doc.anomalies[0];
  if (topAnomaly) {
    paragraphs.push(
      `One thing looks off in ${topAnomaly.area}: ${topAnomaly.observation} ${topAnomaly.suggestedInvestigation}`,
    );
  }

  paragraphs.push('That is your morning. Tell me where you want to start.');

  // Filter empties and collapse whitespace.
  const script = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ');

  return collapseSpace(script);
}

/** Rough word count — used by tests to assert we stay under the budget. */
export function countWords(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

/** Estimated seconds of speech for `script` at WORDS_PER_MINUTE. */
export function estimateSecondsForVoice(script: string): number {
  const words = countWords(script);
  return (words / WORDS_PER_MINUTE) * 60;
}

function greet(doc: BriefingDocument): string {
  return `Good morning. Here is your briefing. ${doc.headline}`;
}

function narrateOvernight(section: OvernightSection): string {
  if (section.totalAutonomousActions === 0) {
    return 'Overnight was quiet, with no autonomous activity of note.';
  }
  const countWord = section.totalAutonomousActions === 1 ? 'action' : 'actions';
  const top = section.notableActions[0];
  const trailer = top
    ? ` Most notably, in ${top.domain}, I ${top.summary.toLowerCase()}`
    : '';
  return `Overnight I handled ${section.totalAutonomousActions} ${countWord}.${trailer}`;
}

function narratePendingApprovals(section: PendingApprovalsSection): string {
  if (section.count === 0) return '';
  const top = section.items[0];
  const topSummary = top ? ` The most urgent concerns ${top.summary}.` : '';
  const countWord = section.count === 1 ? 'item' : 'items';
  return `You have ${section.count} approval ${countWord} waiting.${topSummary}`;
}

function narrateEscalations(section: EscalationsSection): string {
  if (section.count === 0) return '';
  const p1 = section.byPriority.P1;
  const top = section.items[0];
  const topSummary = top
    ? ` Top priority: ${top.summary}.`
    : '';
  if (p1 > 0) {
    const word = p1 === 1 ? 'escalation needs' : 'escalations need';
    return `${p1} P1 ${word} your eyes today.${topSummary}`;
  }
  return `I have surfaced ${section.count} escalations, none critical.${topSummary}`;
}

function narrateKpiTrend(kpis: KpiDeltasSection): string {
  const trendParts: string[] = [];
  const occ = kpis.occupancyPct;
  if (Number.isFinite(occ.value)) {
    const dir =
      occ.delta7d > 0.1 ? 'up' : occ.delta7d < -0.1 ? 'down' : 'flat';
    trendParts.push(
      `occupancy ${Math.round(occ.value)}% (${dir} over the week)`,
    );
  }
  const collections = kpis.collectionsRate;
  if (Number.isFinite(collections.value)) {
    const dir =
      collections.delta7d > 0.1
        ? 'improving'
        : collections.delta7d < -0.1
        ? 'slipping'
        : 'steady';
    trendParts.push(`collections ${Math.round(collections.value)}% ${dir}`);
  }
  if (trendParts.length === 0) return '';
  return `On the numbers: ${trendParts.join(', ')}.`;
}

function narrateRecommendation(rec: BriefingRecommendation): string {
  return `One thing I would do next: ${rec.summary} ${rec.suggestedAction}`;
}

function collapseSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
