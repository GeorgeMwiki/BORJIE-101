/**
 * superpower-chips — guard-exempt Swahili+English string table for the
 * home-chat `SuperpowerChips` renderer (and its inline `UndoChip`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the superpower chips need (the
 * per-family chip labels, the share-feedback captions, and the undo-chip
 * states) lives here rather than inline in the component — keeping the
 * component source free of hardcoded Swahili tokens while preserving the
 * symmetric `pickByLocale(locale, S.key)` call-site shape.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the component — preserved verbatim.
 */

export const superpowerChipsStrings = {
  undone: { en: 'Undone', sw: 'Imeghairiwa' },
  undo: { en: 'Undo', sw: 'Tendua' },
  undoFailed: { en: 'Undo failed — retry', sw: 'Kutendua kumeshindwa — jaribu tena' },
  open: { en: 'Open', sw: 'Fungua' },
  prefillForm: { en: 'Pre-fill form', sw: 'Jaza fomu' },
  showMe: { en: 'Show me', sw: 'Onyesha kidokezo' },
  linkCopied: { en: 'Link copied', sw: 'Kiungo kmenakiliwa' },
  shareFailed: { en: 'Failed — retry', sw: 'Hitilafu — jaribu tena' },
  generateShareLink: { en: 'Generate share link', sw: 'Tengeneza kiungo' },
  items: { en: 'items', sw: 'vitu' },
  pin: { en: 'Pin', sw: 'Bandika' },
} as const;
