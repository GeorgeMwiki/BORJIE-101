/**
 * Source-quality scorer — implements the 9-class rubric from
 * DEEP_RESEARCH_SPEC §7.
 *
 * Pure function. Inputs: URI, content text, retrieved-at timestamp.
 * Outputs: numeric quality_score in [0, 1], the classified SourceClass,
 * detected bias_flags, and a human-readable rationale.
 *
 * Modifiers (applied on top of the base score):
 *   - Recency: published > 90 days ago for a fast-moving topic → ×0.7.
 *   - Corroboration: ≥2 other high-quality sources agree → +0.10 (capped 1.0).
 *   - Internal-consistency: contradicts a high-confidence corpus fact → ×0.5.
 *   - AI-generated detection: bias_flags includes 'ai_generated' → cap 0.20
 *     unless corroborated by a Tier-1+ source.
 *
 * The rubric is intentionally simple and rule-based — no LLM call.
 * Faster, cheaper, deterministic, auditable.
 *
 * @module @borjie/research-tools/scorer/source-quality
 */

import type { BiasFlag, SourceClass } from '../types.js';
import { detectBiasFlags } from './bias-detector.js';

// ---------------------------------------------------------------------------
// Base scores — DO NOT EDIT without updating the spec table
// ===========================================================================

export const SOURCE_BASE_SCORE: Readonly<Record<SourceClass, number>> =
  Object.freeze({
    tz_official: 0.95,
    tier1_market: 0.9,
    academic: 0.85,
    corporate_filing: 0.85,
    established_news: 0.75,
    trade_press: 0.7,
    forum: 0.3,
    generic_blog: 0.2,
    ai_generated: 0.1,
  });

// ---------------------------------------------------------------------------
// Domain → class lookup
// ===========================================================================

const TZ_OFFICIAL_HOSTS: ReadonlyArray<string> = [
  'tumemadini.go.tz',
  'nemc.or.tz',
  'tra.go.tz',
  'bot.go.tz',
  'gepg.go.tz',
  'pccb.go.tz',
  'eg.gov.tz',
  'tic.go.tz',
  'tcra.go.tz',
];

const TZ_OFFICIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\.go\.tz$/,
  /\.gov\.tz$/,
];

const TIER1_MARKET_HOSTS: ReadonlyArray<string> = [
  'lme.com',
  'lme.co.uk',
  'kitco.com',
  'bloomberg.com',
  'reuters.com',
  'ft.com',
  'wsj.com',
  'nasdaq.com',
];

const ACADEMIC_HOSTS: ReadonlyArray<string> = [
  'nature.com',
  'science.org',
  'arxiv.org',
  'sciencedirect.com',
  'jstor.org',
  'ssrn.com',
  'springer.com',
  'wiley.com',
  'elsevier.com',
  'tandfonline.com',
];

const ACADEMIC_PATTERNS: ReadonlyArray<RegExp> = [
  /\.edu$/,
  /\.ac\.[a-z]{2,3}$/,
];

const ESTABLISHED_NEWS_HOSTS: ReadonlyArray<string> = [
  'bbc.com',
  'bbc.co.uk',
  'theguardian.com',
  'nytimes.com',
  'aljazeera.com',
  'mining-journal.com',
  'mining-weekly.com',
  'miningweekly.com',
  'cnn.com',
  'afp.com',
  'apnews.com',
];

const TRADE_PRESS_HOSTS: ReadonlyArray<string> = [
  'mining.com',
  'spglobal.com',
  'fastmarkets.com',
  'metalbulletin.com',
  'platts.com',
  'argusmedia.com',
  'mining.com.au',
];

const CORPORATE_FILING_HOSTS: ReadonlyArray<string> = [
  'sec.gov',
  'sedar.com',
  'asx.com.au',
  'lse.co.uk',
  'tse.or.jp',
  'jse.co.za',
  'investorrelations',
];

const FORUM_HOSTS: ReadonlyArray<string> = [
  'reddit.com',
  'quora.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'linkedin.com',
  'medium.com',
  'substack.com',
  'discord.com',
  'youtube.com',
  'tiktok.com',
];

// ---------------------------------------------------------------------------
// Public surface
// ===========================================================================

export interface SourceScoreInput {
  readonly uri: string;
  readonly content: string;
  readonly retrieved_at: string;
  /** Optional published-at ISO timestamp from the source (if available). */
  readonly published_at?: string;
  /** Is the topic fast-moving (prices, regs)? Triggers the 90-day decay. */
  readonly is_fast_moving_topic?: boolean;
  /** Number of other high-quality sources that agree. Drives corroboration. */
  readonly corroborating_high_quality_sources?: number;
  /** Did this artifact contradict a confidence=high corpus fact? */
  readonly contradicts_internal_corpus?: boolean;
}

export interface SourceScoreOutput {
  readonly score: number;
  readonly class: SourceClass;
  readonly bias_flags: ReadonlyArray<BiasFlag>;
  readonly rationale: string;
}

