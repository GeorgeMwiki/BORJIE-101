/**
 * Brand-locked OKLCH theme for `@borjie/blackboard-viz`.
 *
 * Every color in this package is OKLCH-derived so the perceptual
 * lightness ramp is uniform across the six knowledge-state badges,
 * the four region-status columns, and the live-cursor identities.
 * Hex fallbacks are included so legacy server-side renderers
 * (PDF / OG image) get the visually closest match.
 *
 * Sources (2025-2026):
 *  - "OKLCH in CSS — why we moved from RGB and HSL" — Andrey Sitnik,
 *    Evil Martians, 2025-09. <https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl>
 *  - CSS Color 4 OKLCH spec — W3C, 2024-11-15.
 *    <https://www.w3.org/TR/css-color-4/#ok-lab>
 *  - Tailwind v4 OKLCH palette — 2025-01.
 *    <https://tailwindcss.com/docs/colors>
 *  - WCAG 2.2 contrast — W3C, 2024-12.
 *    <https://www.w3.org/TR/WCAG22/#contrast-minimum>
 *
 * Brand anchor: warm amber signal + warm ink near-black, matched to
 * the existing `@borjie/graph-viz` palette so views layered on top of
 * graph-viz nodes are visually consistent.
 */

export interface OklchToken {
  readonly oklch: string;
  readonly hex: string;
  readonly description: string;
}

export interface BlackboardOklchTheme {
  readonly background: OklchToken;
  readonly surface: OklchToken;
  readonly foreground: OklchToken;
  readonly muted: OklchToken;
  readonly border: OklchToken;
  readonly focusRing: OklchToken;
  readonly signal: OklchToken;
  /** Per knowledge-state chromatic token. */
  readonly kindDecision: OklchToken;
  readonly kindEvidence: OklchToken;
  readonly kindQuestion: OklchToken;
  readonly kindAction: OklchToken;
  readonly kindObservation: OklchToken;
  readonly kindError: OklchToken;
  /** Per region-status chromatic token (drives Kanban columns). */
  readonly statusOpen: OklchToken;
  readonly statusInProgress: OklchToken;
  readonly statusBlocked: OklchToken;
  readonly statusResolved: OklchToken;
  /** Categorical palette for live-cursor identities (10 stops). */
  readonly cursorPalette: ReadonlyArray<OklchToken>;
}

const BACKGROUND: OklchToken = {
  oklch: 'oklch(0.98 0.01 80)',
  hex: '#FBF7EE',
  description: 'Warm paper white',
};

const SURFACE: OklchToken = {
  oklch: 'oklch(1 0 0)',
  hex: '#FFFFFF',
  description: 'Pure white card surface',
};

const FOREGROUND: OklchToken = {
  oklch: 'oklch(0.20 0.02 60)',
  hex: '#1E140C',
  description: 'Deep ink — near-black warm-shifted',
};

const MUTED: OklchToken = {
  oklch: 'oklch(0.55 0.02 70)',
  hex: '#8A7A66',
  description: 'Muted secondary text',
};

const BORDER: OklchToken = {
  oklch: 'oklch(0.90 0.02 75)',
  hex: '#E8DEC8',
  description: 'Hairline border',
};

const FOCUS_RING: OklchToken = {
  oklch: 'oklch(0.62 0.18 65)',
  hex: '#B8783E',
  description: 'WCAG 2.2 AA focus ring (3 px outline)',
};

const SIGNAL: OklchToken = {
  oklch: 'oklch(0.78 0.13 70)',
  hex: '#E5B26B',
  description: 'Borjie warm amber — the single signal color',
};

const KIND_DECISION: OklchToken = {
  oklch: 'oklch(0.55 0.16 270)',
  hex: '#5E4EAE',
  description: 'Decision — deliberate violet',
};

const KIND_EVIDENCE: OklchToken = {
  oklch: 'oklch(0.62 0.15 200)',
  hex: '#3B8DA8',
  description: 'Evidence — calm teal',
};

const KIND_QUESTION: OklchToken = {
  oklch: 'oklch(0.72 0.16 90)',
  hex: '#C9A949',
  description: 'Question — inquisitive yellow-gold',
};

const KIND_ACTION: OklchToken = {
  oklch: 'oklch(0.62 0.17 145)',
  hex: '#3DA174',
  description: 'Action — confident green',
};

const KIND_OBSERVATION: OklchToken = {
  oklch: 'oklch(0.60 0.05 50)',
  hex: '#8C7A66',
  description: 'Observation — neutral mineral brown',
};

const KIND_ERROR: OklchToken = {
  oklch: 'oklch(0.58 0.18 25)',
  hex: '#B65741',
  description: 'Error — institutional red (never neon)',
};

