/**
 * fleet-maintenance-page — guard-exempt bilingual (sw / en) copy for the
 * Fleet → Maintenance screen and its surfaces:
 *   - app/(routes)/fleet/maintenance/page.tsx
 *   - components/fleet/FleetMaintenanceSurface.tsx
 *   - components/fleet/MaintenanceTable.tsx
 *   - components/fleet/NewMaintenanceModal.tsx
 *
 * Replaces the canon-violating `.both` ("EN / SW" concatenated) entries that
 * used to live in routes-a.ts and the inline `S.x.en / S.x.sw` mixing the
 * table/modal rendered. Each entry is a strict `{ en, sw }` pair resolved with
 * `pickByLocale(locale, …)` — never concatenated.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const fleetMaintenanceStrings = {
  // ── page header ────────────────────────────────────────────────────
  eyebrow: { en: 'O-W-09 · maintenance', sw: 'O-W-09 · matengenezo' },
  title: { en: 'Fleet maintenance', sw: 'Matengenezo ya magari' },
  subhead: {
    en: 'Asset health across your operation',
    sw: 'Afya ya mali katika operesheni yako',
  },
  intro: {
    en: 'Last 30 days of maintenance events grouped by asset. Predictive flags surface due-soon and overdue services.',
    sw: 'Matengenezo ya siku 30 zilizopita kwa kila mali. Vidokezo vya utabiri vinaonyesha huduma zinazokaribia na zilizochelewa.',
  },
  recentEventsTitle: { en: 'Recent events', sw: 'Matukio ya hivi karibuni' },
  recentEventsSubtitle: {
    en: 'Live maintenance events grouped by asset, with predictive due-soon / overdue flags.',
    sw: 'Matukio hai ya matengenezo yaliyopangwa kwa mali, yenye vidokezo vya utabiri vya kukaribia / kuchelewa.',
  },
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },
  newMaintenanceCta: { en: 'Open new maintenance', sw: 'Anza matengenezo' },

  // ── loading / empty / error ────────────────────────────────────────
  loadErrorTitle: { en: 'Could not load maintenance', sw: 'Imeshindwa kupakia matengenezo' },
  emptyTitle: { en: 'No maintenance events yet', sw: 'Hakuna matengenezo bado' },
  emptyBody: {
    en: 'Recorded maintenance for your assets will appear here, grouped by unit with predictive service flags.',
    sw: 'Matengenezo yaliyorekodiwa kwa mali zako yataonekana hapa, yamepangwa kwa kifaa yenye vidokezo vya huduma vya utabiri.',
  },

  // ── surface (FleetMaintenanceSurface) ──────────────────────────────
  surfaceTitle: { en: 'Asset maintenance, last 30 days', sw: 'Matengenezo ya mali, siku 30 zilizopita' },
  surfaceSubtitle: {
    en: 'Live maintenance events grouped by asset, with predictive due-soon / overdue flags.',
    sw: 'Matukio hai ya matengenezo yaliyopangwa kwa mali, yenye vidokezo vya utabiri vya kukaribia / kuchelewa.',
  },

  // ── table columns ──────────────────────────────────────────────────
  colAsset: { en: 'Asset', sw: 'Mali' },
  colKind: { en: 'Kind', sw: 'Aina' },
  colStarted: { en: 'Started', sw: 'Imeanza' },
  colDuration: { en: 'Duration', sw: 'Muda' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colCost: { en: 'Cost', sw: 'Gharama' },
  colPredictive: { en: 'Predictive', sw: 'Utabiri' },

  flagOverdue: { en: 'overdue', sw: 'imechelewa' },
  flagDueSoon: { en: 'due soon', sw: 'hivi karibuni' },
  eventCountOne: { en: 'event', sw: 'tukio' },
  eventCountMany: { en: 'events', sw: 'matukio' },

  // ── kind enum (closed gateway vocabulary; rendered in the Kind column) ─
  kindScheduledService: { en: 'Scheduled service', sw: 'Huduma iliyopangwa' },
  kindRepair: { en: 'Repair', sw: 'Marekebisho' },
  kindInspectionEnum: { en: 'Inspection', sw: 'Ukaguzi' },
  kindUnknown: { en: 'Other', sw: 'Nyingine' },

  // ── status enum (closed; rendered in the Status pill) ──────────────
  statusOpen: { en: 'Open', sw: 'Wazi' },
  statusInProgress: { en: 'In progress', sw: 'Inaendelea' },
  statusCompleted: { en: 'Completed', sw: 'Imekamilika' },
  statusCancelled: { en: 'Cancelled', sw: 'Imeghairiwa' },
  tableEmpty: {
    en: 'No maintenance events in the last 30 days.',
    sw: 'Hakuna matengenezo siku 30 zilizopita.',
  },

  // ── new maintenance modal ──────────────────────────────────────────
  modalTitle: { en: 'Open new maintenance', sw: 'Anza matengenezo' },
  modalSubtitle: {
    en: 'Record a new maintenance event for one of your assets.',
    sw: 'Rekodi tukio jipya la matengenezo kwa mojawapo ya mali zako.',
  },
  fieldAsset: { en: 'Asset', sw: 'Mali' },
  pickAsset: { en: 'Select an asset', sw: 'Chagua mali' },
  fieldKind: { en: 'Kind', sw: 'Aina' },
  kindPreventive: { en: 'Preventive', sw: 'Kinga' },
  kindCorrective: { en: 'Corrective', sw: 'Marekebisho' },
  kindInspection: { en: 'Inspection', sw: 'Ukaguzi' },
  fieldDescription: { en: 'Description', sw: 'Maelezo' },
  fieldEta: { en: 'ETA hours', sw: 'Masaa' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  submit: { en: 'Open maintenance', sw: 'Anza matengenezo' },
  required: { en: 'Required', sw: 'Inahitajika' },
  submitErrorPrefix: { en: 'Failed', sw: 'Imeshindwa' },
  unknownError: { en: 'unknown error', sw: 'hitilafu isiyojulikana' },
  close: { en: 'Close', sw: 'Funga' },
} as const;
