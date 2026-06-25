/**
 * advisor-enum-labels — guard-exempt bilingual (sw / en) vocabulary for the
 * non-owner-os ADVISOR surfaces' DB enum tokens (treasury advisor, fleet
 * ops). This is the Stream-A sibling of `owner-os-panels.ts → enumLabels`,
 * kept in its OWN namespace module so the two review streams never collide
 * on a single bundle file.
 *
 * WHY THIS FILE EXISTS (raw-enum-render class, language-engineering canon)
 * A panel cell that renders a DB enum token verbatim — `{rec.kind}`,
 * `{r.type}` — prints the raw `snake_case` / `kebab-case` code
 * (`usd-cliff-remediation`, `truck`). The source-literal locale scanner
 * can never see it (the string arrives at runtime off the wire), yet it
 * leaks English under `sw`. Every such token resolves through
 * `advisorEnumLabel(domain, token, locale)` instead, which maps it to a
 * single-language label here.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 * The contract test (`__tests__/advisor-enum-label-contract.test.ts`) pins
 * each vocabulary to its server source of truth, so a server-side enum
 * change forces a label here before the build is green.
 *
 * SHAPE — `Record<domain, Record<token, { en; sw }>>`.
 */

export const advisorEnumLabels = {
  // packages/fx-treasury-advisor types.ts → treasuryRecommendationKindSchema.
  // The owner treasury surface renders `rec.kind`.
  treasuryRecKind: {
    'sell-stockpile': {
      en: 'Sell stockpile',
      sw: 'Uza akiba ya madini',
    },
    'partial-fx-hedge': {
      en: 'Partial FX hedge',
      sw: 'Kinga ya sehemu ya sarafu',
    },
    'delay-capex': {
      en: 'Delay capital spend',
      sw: 'Ahirisha matumizi ya mtaji',
    },
    'accelerate-receivable': {
      en: 'Accelerate receivable',
      sw: 'Harakisha malimbikizo ya kupokea',
    },
    'usd-cliff-remediation': {
      en: 'USD-cliff remediation',
      sw: 'Urekebishaji wa mteremko wa USD',
    },
    'rebalance-account': {
      en: 'Rebalance account',
      sw: 'Sawazisha akaunti',
    },
  },

  // packages/fleet-management types.ts → VEHICLE_TYPES. The fleet-ops TCO
  // surface renders `r.type` (a free-text `z.string()` off the wire whose
  // value is one of these VehicleType codes; an unknown code humanises).
  fleetVehicleType: {
    sedan: { en: 'Sedan', sw: 'Gari la kawaida' },
    suv: { en: 'SUV', sw: 'Gari kubwa la barabarani' },
    pickup: { en: 'Pickup', sw: 'Pikipiki ya mizigo' },
    van: { en: 'Van', sw: 'Vani' },
    truck: { en: 'Truck', sw: 'Lori' },
    motorcycle: { en: 'Motorcycle', sw: 'Pikipiki' },
    scooter: { en: 'Scooter', sw: 'Skuta' },
  },
} as const;
