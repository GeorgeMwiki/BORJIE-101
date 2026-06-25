/**
 * incident-new-page — guard-exempt bilingual (sw / en) copy for the
 * "Log new safety incident" screen
 * (app/(routes)/safety/incidents/new/page.tsx).
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const incidentNewStrings = {
  back: { en: 'Back to Safety', sw: 'Rudi kwenye Usalama' },
  eyebrow: { en: 'Safety · New incident', sw: 'Usalama · Tukio jipya' },
  title: { en: 'Log new incident', sw: 'Rekodi tukio jipya' },
  intro: {
    en: 'Critical and high-severity incidents trigger an immediate escalation to managers and the owner cockpit.',
    sw: 'Matukio mazito na ya hatari kubwa husababisha taarifa ya haraka kwa wasimamizi na chumba cha udhibiti cha mmiliki.',
  },

  successTitle: { en: 'Incident logged', sw: 'Tukio limerekodiwa' },
  successBody: {
    en: 'The escalation fan-out has been triggered.',
    sw: 'Mfumo wa taarifa za haraka umeanzishwa.',
  },
  successIdLabel: { en: 'ID', sw: 'Kitambulisho' },
  viewBoard: { en: 'View safety board', sw: 'Tazama ubao wa usalama' },

  gatewayError: {
    en: 'Failed to log the incident. Please try again.',
    sw: 'Imeshindwa kurekodi tukio. Tafadhali jaribu tena.',
  },

  fieldKind: { en: 'Incident kind', sw: 'Aina ya tukio' },
  fieldSeverity: { en: 'Severity', sw: 'Ukali' },
  severityLow: { en: 'Low', sw: 'Chini' },
  severityMedium: { en: 'Medium', sw: 'Wastani' },
  severityHigh: { en: 'High', sw: 'Juu' },
  severityCritical: { en: 'Critical', sw: 'Hatari' },

  fieldOccurredAt: { en: 'Date & time of incident', sw: 'Tarehe na saa ya tukio' },
  fieldDescription: { en: 'Description', sw: 'Maelezo' },
  descriptionPlaceholder: {
    en: 'Describe what happened, where, and who was involved.',
    sw: 'Eleza kilichotokea, wapi, na nani alihusika.',
  },
  fieldLocation: { en: 'Location', sw: 'Eneo' },
  locationPlaceholder: { en: 'e.g. Level 3 south shaft', sw: 'mf. Shimo la kusini ngazi ya 3' },
  fieldSiteId: { en: 'Site ID', sw: 'Kitambulisho cha tovuti' },
  siteIdPlaceholder: { en: 'UUID or site code', sw: 'UUID au msimbo wa tovuti' },
  optional: { en: '(optional)', sw: '(hiari)' },
  fieldFatalities: { en: 'Fatalities', sw: 'Vifo' },
  fieldInjuries: { en: 'Injuries', sw: 'Majeruhi' },

  submit: { en: 'Log incident', sw: 'Rekodi tukio' },
  askMwikila: { en: 'Ask Mr. Mwikila', sw: 'Uliza Bw. Mwikila' },

  // Validation messages — resolved per active locale (zero-mix canon).
  validationOccurredAt: {
    en: 'Date and time required',
    sw: 'Tarehe na saa zinahitajika',
  },
  validationDescription: {
    en: 'Describe the incident (min 5 characters)',
    sw: 'Eleza tukio (angalau herufi 5)',
  },
  validationGeneric: {
    en: 'Check this field and try again.',
    sw: 'Kagua sehemu hii na ujaribu tena.',
  },
} as const;
