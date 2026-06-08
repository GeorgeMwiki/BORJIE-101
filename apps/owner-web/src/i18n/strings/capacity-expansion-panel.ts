/**
 * capacity-expansion-panel — guard-exempt Swahili+English string table for
 * the owner-cockpit capacity-expansion advisor surface
 * (`components/finance/CapacityExpansionPanel.tsx`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the panel needs (field labels,
 * placeholders, table headers, CTA copy, error / empty captions) lives
 * here rather than inline in the component — keeping the panel source free
 * of hardcoded Swahili tokens while preserving the symmetric
 * `isSw ? M.key.sw : M.key.en` call-site shape used across owner-web.
 *
 * SHAPE
 * Flat namespace. Each leaf is `{ sw, en }`. The `en` and `sw` text is
 * preserved verbatim from the original inline copy (not re-translated).
 * Currency-interpolated labels (`upfrontCapexLabel`) are exposed as small
 * functions so the call site keeps its template-literal shape.
 */

export const capacityExpansionPanelStrings = {
  // ── Money / ratio formatters (fallback captions) ────────────────────
  pctNa: { sw: 'haipo', en: 'n/a' },
  paybackBeyond: { sw: 'zaidi ya muda', en: 'beyond horizon' },
  yearAbbr: { sw: 'mwaka', en: 'yr' },

  // ── Global analysis params ──────────────────────────────────────────
  analysisParams: { sw: 'Vigezo vya uchambuzi', en: 'Analysis parameters' },
  currency: { sw: 'Sarafu', en: 'Currency' },
  discountRate: { sw: 'Kiwango cha punguzo (%)', en: 'Discount rate (%)' },

  // ── Scenario drafts ─────────────────────────────────────────────────
  scenario: { sw: 'Hali', en: 'Scenario' },
  remove: { sw: 'Ondoa', en: 'Remove' },
  label: { sw: 'Jina', en: 'Label' },
  labelPlaceholder: { sw: 'mf. Shimo jipya A', en: 'e.g. New shaft A' },
  kind: { sw: 'Aina', en: 'Kind' },
  upfrontCapex: {
    sw: (currency: string) => `Mtaji wa awali (${currency})`,
    en: (currency: string) => `Upfront capex (${currency})`,
  },
  cashflows: {
    sw: 'Mtiririko wa fedha kwa mwaka (tenga kwa koma)',
    en: 'Annual incremental cashflows (comma-separated)',
  },
  tonnesPerYear: { sw: 'Tani kwa mwaka', en: 'Tonnes / year' },

  // ── Actions / validation ────────────────────────────────────────────
  addScenario: { sw: 'Ongeza hali', en: 'Add scenario' },
  analyze: { sw: 'Chambua', en: 'Analyze' },
  enterCapexHint: {
    sw: 'Jaza mtaji na angalau mtiririko mmoja wa fedha.',
    en: 'Enter capex and at least one cashflow.',
  },
  analysisFailed: { sw: 'Uchambuzi umeshindwa.', en: 'Analysis failed.' },

  // ── Outcomes ────────────────────────────────────────────────────────
  outcomesRanked: {
    sw: 'Matokeo (yamepangwa kwa NPV)',
    en: 'Outcomes (ranked by NPV)',
  },
  payback: { sw: 'Marejesho', en: 'Payback' },
  tonnes: { sw: 'Tani', en: 'Tonnes' },
  getRecommendations: { sw: 'Pata mapendekezo', en: 'Get recommendations' },

  // ── Recommendations (evidence-cited) ────────────────────────────────
  recommendations: { sw: 'Mapendekezo', en: 'Recommendations' },
  recommendationsSubtitle: {
    sw: 'Kila pendekezo lina ushahidi kutoka hali husika.',
    en: 'Each recommendation cites the scenario it derives from.',
  },
  noScenarioCleared: {
    sw: 'Hakuna hali iliyovuka kiwango cha sera (NPV ≥ 0, marejesho ≤ miaka 5).',
    en: 'No scenario cleared the policy floor (NPV >= 0, payback <= 5 yrs).',
  },
} as const;
