/**
 * Bilingual sw/en string dictionary for the FloatingAskBorjie widget.
 *
 * Every visible string in the floating bubble, chat panel, composer, or
 * footer must come through this module — no hardcoded English in the
 * JSX. Mirrors LitFin's `WIDGET_TEXT` pattern but kept self-contained
 * to honour the chat-ui package boundary (no @borjie/i18n import).
 *
 * Order conventions: keep keys alphabetical inside their section so the
 * diff stays readable when copy is tuned. Strings are short, sentence-
 * case, and avoid em-dashes (use a period + capital instead — same
 * brand rule LitFin enforces server-side).
 */
import type { BorjieLanguage } from './useBorjieChat';

/** Bilingual string pair. Both keys are always populated; we never fall
 *  back across languages because the UI is bilingual-strict (the brain
 *  itself responds in the user's chosen language). */
export interface BilingualString {
  readonly en: string;
  readonly sw: string;
}

/** Translate a bilingual entry against the active widget language. Tiny
 *  helper so call-sites stay terse: `t(MESSAGES.send, language)`. */
export function t(entry: BilingualString, language: BorjieLanguage): string {
  return entry[language];
}

/**
 * Every visible string in the widget. Group by surface: brand → header
 * → empty state → suggestion-chip prompts → composer → footer → a11y.
 */
export const MESSAGES = {
  // ── Brand ──────────────────────────────────────────────────────────
  brandLine: {
    en: 'Borjie',
    sw: 'Borjie',
  },
  brandTagline: {
    en: 'AI Mining Managing Director',
    sw: 'Meneja wa AI wa Shughuli za Mgodi',
  },

  // ── Tooltip + nudge (FAB) ──────────────────────────────────────────
  tooltipFirstVisit: {
    en: 'Tap to talk to Mr. Mwikila',
    sw: 'Bofya kuongea na Mr. Mwikila',
  },
  ambientNudge: {
    en: 'Chat',
    sw: 'Ongea',
  },
  ariaOpen: {
    en: 'Open Borjie chat',
    sw: 'Fungua mazungumzo ya Borjie',
  },
  ariaClose: {
    en: 'Close chat',
    sw: 'Funga mazungumzo',
  },

  // ── Header ─────────────────────────────────────────────────────────
  switchLanguage: {
    en: 'Switch language',
    sw: 'Badilisha lugha',
  },
  newConversation: {
    en: 'New conversation',
    sw: 'Mazungumzo mapya',
  },
  minimize: {
    en: 'Minimize',
    sw: 'Punguza',
  },
  contextDiscussing: {
    en: 'Discussing',
    sw: 'Kuhusu',
  },

  // ── Empty state (welcome) ──────────────────────────────────────────
  welcomeTitle: {
    en: "Hi, I'm Mr. Mwikila.",
    sw: 'Habari, mimi ni Bw. Mwikila.',
  },
  welcomeBody: {
    en: 'Ask me about royalty filing, licence calendars, mineral processing, or what the pilot looks like. Pick a starting question or just type.',
    sw: 'Niulize kuhusu kulipa mrabaha, kalenda ya leseni, usindikaji wa madini, au jinsi majaribio ya programu yanavyofanya kazi. Chagua swali la kuanzia au andika tu.',
  },

  // ── Suggestion chips (5, English-first per spec) ──────────────────
  chipRoyalty: {
    en: 'How does royalty filing work?',
    sw: 'Kulipa mrabaha hufanyikaje?',
  },
  chipMererani: {
    en: 'I mine tanzanite in Mererani',
    sw: 'Nachimba tanzanite Mererani',
  },
  chipPilot: {
    en: 'What does the pilot cost?',
    sw: 'Majaribio yanagharimu kiasi gani?',
  },
  chipLicence: {
    en: 'Show me the licence calendar',
    sw: 'Nionyeshe kalenda ya leseni',
  },
  chipHuman: {
    en: 'Talk to a human',
    sw: 'Ongea na binadamu',
  },

  // ── Composer ──────────────────────────────────────────────────────
  placeholder: {
    en: 'Ask Mr. Mwikila anything…',
    sw: 'Uliza Bw. Mwikila chochote…',
  },
  send: {
    en: 'Send',
    sw: 'Tuma',
  },
  thinking: {
    en: 'Thinking',
    sw: 'Nafikiri',
  },

  // ── Sign-in (authenticated variant) ───────────────────────────────
  signInPrompt: {
    en: 'Sign in to talk to Borjie.',
    sw: 'Ingia ili kuongea na Borjie.',
  },
  signInCta: {
    en: 'Sign in',
    sw: 'Ingia',
  },

  // ── Footer ────────────────────────────────────────────────────────
  // 3-segment LitFin-parity micro-copy. Single line, 11px, muted.
  // The hash-chain segment cites the immutable AI audit chain that
  // the Auditor Agent appends to every junior response.
  footerAttribution: {
    en: 'Powered by Borjie  •  Tanzania-region storage  •  Hash-chain audited',
    sw: 'Inaendeshwa na Borjie  •  Imehifadhiwa Tanzania  •  Ukaguzi wa mlolongo',
  },

  // ── Errors ────────────────────────────────────────────────────────
  errorGeneric: {
    en: 'Sorry, something went wrong on the wire. Please try again.',
    sw: 'Samahani, kuna tatizo kwenye mtandao. Jaribu tena.',
  },

  // ── Relative time labels (mirror LitFin "Just now / 2m ago") ─────
  relativeJustNow: {
    en: 'Just now',
    sw: 'Sasa hivi',
  },
  relativeMinutesAgo: {
    en: '{n}m ago',
    sw: 'Dakika {n}',
  },
  relativeHoursAgo: {
    en: '{n}h ago',
    sw: 'Saa {n}',
  },
  relativeYesterday: {
    en: 'Yesterday',
    sw: 'Jana',
  },
  relativeEarlierToday: {
    en: 'Earlier today',
    sw: 'Mapema leo',
  },

  // ── Speaker / TTS controls (LitFin Volume2 parity) ───────────────
  listenAloud: {
    en: 'Listen aloud',
    sw: 'Sikiliza kwa sauti',
  },
  stopListening: {
    en: 'Stop listening',
    sw: 'Acha kusikiliza',
  },
  speechUnsupported: {
    en: 'Speech not supported in this browser',
    sw: 'Hii kivinjari hakitumii sauti',
  },
} as const satisfies Readonly<Record<string, BilingualString>>;

