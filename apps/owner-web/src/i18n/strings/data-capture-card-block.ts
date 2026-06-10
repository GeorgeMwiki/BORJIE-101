/**
 * data-capture-card-block — guard-exempt Swahili+English string table for
 * the home-chat inline `DataCaptureCardBlock`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the data-capture card needs (the
 * picker placeholders + badge labels, the section caption, the select
 * empty option, and the submit CTA) lives here rather than inline in the
 * component — keeping the component source free of hardcoded Swahili
 * tokens while preserving the symmetric `pickByLocale(locale, S.key)`
 * call-site shape.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`. The EN and SW text is the
 * exact copy previously inlined in the component — preserved verbatim.
 */

export const dataCaptureCardBlockStrings = {
  pmlPickerPlaceholder: {
    en: 'Enter PML licence ID (e.g. PML-2024-001)',
    sw: 'Ingiza namba ya leseni ya PML (mfano: PML-2024-001)',
  },
  sitePickerPlaceholder: {
    en: 'Enter mining site name or ID',
    sw: 'Ingiza jina au namba ya eneo la uchimbaji',
  },
  pmlPickerKindLabel: { en: 'PML Licence', sw: 'Leseni ya PML' },
  sitePickerKindLabel: { en: 'Mining Site', sw: 'Eneo la Uchimbaji' },
  quickCapture: { en: 'Quick capture', sw: 'Kukusanya' },
  select: { en: 'Select', sw: 'Chagua' },
  send: { en: 'Send', sw: 'Tuma' },
} as const;
