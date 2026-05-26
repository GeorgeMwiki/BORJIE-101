/**
 * Coaching-nudge generator (Wave PERF-1).
 *
 * Produces one short (≤180-word) coaching nudge per scorecard,
 * tuned to the subject's persona-voice mode. Production hosts may
 * override the reference template-based generator with a real LLM
 * port; the reference impl is canned-template based per spec §6
 * and clearly labelled.
 *
 * Voices mirror `@borjie/persona-voice`:
 *   GUIDE   — first-person plural, action verbs, artifact-ready.
 *   LEARN   — Socratic, scaffolded, clarifier prompt at the tail.
 *   BALANCED— neutral, with collapsible 'why'.
 */

import {
  MAX_NUDGE_WORDS,
  type EmployeeScorecard,
  type Kpi,
  type RoleKpiTemplate,
} from '../types.js';

export type CoachVoice = 'guide' | 'learn' | 'balanced';

export interface CoachNudgeInput {
  readonly scorecard: EmployeeScorecard;
  readonly template: RoleKpiTemplate;
  readonly voice: CoachVoice;
  /** Optional personalised greeting prefix (e.g. employee first name). */
  readonly greeting?: string;
}

/**
 * Pick the lowest-band KPI from the scorecard — the single biggest
 * lever the subject has for tomorrow. Ties broken by weight (largest
 * weight wins; coach focuses on the most consequential miss).
 */
export function pickWorstKpi(
  scorecard: EmployeeScorecard,
  template: RoleKpiTemplate,
): { readonly kpi: Kpi; readonly raw: number; readonly band: number } | null {
  if (scorecard.kpis.length === 0) return null;
  const weightById = new Map<string, number>();
  for (const k of template.kpi_definitions) {
    weightById.set(k.id, k.weight);
  }
  const sorted = [...scorecard.kpis].sort((a, b) => {
    if (a.band !== b.band) return a.band - b.band;
    const wa = weightById.get(a.kpi_id) ?? 0;
    const wb = weightById.get(b.kpi_id) ?? 0;
    return wb - wa;
  });
  const worst = sorted[0];
  if (!worst) return null;
  const kpi = template.kpi_definitions.find((k) => k.id === worst.kpi_id);
  if (!kpi) return null;
  return { kpi, raw: worst.raw, band: worst.band };
}

/**
 * Pick the highest-band KPI — used to anchor a celebratory line in
 * the nudge. Returns null if every KPI is at the missed band.
 */
export function pickBestKpi(
  scorecard: EmployeeScorecard,
  template: RoleKpiTemplate,
): { readonly kpi: Kpi; readonly raw: number; readonly band: number } | null {
  if (scorecard.kpis.length === 0) return null;
  const sorted = [...scorecard.kpis].sort((a, b) => b.band - a.band);
  const best = sorted[0];
  if (!best) return null;
  if (best.band === 0) return null;
  const kpi = template.kpi_definitions.find((k) => k.id === best.kpi_id);
  if (!kpi) return null;
  return { kpi, raw: best.raw, band: best.band };
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

function clipToMaxWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return `${words.slice(0, max).join(' ')}…`;
}

function greetingPrefix(input: CoachNudgeInput): string {
  if (input.greeting && input.greeting.trim().length > 0) {
    return `${input.greeting.trim()}, `;
  }
  return '';
}

function guideBody(
  input: CoachNudgeInput,
  worst: { kpi: Kpi; raw: number; band: number } | null,
  best: { kpi: Kpi; raw: number; band: number } | null,
): string {
  const lines: string[] = [];
  const opener = `${greetingPrefix(input)}I've reviewed yesterday's numbers for you.`;
  lines.push(opener);
  if (best) {
    lines.push(
      `Strength: ${best.kpi.label} came in at ${formatNumber(best.raw)} (band ${formatNumber(best.band)}).`,
    );
  }
  if (worst) {
    lines.push(
      `Lever for today: ${worst.kpi.label} at ${formatNumber(worst.raw)} (target ${formatNumber(worst.kpi.target)}). I've drafted a catch-up — approve when ready.`,
    );
  } else {
    lines.push("I've drafted today's brief — approve when ready.");
  }
  return lines.join(' ');
}

function learnBody(
  input: CoachNudgeInput,
  worst: { kpi: Kpi; raw: number; band: number } | null,
  best: { kpi: Kpi; raw: number; band: number } | null,
): string {
  const lines: string[] = [];
  const opener = `${greetingPrefix(input)}before we draft today's plan, let's walk through yesterday together.`;
  lines.push(opener);
  if (best) {
    lines.push(
      `${best.kpi.label} hit ${formatNumber(best.raw)} — what changed yesterday that helped?`,
    );
  }
  if (worst) {
    lines.push(
      `${worst.kpi.label} came in at ${formatNumber(worst.raw)} versus a target of ${formatNumber(worst.kpi.target)}. Walk me through what slowed you down — I'll check your reasoning before I draft a fix.`,
    );
  } else {
    lines.push('Walk me through what you want to prioritise today.');
  }
  return lines.join(' ');
}

function balancedBody(
  input: CoachNudgeInput,
  worst: { kpi: Kpi; raw: number; band: number } | null,
  best: { kpi: Kpi; raw: number; band: number } | null,
): string {
  const lines: string[] = [];
  const opener = `${greetingPrefix(input)}quick read on yesterday.`;
  lines.push(opener);
  if (best) {
    lines.push(
      `Up: ${best.kpi.label} at ${formatNumber(best.raw)}.`,
    );
  }
  if (worst) {
    lines.push(
      `Down: ${worst.kpi.label} at ${formatNumber(worst.raw)} (target ${formatNumber(worst.kpi.target)}). Tap 'why' for the math; tap 'plan' for a draft fix.`,
    );
  } else {
    lines.push("Tap 'plan' for today's draft brief.");
  }
  return lines.join(' ');
}

/**
 * Generate a coaching nudge for the given scorecard + voice. Reference
 * canned-template impl per spec §6; production hosts may swap in an
 * LLM port that consumes the same input and returns a string ≤180
 * words.
 */
export function generateCoachNudge(input: CoachNudgeInput): string {
  const worst = pickWorstKpi(input.scorecard, input.template);
  const best = pickBestKpi(input.scorecard, input.template);
  let body: string;
  if (input.voice === 'guide') body = guideBody(input, worst, best);
  else if (input.voice === 'learn') body = learnBody(input, worst, best);
  else body = balancedBody(input, worst, best);
  return clipToMaxWords(body, MAX_NUDGE_WORDS);
}

/**
 * Port — production hosts wire an LLM-backed generator. Same input
 * shape; returns a Promise<string>. Used by the scheduler when the
 * tenant has an LLM nudge generator enabled.
 */
export interface CoachNudgeGenerator {
  generate(input: CoachNudgeInput): Promise<string>;
}

/** Reference impl wrapping the sync canned-template generator. */
export function createReferenceCoachNudgeGenerator(): CoachNudgeGenerator {
  return {
    async generate(input) {
      return generateCoachNudge(input);
    },
  };
}
