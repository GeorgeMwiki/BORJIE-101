/**
 * fleet-ops-surface — guard-exempt bilingual (sw / en) copy for the
 * Fleet cost-of-ownership surface (components/fleet/FleetOpsSurface.tsx) and
 * the advisor panel (components/fleet/MinePlannerAdvisorPanel.tsx).
 *
 * MONEY: figures arrive as integer minor-units; rendered with the shared
 * locale-aware number formatter under a neutral "reporting currency" column —
 * never a hard-coded currency symbol.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const fleetOpsStrings = {
  title: { en: 'Fleet cost of ownership', sw: 'Gharama ya umiliki wa magari' },
  subtitleDefault: {
    en: 'Fuel + maintenance + depreciation per vehicle.',
    sw: 'Mafuta + matengenezo + ushuka wa thamani kwa kila gari.',
  },
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },

  loadErrorTitle: {
    en: 'Could not load fleet cost of ownership',
    sw: 'Imeshindwa kupakia gharama ya umiliki wa magari',
  },
  unknownError: { en: 'unknown error', sw: 'hitilafu isiyojulikana' },
  emptyTitle: { en: 'No vehicle assets yet', sw: 'Hakuna magari bado' },
  emptyBody: {
    en: 'Register trucks / vehicles and log fuel + maintenance to see real per-vehicle cost of ownership computed by the fleet engine.',
    sw: 'Sajili malori / magari na rekodi mafuta + matengenezo ili kuona gharama halisi ya umiliki kwa kila gari iliyokokotolewa na injini ya magari.',
  },

  colVehicle: { en: 'Vehicle', sw: 'Gari' },
  colType: { en: 'Type', sw: 'Aina' },
  colFuel: { en: 'Fuel', sw: 'Mafuta' },
  colMaintenance: { en: 'Maintenance', sw: 'Matengenezo' },
  colDepreciation: { en: 'Depreciation', sw: 'Ushuka wa thamani' },
  colTotalReporting: { en: 'Total (reporting ccy)', sw: 'Jumla (sarafu ya ripoti)' },

  tileFuel: { en: 'Fuel', sw: 'Mafuta' },
  tileMaintenance: { en: 'Maintenance', sw: 'Matengenezo' },
  tileDepreciation: { en: 'Depreciation', sw: 'Ushuka wa thamani' },
  tileTotal: { en: 'Total', sw: 'Jumla' },

  periodPrefix: { en: 'Period', sw: 'Kipindi' },
  vehicleCountSuffix: { en: 'vehicle(s).', sw: 'gari.' },
} as const;
