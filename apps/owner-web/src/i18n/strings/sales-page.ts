/**
 * sales-page — guard-exempt bilingual (sw / en) copy for the owner sales
 * & pipeline route (`sales/page.tsx`), which previously rendered entirely
 * in hardcoded English under the localized cockpit chrome (the
 * split-brain class). Lives under `i18n/` so the locale-purity scanner
 * exempts the Swahili.
 */

export const salesPageStrings = {
  eyebrow: { en: 'Sales · Pipeline', sw: 'Mauzo · Mtiririko' },
  title: { en: 'Sales & pipeline', sw: 'Mauzo & mtiririko' },
  subtitle: {
    en: 'Ore parcel sales, net-price comparison, and payment trace.',
    sw: 'Mauzo ya vifurushi vya madini, ulinganisho wa bei halisi, na ufuatiliaji wa malipo.',
  },
  fxTreasuryCta: { en: 'FX & treasury', sw: 'Sarafu & hazina' },
  askCta: { en: 'Ask Mr. Mwikila', sw: 'Uliza Mr. Mwikila' },
  loading: { en: 'Loading sales data…', sw: 'Inapakia data ya mauzo…' },
  loadFailed: {
    en: 'Could not load sales data.',
    sw: 'Imeshindwa kupakia data ya mauzo.',
  },

  // KPI strip
  totalSalesLabel: { en: 'Total sales', sw: 'Jumla ya mauzo' },
  totalSalesSub: { en: 'Ore parcel transactions', sw: 'Miamala ya vifurushi vya madini' },
  grossLabel: (currency: string) => ({
    en: `Gross (${currency})`,
    sw: `Jumla (${currency})`,
  }),
  grossSub: { en: 'Sum of gross prices', sw: 'Jumla ya bei ghafi' },
  netLabel: (currency: string) => ({
    en: `Net revenue (${currency})`,
    sw: `Mapato halisi (${currency})`,
  }),
  netSub: { en: 'After royalty + levies', sw: 'Baada ya mrabaha + tozo' },
  pendingLabel: { en: 'Pending payment', sw: 'Malipo yanayosubiri' },
  pendingSub: { en: 'Awaiting settlement', sw: 'Yanasubiri malipo' },

  // Empty state
  emptyTitle: { en: 'No sales recorded yet', sw: 'Hakuna mauzo yaliyorekodiwa bado' },
  emptyBody: {
    en: 'Sales appear here once the first ore parcel is sold. Use the marketplace to connect with buyers.',
    sw: 'Mauzo yataonekana hapa mara kifurushi cha kwanza cha madini kinapouzwa. Tumia soko kuungana na wanunuzi.',
  },
  openMarketplace: { en: 'Open marketplace', sw: 'Fungua soko' },

  // Table
  allTransactions: { en: 'All transactions', sw: 'Miamala yote' },
  colDate: { en: 'Date', sw: 'Tarehe' },
  colParcel: { en: 'Parcel', sw: 'Kifurushi' },
  colRoute: { en: 'Route', sw: 'Njia' },
  colGross: (currency: string) => ({
    en: `Gross (${currency})`,
    sw: `Jumla (${currency})`,
  }),
  colNet: (currency: string) => ({
    en: `Net (${currency})`,
    sw: `Halisi (${currency})`,
  }),
  colStatus: { en: 'Status', sw: 'Hali' },
  buyerPrefix: { en: 'buyer', sw: 'mnunuzi' },
} as const;