/**
 * Score an arbitrary source. Pure — no I/O, deterministic given the
 * same inputs. The scorer is the heart of every adapter's pipeline:
 * adapters call this on every retrieved artifact and stamp the score +
 * flags into the ResearchArtifact row.
 */
export function scoreSource(input: SourceScoreInput): SourceScoreOutput {
  const sourceClass = classifySource(input.uri);
  const biasFlags = detectBiasFlags({
    uri: input.uri,
    content: input.content,
  });

  // Base score from the rubric.
  let score = SOURCE_BASE_SCORE[sourceClass];
  const rationaleParts: Array<string> = [];
  rationaleParts.push(`base=${score.toFixed(2)} (${sourceClass})`);

  // Modifier: AI-generated detected ⇒ hard cap at 0.20 unless tier-1+ corroborated.
  if (biasFlags.includes('ai_generated')) {
    const corroboratedTier1 = (input.corroborating_high_quality_sources ?? 0) >= 1;
    if (!corroboratedTier1) {
      score = Math.min(score, 0.2);
      rationaleParts.push('ai_generated_cap=0.20');
    } else {
      rationaleParts.push('ai_generated_but_corroborated');
    }
  }

  // Modifier: recency decay.
  if (input.is_fast_moving_topic === true) {
    const publishedIso = input.published_at ?? input.retrieved_at;
    const ageDays = computeAgeDays(publishedIso, input.retrieved_at);
    if (ageDays > 90) {
      score *= 0.7;
      rationaleParts.push(`stale_${Math.round(ageDays)}d_decay=0.7`);
    }
  }

  // Modifier: corroboration boost.
  const corrob = input.corroborating_high_quality_sources ?? 0;
  if (corrob >= 2) {
    score = Math.min(1.0, score + 0.1);
    rationaleParts.push(`corroborated_${corrob}_boost=+0.10`);
  }

  // Modifier: contradicts internal corpus.
  if (input.contradicts_internal_corpus === true) {
    score *= 0.5;
    rationaleParts.push('contradicts_corpus_decay=0.5');
  }

  // Forum-like + opinion ⇒ extra cap.
  if (sourceClass === 'forum' && biasFlags.includes('opinion')) {
    score = Math.min(score, 0.25);
    rationaleParts.push('forum_opinion_cap=0.25');
  }

  // Generic blog with paid_promotion ⇒ extra cap.
  if (sourceClass === 'generic_blog' && biasFlags.includes('paid_promotion')) {
    score = Math.min(score, 0.1);
    rationaleParts.push('blog_paid_cap=0.10');
  }

  // Clamp.
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    class: sourceClass,
    bias_flags: biasFlags,
    rationale: rationaleParts.join('; '),
  };
}

/**
 * Map a URI to one of the 9 source classes. Public so adapters that
 * need only the classification (not the score) can use it directly.
 */
export function classifySource(uri: string): SourceClass {
  const host = extractHostname(uri);
  if (!host) return 'generic_blog';

  if (matchesAnyHost(host, TZ_OFFICIAL_HOSTS) || matchesAnyPattern(host, TZ_OFFICIAL_PATTERNS)) {
    return 'tz_official';
  }
  if (matchesAnyHost(host, TIER1_MARKET_HOSTS)) {
    return 'tier1_market';
  }
  if (matchesAnyHost(host, ACADEMIC_HOSTS) || matchesAnyPattern(host, ACADEMIC_PATTERNS)) {
    return 'academic';
  }
  if (matchesAnyHost(host, CORPORATE_FILING_HOSTS)) {
    return 'corporate_filing';
  }
  if (matchesAnyHost(host, ESTABLISHED_NEWS_HOSTS)) {
    return 'established_news';
  }
  if (matchesAnyHost(host, TRADE_PRESS_HOSTS)) {
    return 'trade_press';
  }
  if (matchesAnyHost(host, FORUM_HOSTS)) {
    return 'forum';
  }
  return 'generic_blog';
}

// ---------------------------------------------------------------------------
// Helpers
// ===========================================================================

function extractHostname(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesAnyHost(host: string, list: ReadonlyArray<string>): boolean {
  for (const h of list) {
    if (host === h || host.endsWith(`.${h}`)) return true;
  }
  return false;
}

function matchesAnyPattern(
  host: string,
  patterns: ReadonlyArray<RegExp>,
): boolean {
  for (const p of patterns) {
    if (p.test(host)) return true;
  }
  return false;
}

function computeAgeDays(publishedIso: string, retrievedIso: string): number {
  const pubMs = Date.parse(publishedIso);
  const retMs = Date.parse(retrievedIso);
  if (Number.isNaN(pubMs) || Number.isNaN(retMs)) return 0;
  return Math.max(0, (retMs - pubMs) / (24 * 60 * 60 * 1_000));
}
