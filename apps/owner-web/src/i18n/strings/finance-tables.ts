/**
 * finance-tables — guard-exempt bilingual (sw / en) copy for the owner
 * finance + site-cockpit money tables that previously rendered hardcoded
 * English under the localized cockpit chrome (the split-brain class).
 *
 * Covered surfaces: PnlTable, BreakEvenSlider, CostTable,
 * PaymentHistory, CashRunwayCard. Every leaf is `{ en, sw }` (or a pure
 * function returning `{ en, sw }` when the original interpolated a value).
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const financeTablesStrings = {
  // ── components/finance/PnlTable.tsx ───────────────────────────────
  pnl: {
    title: (currency: string) => ({
      en: `Monthly P&L · ${currency} millions`,
      sw: `P&L ya mwezi · ${currency} milioni`,
    }),
    ebitda: { en: 'EBITDA', sw: 'EBITDA' },
    subtotal: { en: 'subtotal', sw: 'jumla ndogo' },
    groupRevenue: { en: 'Revenue', sw: 'Mapato' },
    groupCogs: { en: 'Cost of sales', sw: 'Gharama ya mauzo' },
    groupOpex: { en: 'Operating expense', sw: 'Gharama za uendeshaji' },
    groupOther: { en: 'Other', sw: 'Nyingine' },
  },

  // ── components/finance/BreakEvenSlider.tsx ────────────────────────
  breakEven: {
    title: (currency: string) => ({
      en: `Break-even sensitivity · ${currency} / g`,
      sw: `Usikivu wa kufikia kizingiti · ${currency} / g`,
    }),
    goldPrice: (price: number) => ({
      en: `Gold price USD/oz · ${price}`,
      sw: `Bei ya dhahabu USD/oz · ${price}`,
    }),
    tzsUsd: (rate: number) => ({
      en: `TZS/USD · ${rate}`,
      sw: `TZS/USD · ${rate}`,
    }),
    unitCost: (cost: string, currency: string) => ({
      en: `Unit all-in cost ${currency}/g · ${cost}`,
      sw: `Gharama kamili kwa kipimo ${currency}/g · ${cost}`,
    }),
    netMargin: (value: string) => ({
      en: `Net margin: ${value} / g`,
      sw: `Faida halisi: ${value} / g`,
    }),
  },

  // ── components/site-cockpit/CostTable.tsx ─────────────────────────
  cost: {
    title: (currency: string) => ({
      en: `Unit economics · ${currency} / g`,
      sw: `Uchumi wa kipimo · ${currency} / g`,
    }),
    colLine: { en: 'Line', sw: 'Kipengele' },
    colPerGramme: (currency: string) => ({
      en: `${currency} / g`,
      sw: `${currency} / g`,
    }),
    colPercent: { en: '% of total', sw: '% ya jumla' },
    colTrend: { en: 'Trend', sw: 'Mwelekeo' },
    allInCost: { en: 'All-in cost', sw: 'Gharama kamili' },
    catExtraction: { en: 'Extraction', sw: 'Uchimbaji' },
    catProcessing: { en: 'Processing', sw: 'Usindikaji' },
    catRoyalty: { en: 'Royalty (6%)', sw: 'Mrabaha (6%)' },
    catTreasury: { en: 'Treasury haircut', sw: 'Punguzo la hazina' },
    catCsr: { en: 'CSR', sw: 'CSR' },
    catOverhead: { en: 'Overhead', sw: 'Gharama za jumla' },
  },

  // ── components/licence/PaymentHistory.tsx ─────────────────────────
  payments: {
    title: {
      en: 'Payment history · obligations vs payments',
      sw: 'Historia ya malipo · majukumu dhidi ya malipo',
    },
    colDate: { en: 'Date', sw: 'Tarehe' },
    colDescription: { en: 'Description', sw: 'Maelezo' },
    colAmount: { en: 'Amount', sw: 'Kiasi' },
    colStatus: { en: 'Status', sw: 'Hali' },
    status: {
      paid: { en: 'Paid', sw: 'Imelipwa' },
      due: { en: 'Due', sw: 'Inadaiwa' },
      overdue: { en: 'Overdue', sw: 'Imechelewa' },
    },
  },

  // ── components/cockpit/CashRunwayCard.tsx (cockpit summary card) ──
  cockpitCash: {
    title: { en: 'Cash & runway', sw: 'Fedha & muda uliobaki' },
    daysRunway: (days: number) => ({
      en: `${days} days runway`,
      sw: `siku ${days} za muda`,
    }),
    burnPerDay: (value: string) => ({
      en: `Burn ~ ${value} / day`,
      sw: `Matumizi ~ ${value} / siku`,
    }),
  },

  // ── components/dashboard/CashRunwayCard.tsx ───────────────────────
  cashRunway: {
    title: { en: 'Cash & USD cliff', sw: 'Fedha & kikomo cha USD' },
    netDays: (samples: number) => ({
      en: `90-day net · ${samples} sales sampled`,
      sw: `Halisi ya siku 90 · sampuli za mauzo ${samples}`,
    }),
    runwayUnknown: { en: 'runway unknown', sw: 'muda haujulikani' },
    daysRunway: (days: number) => ({
      en: `${days} days runway`,
      sw: `siku ${days} za muda`,
    }),
    postureLabel: { en: 'Post-cliff posture', sw: 'Hali baada ya kikomo' },
    remediationComplete: {
      en: 'remediation complete',
      sw: 'urekebishaji umekamilika',
    },
    usdContracts: (count: number) => ({
      en: `${count} USD contracts`,
      sw: `mikataba ${count} ya USD`,
    }),
    cliffIn: (days: number) => ({
      en: `cliff in ${days}d`,
      sw: `kikomo baada ya siku ${days}`,
    }),
    cliffPast: (days: number) => ({
      en: `${days}d past`,
      sw: `siku ${days} zilizopita`,
    }),
    postCliffSales: (count: number) => ({
      en: `${count} post-cliff sales recorded`,
      sw: `mauzo ${count} baada ya kikomo yameandikwa`,
    }),
  },
} as const;
