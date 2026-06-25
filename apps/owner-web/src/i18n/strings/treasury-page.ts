/**
 * treasury-page — guard-exempt bilingual (sw / en) copy for the owner
 * treasury route surfaces: the page hero CTAs (`treasury/page.tsx`), the
 * FX chart (`FxChart.tsx`), the sell-vs-stockpile simulator
 * (`SellSimulator.tsx`), and the USD-cliff banner (`CliffBanner.tsx`).
 *
 * The locale-purity scanner exempts everything under `i18n/`, so every
 * Swahili literal these components need lives here rather than inline —
 * keeping the component source free of hardcoded Swahili tokens while the
 * rendered copy stays single-language-per-locale (the no-mixing canon).
 *
 * Shape: namespaced by source file, each leaf `{ en, sw }` (or a pure
 * function returning `{ en, sw }` when the original interpolated a value).
 */

export const treasuryPageStrings = {
  // ── treasury/page.tsx hero CTAs ───────────────────────────────────
  hero: {
    placeSellOrder: { en: 'Place sell order', sw: 'Tengeneza oda ya kuuza' },
    askHedging: { en: 'Ask about hedging', sw: 'Uliza kuhusu hedging' },
  },

  // ── FxChart.tsx ───────────────────────────────────────────────────
  fx: {
    sectionTitle: { en: 'Live FX and gold', sw: 'Sarafu na dhahabu (moja kwa moja)' },
    loading: { en: 'Loading rates…', sw: 'Inapakia viwango…' },
    feedWarming: { en: 'FX feed warming up', sw: 'Mlisho wa sarafu unaanza' },
    noRates: { en: 'No rates yet', sw: 'Hakuna viwango bado' },
    feedHint: {
      en: 'The fx-feed worker writes a row every 5 minutes; the first rates appear shortly after process boot.',
      sw: 'Mfanyakazi wa mlisho wa sarafu huandika kila dakika 5; viwango vya kwanza huonekana muda mfupi baada ya kuanza.',
    },
    updatedAt: (time: string) => ({
      en: `updated ${time}`,
      sw: `imesasishwa ${time}`,
    }),
    sparklineLabel: {
      en: 'TZS / USD - last 60 ticks',
      sw: 'TZS / USD - alama 60 za mwisho',
    },
  },

  // ── SellSimulator.tsx ─────────────────────────────────────────────
  sim: {
    title: {
      en: 'Sell-now vs stockpile simulator',
      sw: 'Kiigaji cha kuuza sasa dhidi ya kuhifadhi',
    },
    goldAssumption: (price: number) => ({
      en: `Gold price assumption USD/oz · ${price}`,
      sw: `Dhana ya bei ya dhahabu USD/oz · ${price}`,
    }),
    tzsUsd: (rate: number) => ({
      en: `TZS/USD · ${rate}`,
      sw: `TZS/USD · ${rate}`,
    }),
    grammes: (g: number) => ({
      en: `Grammes available · ${g}`,
      sw: `Gramu zinazopatikana · ${g}`,
    }),
    holdWindow: (days: number) => ({
      en: `Hold window (days) · ${days}`,
      sw: `Dirisha la kuhifadhi (siku) · ${days}`,
    }),
    netNow: { en: 'Net now', sw: 'Halisi sasa' },
    netHoldExpected: (days: number) => ({
      en: `Net hold ${days}d (expected)`,
      sw: `Halisi baada ya siku ${days} (inayotarajiwa)`,
    }),
    lowBand: { en: 'Low band', sw: 'Kiwango cha chini' },
    highBand: { en: 'High band', sw: 'Kiwango cha juu' },
    recommendation: { en: 'Recommendation', sw: 'Pendekezo' },
    recoSellNow: { en: 'sell now', sw: 'uza sasa' },
    recoHold: { en: 'hold', sw: 'hifadhi' },
    recoNeutral: { en: 'neutral', sw: 'wastani' },
  },

  // ── CliffBanner.tsx (compliance / legal copy — do NOT truncate) ────
  cliff: {
    unavailableTitle: {
      en: '27-Mar-2026 BoT cliff status unavailable',
      sw: 'Hali ya kikomo cha BoT cha 27-Mac-2026 haipatikani',
    },
    unavailableBody: {
      en: 'The cliff-status endpoint is unreachable. Sign in or retry to load the live USD exposure rollup.',
      sw: 'Mwisho wa hali ya kikomo haufikiki. Ingia au jaribu tena ili kupakia muhtasari wa moja kwa moja wa hatari ya USD.',
    },
    passedTitle: (weeks: number) => ({
      en: `27-Mar-2026 BoT cliff passed by ${weeks} weeks`,
      sw: `Kikomo cha BoT cha 27-Mac-2026 kimepita kwa wiki ${weeks}`,
    }),
    detail: (args: {
      cliffDate: string;
      postCliffSales: number;
      usdDenominated: number;
    }) => ({
      en: `Cliff date ${args.cliffDate}. Post-cliff sales ${args.postCliffSales}; USD denominated ${args.usdDenominated}.`,
      sw: `Tarehe ya kikomo ${args.cliffDate}. Mauzo baada ya kikomo ${args.postCliffSales}; yaliyopimwa kwa USD ${args.usdDenominated}.`,
    }),
    facilityNotification: { en: 'Facility notification', sw: 'Taarifa ya kituo' },
    statusSent: { en: 'sent', sw: 'imetumwa' },
    statusPending: { en: 'pending', sw: 'inasubiri' },
    remediation: {
      en: 'Remediation: file BoT exemption pack, restructure outstanding USD invoices into TZS where possible, log every conversion for audit.',
      sw: 'Urekebishaji: wasilisha kifurushi cha msamaha cha BoT, panga upya ankara za USD zilizosalia kuwa TZS pale inapowezekana, andika kila ubadilishaji kwa ukaguzi.',
    },
  },
} as const;