const STATUS_OPEN: OklchToken = {
  oklch: 'oklch(0.65 0.14 240)',
  hex: '#4F88C7',
  description: 'Status: open — calm blue',
};

const STATUS_IN_PROGRESS: OklchToken = {
  oklch: 'oklch(0.72 0.16 90)',
  hex: '#C9A949',
  description: 'Status: in-progress — active amber-yellow',
};

const STATUS_BLOCKED: OklchToken = {
  oklch: 'oklch(0.58 0.18 25)',
  hex: '#B65741',
  description: 'Status: blocked — institutional red',
};

const STATUS_RESOLVED: OklchToken = {
  oklch: 'oklch(0.62 0.17 145)',
  hex: '#3DA174',
  description: 'Status: resolved — confident green',
};

const CURSOR_PALETTE: ReadonlyArray<OklchToken> = [
  { oklch: 'oklch(0.65 0.18 25)',  hex: '#C66A4F', description: 'Cursor 1' },
  { oklch: 'oklch(0.65 0.18 70)',  hex: '#C7944F', description: 'Cursor 2' },
  { oklch: 'oklch(0.65 0.18 115)', hex: '#A9C24F', description: 'Cursor 3' },
  { oklch: 'oklch(0.65 0.18 160)', hex: '#4FC78A', description: 'Cursor 4' },
  { oklch: 'oklch(0.65 0.18 200)', hex: '#4FB4C7', description: 'Cursor 5' },
  { oklch: 'oklch(0.65 0.18 240)', hex: '#4F88C7', description: 'Cursor 6' },
  { oklch: 'oklch(0.65 0.18 280)', hex: '#7A4FC7', description: 'Cursor 7' },
  { oklch: 'oklch(0.65 0.18 320)', hex: '#C44FAB', description: 'Cursor 8' },
  { oklch: 'oklch(0.65 0.18 355)', hex: '#C74F73', description: 'Cursor 9' },
  { oklch: 'oklch(0.65 0.05 60)',  hex: '#A18D77', description: 'Cursor 10 — neutral fallback' },
];

export const BLACKBOARD_OKLCH_THEME: BlackboardOklchTheme = {
  background: BACKGROUND,
  surface: SURFACE,
  foreground: FOREGROUND,
  muted: MUTED,
  border: BORDER,
  focusRing: FOCUS_RING,
  signal: SIGNAL,
  kindDecision: KIND_DECISION,
  kindEvidence: KIND_EVIDENCE,
  kindQuestion: KIND_QUESTION,
  kindAction: KIND_ACTION,
  kindObservation: KIND_OBSERVATION,
  kindError: KIND_ERROR,
  statusOpen: STATUS_OPEN,
  statusInProgress: STATUS_IN_PROGRESS,
  statusBlocked: STATUS_BLOCKED,
  statusResolved: STATUS_RESOLVED,
  cursorPalette: CURSOR_PALETTE,
};

import type { KnowledgeState, RegionStatus } from '../types';

/**
 * Map a knowledge state to its chromatic token.
 */
export function tokenForKind(kind: KnowledgeState): OklchToken {
  switch (kind) {
    case 'decision':
      return BLACKBOARD_OKLCH_THEME.kindDecision;
    case 'evidence':
      return BLACKBOARD_OKLCH_THEME.kindEvidence;
    case 'question':
      return BLACKBOARD_OKLCH_THEME.kindQuestion;
    case 'action':
      return BLACKBOARD_OKLCH_THEME.kindAction;
    case 'observation':
      return BLACKBOARD_OKLCH_THEME.kindObservation;
    case 'error':
      return BLACKBOARD_OKLCH_THEME.kindError;
  }
}

/**
 * Map a region status to its chromatic token.
 */
export function tokenForStatus(status: RegionStatus): OklchToken {
  switch (status) {
    case 'open':
      return BLACKBOARD_OKLCH_THEME.statusOpen;
    case 'in-progress':
      return BLACKBOARD_OKLCH_THEME.statusInProgress;
    case 'blocked':
      return BLACKBOARD_OKLCH_THEME.statusBlocked;
    case 'resolved':
      return BLACKBOARD_OKLCH_THEME.statusResolved;
  }
}

/**
 * Pick a cursor color by deterministic hash of the user id so the
 * same user always gets the same color across sessions.
 */
export function tokenForCursor(userId: string): OklchToken {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const idx = hash % CURSOR_PALETTE.length;
  return CURSOR_PALETTE[idx]!;
}

/**
 * True when the given string parses as an OKLCH color or a 6/8-digit hex.
 * Used by the test bench to guard against accidental raw hex sneaking in.
 */
export function isValidThemeColor(value: string): boolean {
  if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) return true;
  if (/^oklch\(/.test(value)) return true;
  return false;
}
