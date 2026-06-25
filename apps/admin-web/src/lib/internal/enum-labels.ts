/**
 * Localized labels for the bounded enum tokens the internal console renders in
 * badges and pills.
 *
 * The recurring anti-pattern this module kills:
 *   `<StubBadge tone={tone(x)}>{x}</StubBadge>` / `<Badge>{row.outcome}</Badge>`
 * The TONE is bounded (mapped through a closed `tone()` helper), but the LABEL
 * `{x}` was the RAW gateway enum token — a mixed-case English string like
 * `Indexed`, `High`, `running`, `OK`. Under the `sw` toggle that raw token is a
 * language MIX (English label under Swahili chrome), on every load, that the
 * intra-string locale-purity scanner cannot see (no single string is
 * bilingual) and the hardcoded-EN component scanner cannot see (the token is an
 * interpolated value, not a literal). The zero-mix canon forbids it the same:
 * one language per rendered context, matching the active locale.
 *
 * The fix: localize the LABEL through `localizeEnumLabel(MAP, value, locale)`.
 * Each domain map carries a complete `{ en, sw }` pair per known token (full
 * parity — a missing `sw` is a build failure, never an EN fallback). Resolution
 * is case-insensitive (the wire mixes `High`/`high`, `OK`/`ok`).
 *
 * For an OFF-ENUM token (a future gateway value, a typo, a partial deploy) the
 * resolver returns a LOCALE-NEUTRAL machine presentation — the token humanized
 * (separators → spaces) and rendered as-is in BOTH locales. A bare machine
 * code is locale-neutral (it is a code, not prose), so it never DEREFS into a
 * `TypeError` and never asserts one language over the other. This mirrors the
 * fail-safe shape of `clampKillswitchLevel` (off-enum → a safe sentinel, never
 * a throw).
 *
 * This module is pure data + a pure helper (no React, no `pickByLocale` hook
 * coupling) so it imports cleanly into both server and client components.
 */

import type { Locale } from '@/lib/locale-shared';

export interface EnumLabel {
  readonly en: string;
  readonly sw: string;
}

/** A closed `lowercased-token -> { en, sw }` label map for one enum domain. */
export type EnumLabelMap = Readonly<Record<string, EnumLabel>>;

/**
 * Resolve a bounded enum token to its localized label. Case-insensitive on the
 * key (the wire mixes casing). Off-enum tokens fall back to a locale-NEUTRAL
 * humanized machine presentation in BOTH locales — never a raw English string
 * forced under `sw`, never an undefined deref.
 */
export function localizeEnumLabel(
  map: EnumLabelMap,
  value: string | null | undefined,
  locale: Locale,
): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const entry = map[raw.toLowerCase()];
  if (entry) return locale === 'sw' ? entry.sw : entry.en;
  // Off-enum: a locale-neutral machine token (code, not prose). Humanize
  // separators so `licence_expired` reads `licence expired` in both locales.
  return raw.replace(/[_.]+/g, ' ');
}

/** Corpus chunk index status (`CorpusEntry['status']`). */
export const CORPUS_STATUS_LABELS: EnumLabelMap = {
  indexed: { en: 'Indexed', sw: 'Imeorodheshwa' },
  're-ingesting': { en: 'Re-ingesting', sw: 'Inapokelewa upya' },
  superseded: { en: 'Superseded', sw: 'Imebadilishwa' },
};

/** A/B experiment status. */
export const EXPERIMENT_STATUS_LABELS: EnumLabelMap = {
  running: { en: 'Running', sw: 'Inaendeshwa' },
  won: { en: 'Won', sw: 'Imeshinda' },
  lost: { en: 'Lost', sw: 'Imeshindwa' },
  promoted: { en: 'Promoted', sw: 'Imepandishwa' },
};

/**
 * Severity scale shared by the compliance queue and support tickets. Carries
 * both the capitalized (`High`) and lowercase (`high`) wire shapes via
 * case-insensitive resolution, plus `critical` (support uses it).
 */
