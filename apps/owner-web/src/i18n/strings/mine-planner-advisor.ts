/**
 * mine-planner-advisor — guard-exempt bilingual (sw / en) copy for the
 * Shift-Plan Advisor panel (components/fleet/MinePlannerAdvisorPanel.tsx).
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const minePlannerAdvisorStrings = {
  title: { en: 'Shift-Plan Advisor', sw: 'Mshauri wa Mpango wa Zamu' },
  subtitle: {
    en: '24h polygon → equipment → crew plan + skill-gap advice',
    sw: 'Mpango wa saa 24 wa eneo → vifaa → wafanyakazi + ushauri wa ujuzi',
  },
  selectSite: { en: 'Select site', sw: 'Chagua tovuti' },

  loadingSites: { en: 'Loading sites…', sw: 'Inapakia tovuti…' },
  noSites: {
    en: 'No sites yet — add a site to compute a shift plan.',
    sw: 'Hakuna tovuti bado — ongeza tovuti ili kukokotoa mpango wa zamu.',
  },
  computing: { en: 'Computing shift plan…', sw: 'Inakokotoa mpango wa zamu…' },
  advisorUnavailable: {
    en: 'Advisor unavailable. Try again shortly.',
    sw: 'Mshauri haupatikani. Jaribu tena hivi karibuni.',
  },

  statPlannedTonnes: { en: 'Planned tonnes', sw: 'Tani zilizopangwa' },
  statUnmetTonnes: { en: 'Unmet tonnes', sw: 'Tani zisizofikiwa' },
  statAssignments: { en: 'Assignments', sw: 'Mgawanyo' },
  statPlanOpex: { en: 'Plan opex', sw: 'Gharama ya uendeshaji' },

  noParcels: {
    en: 'No parcels or fleet to plan for this site.',
    sw: 'Hakuna mafungu au magari ya kupanga kwa tovuti hii.',
  },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  noGaps: {
    en: 'Plan meets target with no skill gaps.',
    sw: 'Mpango unafikia lengo bila pengo la ujuzi.',
  },
} as const;