/** Friendly label for the context pill given a recently-cited evidence
 *  id. Drives the header pill: e.g. cite `borjie:licences` →
 *  "Discussing licences". Always returns a bilingual pair so call-sites
 *  can translate. Returns null when the evidence id has no known label
 *  — the pill is then hidden. */
export function evidenceContextLabel(
  evidenceId: string,
): BilingualString | null {
  // Strip the `borjie:` / `corpus:` prefix if present; we only care
  // about the trailing topic id.
  const topic = evidenceId.includes(':') ? evidenceId.split(':').pop() ?? evidenceId : evidenceId;
  const key = topic.toLowerCase().trim();
  const label = CONTEXT_TOPIC_LABELS[key];
  return label ?? null;
}

/** Topic dictionary for the in-header "Discussing X" pill. Keep this
 *  list short — it's a discovery aid for the user, not an exhaustive
 *  taxonomy. Unknown evidence ids hide the pill rather than show a raw
 *  slug. */
const CONTEXT_TOPIC_LABELS: Readonly<Record<string, BilingualString>> = {
  licences: { en: 'licences', sw: 'leseni' },
  licence: { en: 'licences', sw: 'leseni' },
  licensing: { en: 'licences', sw: 'leseni' },
  royalty: { en: 'royalty filing', sw: 'kulipa mrabaha' },
  royalties: { en: 'royalty filing', sw: 'kulipa mrabaha' },
  pml: { en: 'PML licences', sw: 'leseni za PML' },
  pilot: { en: 'the pilot', sw: 'majaribio' },
  mererani: { en: 'Mererani tanzanite', sw: 'tanzanite ya Mererani' },
  tanzanite: { en: 'tanzanite', sw: 'tanzanite' },
  fx: { en: 'FX exposure', sw: 'hatari ya kubadilisha sarafu' },
  mining: { en: 'mining operations', sw: 'shughuli za mgodi' },
  processing: { en: 'mineral processing', sw: 'usindikaji wa madini' },
  compliance: { en: 'compliance', sw: 'kanuni' },
  finance: { en: 'finance', sw: 'fedha' },
  ore: { en: 'ore parcels', sw: 'vifurushi vya madini' },
};

/** Convenience: ordered list of suggestion-chip prompts for the empty
 *  state. The first 5 (per spec) are the marketing-page starter
 *  questions; the order is deliberate (royalty → site → pricing →
 *  licence → human) so the user's eye walks the funnel naturally. */
export interface SuggestionChip {
  readonly id: string;
  readonly label: BilingualString;
  /** The full prompt sent to the brain when clicked. May differ from
   *  the chip label (we expand short chips into self-contained
   *  questions so the model gets context). */
  readonly prompt: BilingualString;
}

export const SUGGESTION_CHIPS: readonly SuggestionChip[] = [
  {
    id: 'royalty',
    label: MESSAGES.chipRoyalty,
    prompt: {
      en: 'How does royalty filing work in Tanzania for an artisanal miner?',
      sw: 'Kulipa mrabaha Tanzania hufanyikaje kwa mchimbaji mdogo?',
    },
  },
  {
    id: 'mererani',
    label: MESSAGES.chipMererani,
    prompt: {
      en: 'I mine tanzanite in Mererani. How would Borjie help me run the site?',
      sw: 'Nachimba tanzanite Mererani. Borjie itanisaidiaje kuendesha mgodi?',
    },
  },
  {
    id: 'pilot',
    label: MESSAGES.chipPilot,
    prompt: {
      en: 'What does the Borjie pilot programme cost and what is included?',
      sw: 'Mpango wa majaribio wa Borjie unagharimu kiasi gani na unajumuisha nini?',
    },
  },
  {
    id: 'licence',
    label: MESSAGES.chipLicence,
    prompt: {
      en: 'Show me what the licence renewal calendar looks like for a typical PML holder.',
      sw: 'Nionyeshe kalenda ya kuongeza leseni inavyoonekana kwa mwenye PML wa kawaida.',
    },
  },
  {
    id: 'human',
    label: MESSAGES.chipHuman,
    prompt: {
      en: 'I would like to talk to a human at Borjie. How do I book a call?',
      sw: 'Ningependa kuongea na mtu wa Borjie. Niwezeje kupanga simu?',
    },
  },
];