export const SEVERITY_LABELS: EnumLabelMap = {
  critical: { en: 'Critical', sw: 'Hatari' },
  high: { en: 'High', sw: 'Juu' },
  medium: { en: 'Medium', sw: 'Wastani' },
  low: { en: 'Low', sw: 'Chini' },
};

/** Per-junior kill-switch state (`SwitchState`: 'OK' | 'DEGRADED' | 'HALT'). */
export const KILLSWITCH_STATE_LABELS: EnumLabelMap = {
  ok: { en: 'OK', sw: 'Sawa' },
  degraded: { en: 'Degraded', sw: 'Imepunguzwa' },
  halt: { en: 'Halt', sw: 'Imesimamishwa' },
};

/** Junior readiness status (read-only catalog: only 'ready' today). */
export const JUNIOR_STATUS_LABELS: EnumLabelMap = {
  ready: { en: 'Ready', sw: 'Tayari' },
};

/** Provisioned junior-AI lifecycle status. */
export const JUNIOR_AI_STATUS_LABELS: EnumLabelMap = {
  active: { en: 'Active', sw: 'Hai' },
  suspended: { en: 'Suspended', sw: 'Imesimamishwa' },
  revoked: { en: 'Revoked', sw: 'Imebatilishwa' },
};

/** Rollback / promotion artifact kind (`PromotionKind`). */
export const PROMOTION_KIND_LABELS: EnumLabelMap = {
  model: { en: 'Model', sw: 'Modeli' },
  corpus: { en: 'Corpus', sw: 'Kanzidata' },
  prompt: { en: 'Prompt', sw: 'Maagizo' },
};

/** Daily-brief alert kind (open set; known kinds localized, rest humanized). */
export const ALERT_KIND_LABELS: EnumLabelMap = {
  incident: { en: 'Incident', sw: 'Tukio' },
  licence: { en: 'Licence', sw: 'Leseni' },
  license: { en: 'Licence', sw: 'Leseni' },
  royalty: { en: 'Royalty', sw: 'Mrabaha' },
  shipment: { en: 'Shipment', sw: 'Usafirishaji' },
  compliance: { en: 'Compliance', sw: 'Uzingatiaji' },
  treasury: { en: 'Treasury', sw: 'Hazina' },
  workforce: { en: 'Workforce', sw: 'Wafanyakazi' },
};

/** Flow-autonomy posture (`'auto' | 'gated'`). */
export const FLOW_POSTURE_LABELS: EnumLabelMap = {
  auto: { en: 'Auto', sw: 'Otomatiki' },
  gated: { en: 'Gated', sw: 'Yenye lango' },
};

/**
 * Proposal lifecycle status returned by the four-eye approve/decline
 * transition (`Proposal['status']` / the approve|decline result `status`).
 * Known terminal + intermediate states localized; an off-enum future state
 * humanizes locale-neutrally via `localizeEnumLabel`.
 */
export const PROPOSAL_STATUS_LABELS: EnumLabelMap = {
  pending_hitl: { en: 'Pending review', sw: 'Inasubiri ukaguzi' },
  approved: { en: 'Approved', sw: 'Imeidhinishwa' },
  declined: { en: 'Declined', sw: 'Imekataliwa' },
  rejected: { en: 'Rejected', sw: 'Imekataliwa' },
  applied: { en: 'Applied', sw: 'Imetekelezwa' },
  expired: { en: 'Expired', sw: 'Imeisha muda' },
};

/** Decision-trace outcome. */
export const DECISION_OUTCOME_LABELS: EnumLabelMap = {
  approved: { en: 'Approved', sw: 'Imeidhinishwa' },
  executed: { en: 'Executed', sw: 'Imetekelezwa' },
  rejected: { en: 'Rejected', sw: 'Imekataliwa' },
  refused: { en: 'Refused', sw: 'Imekataliwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  allow: { en: 'Allow', sw: 'Ruhusu' },
  deny: { en: 'Deny', sw: 'Kataa' },
  error: { en: 'Error', sw: 'Hitilafu' },
};
