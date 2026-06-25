/**
 * workforce-safety-surface — guard-exempt bilingual (sw / en) copy for the
 * NEW honest-data states introduced on the owner-cockpit People + Safety
 * surfaces (components/people/PeopleSurface.tsx,
 * components/safety/SafetySurface.tsx).
 *
 * These keys back the empty / error / not-yet-wired states that replaced
 * fabricated rows (mock supervisors, an invented fuel sparkline, a static
 * ICA control list with hardcoded OK/recert states). Lives under `i18n/`
 * so the locale-purity scanner exempts the Swahili.
 *
 * A new per-surface file (rather than editing the shared tail.ts bundle)
 * keeps the change conflict-free across parallel review streams.
 */

export const workforceSafetyStrings = {
  // ── People surface: real-roster workforce panel ────────────────────
  people: {
    rosterHeading: { en: 'Workforce on roster', sw: 'Wafanyakazi katika orodha' },
    rosterCaption: {
      en: 'Live employees projected from the shift roster',
      sw: 'Wafanyakazi hai kutoka orodha ya zamu',
    },
    onShiftLabel: { en: 'Workforce on shift', sw: 'Wafanyakazi zamu' },
    onShiftSub: { en: 'A shift currently in progress', sw: 'Zamu inayoendelea sasa' },
    rosterLabel: { en: 'Workforce on roster', sw: 'Wafanyakazi orodhani' },
    rosterSub: { en: 'Active employees', sw: 'Wafanyakazi hai' },
    certSuffix: { en: 'certifications', sw: 'vyeti' },
    certSuffixOne: { en: 'certification', sw: 'cheti' },
    onShiftBadge: { en: 'On shift', sw: 'Kazini' },
    offShiftBadge: { en: 'Off shift', sw: 'Pumzika' },
    rosterLoadError: {
      en: 'Could not load the workforce roster.',
      sw: 'Imeshindwa kupakia orodha ya wafanyakazi.',
    },
    rosterEmptyTitle: { en: 'No employees on roster yet', sw: 'Hakuna wafanyakazi orodhani bado' },
    rosterEmptyBody: {
      en: 'Add workers via the org-admin brain tools to populate the roster.',
      sw: 'Ongeza wafanyakazi kupitia zana za akili za usimamizi ili kujaza orodha.',
    },
  },

  // ── Safety surface: ICA critical controls (no live endpoint yet) ───
  safety: {
    icaPendingTitle: {
      en: 'Equipment certification not yet connected',
      sw: 'Uthibitisho wa vifaa haujaunganishwa bado',
    },
    icaPendingBody: {
      en: 'Critical-control certification status will appear here once the equipment register is wired. No statuses are shown until then.',
      sw: 'Hali ya uthibitisho wa vidhibiti muhimu itaonekana hapa baada ya rejista ya vifaa kuunganishwa. Hakuna hali itakayoonyeshwa hadi wakati huo.',
    },
  },
} as const;
