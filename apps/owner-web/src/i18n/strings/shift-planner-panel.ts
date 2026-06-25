/**
 * shift-planner-panel — guard-exempt Swahili+English string table for the
 * owner-cockpit `ShiftPlannerPanel`.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the panel needs (metric labels,
 * control captions, plan-result headers, error / empty copy, shift-kind
 * labels) lives here rather than inline in the component — keeping the
 * panel source free of hardcoded Swahili tokens while preserving the
 * symmetric `isSw ? M.x.sw : M.x.en` call-site shape used across owner-web.
 *
 * SHAPE
 * Flat-ish namespaced object. Each leaf is `{ sw, en }`. The exact `en`
 * and `sw` text is preserved verbatim from the original inline copy.
 */

export const shiftPlannerPanelStrings = {
  // ── Shift-kind labels (select options) ──────────────────────────────
  shiftKind: {
    morning: { sw: 'Asubuhi', en: 'Morning' },
    afternoon: { sw: 'Mchana', en: 'Afternoon' },
    night: { sw: 'Usiku', en: 'Night' },
  },

  // ── Metric strip tiles ──────────────────────────────────────────────
  metrics: {
    activeWorkersLabel: { sw: 'Wafanyakazi hai', en: 'Active workers' },
    activeWorkersSub: { sw: 'Wenye hadhi hai', en: 'With active status' },
    equipmentLabel: { sw: 'Mitambo inayofanya kazi', en: 'Operational equipment' },
    equipmentSub: { sw: 'Imepangwa kwa aina', en: 'Mapped by planner kind' },
    sitesLabel: { sw: 'Maeneo', en: 'Sites' },
    sitesSub: { sw: 'Yenye leseni hai', en: 'Across the estate' },
    certLabel: { sw: 'Vyeti vya wafanyakazi', en: 'Cert coverage' },
    certSub: { sw: 'Wenye angalau cheti 1', en: 'Workers with >=1 cert' },
  },

  // ── Roster provenance flags ─────────────────────────────────────────
  provenance: {
    title: { sw: 'Maelezo ya data', en: 'Data provenance notes' },
  },

  // ── Roster-honesty flag labels (keyed by gateway UPPER_SNAKE code) ────
  // The gateway emits stable codes (no English prose crosses the wire); the
  // panel resolves each to its {en,sw} label here and renders the active
  // locale. `unknown` is the visible single-locale fallback for a future code
  // the panel does not yet know — never the other language's text.
  rosterFlag: {
    EQUIPMENT_CERT_IS_PLANNER_DEFAULT: {
      sw:
        'KUMBUKA: cheti kinachohitajika cha mtambo ni chaguo-msingi la kipanga ' +
        'kwa kila aina — jedwali la mali halina safu ya cheti cha mwendeshaji.',
      en:
        'NOTE: equipment required-certification is a planner default per kind — ' +
        'the assets schema carries no operator certification column.',
    },
    EQUIPMENT_AVAILABILITY_DEFAULT_WINDOW: {
      sw:
        'KUMBUKA: dirisha la upatikanaji wa mtambo ni mkanda wa saa +/-24 ' +
        'kuzunguka sasa — jedwali la mali halina upatikanaji kwa kila zamu. ' +
        'Badilisha availableFromISO/availableToISO kabla ya kuendesha mpango.',
      en:
        'NOTE: equipment availability window is a +/-24h band around now — the ' +
        'assets schema carries no per-shift availability. Override ' +
        'availableFromISO/availableToISO before running a plan for tighter windows.',
    },
    WORKER_SHIFTS_FROM_ATTENDANCE_ZONE_DEFAULTED: {
      sw:
        'KUMBUKA: zamu za saa 72 zilizopita za mfanyakazi zinatokana na ' +
        "rekodi HALISI za mahudhurio; eneo limewekwa 'shimo la juu' kwa sababu " +
        'mahudhurio hayahifadhi eneo la hatari.',
      en:
        'NOTE: worker last-72h shifts are derived from REAL attendance rows; the ' +
        "zone is recorded as 'surface pit' because attendance does not store a " +
        'hazard zone.',
    },
    UNMAPPED_ASSET_KINDS_EXCLUDED: {
      sw:
        'KUMBUKA: mali zisizo ekskaveta|lori|gari|tobo|kipakiaji|kisaga|' +
        'kiratibu njia|LHD zimeondolewa kwenye kundi la mitambo (kipanga ' +
        'hakina aina yake).',
      en:
        'NOTE: assets that are not excavator|truck|vehicle|drill|loader|crusher|' +
        'grader|LHD are excluded from the equipment pool (the planner has no ' +
        'kind for them).',
    },
    unknown: {
      sw: 'KUMBUKA: maelezo ya data hayajulikani.',
      en: 'NOTE: unrecognized data provenance flag.',
    },
  },

  // ── Plan controls ───────────────────────────────────────────────────
  controls: {
    title: { sw: 'Panga zamu', en: 'Plan a shift' },
    site: { sw: 'Eneo', en: 'Site' },
    selectSite: { sw: '— Chagua eneo —', en: '— Select site —' },
    shiftKind: { sw: 'Aina ya zamu', en: 'Shift kind' },
    duration: { sw: 'Muda (saa)', en: 'Duration (hrs)' },
    ambient: { sw: 'Joto la nje (°C)', en: 'Ambient (°C)' },
    runPlan: { sw: 'Endesha mpango', en: 'Run plan' },
    pickSiteHint: {
      sw: 'Chagua eneo lenye wafanyakazi na mitambo.',
      en: 'Pick a site with workers and equipment.',
    },
  },

  // ── Error states ────────────────────────────────────────────────────
  errors: {
    rosterLoad: {
      sw: 'Imeshindwa kupakia ratiba ya wafanyakazi.',
      en: 'Failed to load the live roster.',
    },
    planUnsat: {
      sw: 'Mpango haukuwezekana kwa vikwazo vilivyopo (uchovu / OSHA / mzigo).',
      en: 'Plan was unsatisfiable under current constraints (fatigue / OSHA / load).',
    },
  },

  // ── Plan result — assignments ───────────────────────────────────────
  assignments: {
    title: { sw: 'Migao', en: 'Assignments' },
    none: { sw: 'Hakuna migao.', en: 'No assignments produced.' },
    worker: { sw: 'Mfanyakazi', en: 'Worker' },
    equip: { sw: 'Mtambo', en: 'Equip' },
    fatigue: { sw: 'uchovu', en: 'fatigue' },
    unfilled: { sw: 'Kazi zisizo na mtu', en: 'Unfilled tasks' },
    rotationAlerts: { sw: 'Tahadhari za mzunguko', en: 'Rotation alerts' },
  },

  // ── Hazard zones (used inside the rotation-alert template) ───────────
  // Keyed by the planner `TaskZone` enum. Full en+sw parity per the
  // zero-mix canon; the FE never renders the raw zone token.
  zone: {
    'surface-pit': { sw: 'shimo la juu', en: 'surface pit' },
    underground: { sw: 'chini ya ardhi', en: 'underground' },
    crusher: { sw: 'kisaga', en: 'crusher' },
    'processing-plant': { sw: 'kiwanda cha uchakataji', en: 'processing plant' },
    'haulage-road': { sw: 'barabara ya usafirishaji', en: 'haulage road' },
    'maintenance-bay': { sw: 'sehemu ya matengenezo', en: 'maintenance bay' },
    overburden: { sw: 'mzigo wa juu', en: 'overburden' },
  },

  // ── Equipment kinds (used inside the unassigned-task reason template) ─
  equipmentKind: {
    excavator: { sw: 'ekskaveta', en: 'excavator' },
    'haul-truck': { sw: 'lori la mzigo', en: 'haul truck' },
    drill: { sw: 'kichimbaji', en: 'drill' },
    loader: { sw: 'kipakiaji', en: 'loader' },
    crusher: { sw: 'kisaga', en: 'crusher' },
    grader: { sw: 'kiratibu njia', en: 'grader' },
    lhd: { sw: 'LHD', en: 'LHD' },
  },

  // ── Certifications (used inside the unassigned-task reason template) ──
  certification: {
    'haul-truck-license': { sw: 'leseni ya lori la mzigo', en: 'haul-truck license' },
    'excavator-license': { sw: 'leseni ya ekskaveta', en: 'excavator license' },
    'underground-cert': { sw: 'cheti cha chini ya ardhi', en: 'underground cert' },
    'blaster-permit': { sw: 'kibali cha mlipuaji', en: 'blaster permit' },
    'first-aid': { sw: 'huduma ya kwanza', en: 'first aid' },
    'crusher-operator': { sw: 'mwendeshaji wa kisaga', en: 'crusher operator' },
    'electrician-class-b': { sw: 'fundi umeme daraja B', en: 'electrician class B' },
    'confined-space': { sw: 'nafasi finyu', en: 'confined space' },
  },

  // ── Unassigned-task reason templates (keyed by structured reasonKey) ──
  // The {list} placeholder is filled by the FE from the localized
  // certification / equipment-kind tokens — whole-template interpolation,
  // never string concatenation across languages.
  unassignedReason: {
    'no-certified-worker': {
      sw: 'Hakuna mfanyakazi mwenye vyeti vinavyohitajika: {list}',
      en: 'No worker holds required certifications: {list}',
    },
    'no-matching-equipment': {
      sw: 'Hakuna mtambo unaolingana na aina zinazohitajika: {list}',
      en: 'No equipment matches required kinds: {list}',
    },
    'all-assigned': {
      sw: 'Wafanyakazi au mitambo yote inayostahili tayari imegawiwa',
      en: 'All eligible workers or equipment already assigned',
    },
    listEmpty: { sw: 'hakuna', en: 'n/a' },
  },

  // ── Rotation-alert template (keyed by structured rotation fields) ─────
  // {hours} and {zone} are filled by the FE; {zone} resolves via the
  // `zone` table above so the whole line is single-locale.
  rotationAlert: {
    template: {
      sw: 'Mzunguko wa eneo la hatari unahitajika baada ya saa {hours} katika {zone}',
      en: 'Hazard-zone rotation required after {hours}h in {zone}',
    },
  },

  // ── OSHA rule labels + detail templates (keyed by structured ruleKey) ─
  // {n} = affected-worker count; {h}/{days}/{wk}/{temp} = thresholds /
  // ambient temperature supplied by the structured labelContext. The FE
  // composes the whole line in the active locale — never concatenation.
  rule: {
    'osha-tz-r1': {
      label: {
        sw: 'Zamu ya juu saa {h1} + mapumziko ya chini saa {h2}',
        en: 'Max {h1}h shift + min {h2}h rest',
      },
      detailPass: {
        sw: 'Wafanyakazi wote wamepita sheria ya urefu wa zamu na mapumziko.',
        en: 'All workers cleared shift-length + rest rule.',
      },
      detailFail: {
        sw: 'Wafanyakazi {n} wameshindwa urefu wa zamu au kiwango cha chini cha mapumziko.',
        en: '{n} worker(s) failed shift-length or rest minimum.',
      },
    },
    'osha-tz-r2': {
      label: {
        sw: 'Siku za juu {days} za kazi mfululizo',
        en: 'Max {days} consecutive working days',
      },
      detailPass: {
        sw: 'Hakuna mfanyakazi anayezidi kikomo cha siku mfululizo.',
        en: 'No workers exceed consecutive-day cap.',
      },
      detailFail: {
        sw: 'Wafanyakazi {n} wanahitaji siku ya mapumziko ya saa 24.',
        en: '{n} worker(s) require a 24h rest day.',
      },
    },
    'osha-tz-r3a': {
      label: {
        sw: 'Chini ya ardhi saa {wk} za juu kwa wiki',
        en: 'Underground max {wk}h/week',
      },
      detailPass: {
        sw: 'Hakuna mfanyakazi wa chini ya ardhi anayezidi kikomo cha wiki.',
        en: 'No underground worker exceeds the weekly cap.',
      },
      detailFail: {
        sw: 'Wafanyakazi {n} wa chini ya ardhi wamezidi kikomo cha wiki.',
        en: '{n} underground worker(s) over weekly cap.',
      },
    },
    'osha-tz-r4': {
      label: {
        sw: 'Maelezo ya usalama ya lazima kabla ya zamu yamerekodiwa',
        en: 'Mandatory pre-shift safety briefing logged',
      },
      detailPass: {
        sw: 'Wafanyakazi wote wana maelezo ya usalama ya sasa kwenye kumbukumbu.',
        en: 'All workers have a current safety briefing on record.',
      },
      detailFail: {
        sw: 'Wafanyakazi {n} hawana maelezo ya usalama ya sasa.',
        en: '{n} worker(s) lack a current safety briefing.',
      },
    },
    'osha-tz-r5': {
      label: {
        sw: 'Mzunguko wa joto kali pale joto la nje linapozidi {temp}°C',
        en: 'Heat-stress rotation when ambient > {temp}°C',
      },
      detailPass: {
        sw: 'Mzunguko wa joto kali hauhitajiki.',
        en: 'Heat-stress rotation not required.',
      },
      // Ambient-temperature variant ({ambient} = measured ambient °C).
      detailFail: {
        sw: 'Joto la nje {ambient}°C — timu za shimo la juu lazima zizunguke.',
        en: 'Ambient {ambient}°C — surface-pit teams must rotate.',
      },
    },
    // Fallback for a rule key the FE does not yet recognise. Renders a
    // visible, single-locale placeholder rather than another language.
    unknownLabel: { sw: 'Sheria isiyojulikana', en: 'Unknown rule' },
    unknownDetail: { sw: 'Hakuna maelezo.', en: 'No detail available.' },
  },

  // ── Blocking-failure template (keyed by structured ruleKey) ──────────
  // Composes the localized rule label with its localized fail detail.
  blockingFailure: {
    template: { sw: '{label}: {detail}', en: '{label}: {detail}' },
  },

  // ── Plan result — OSHA compliance ───────────────────────────────────
  compliance: {
    title: { sw: 'Ufuasi wa OSHA-TZ', en: 'OSHA-TZ compliance' },
    pass: { sw: 'Imepita', en: 'PASS' },
    fail: { sw: 'Imeshindwa', en: 'FAIL' },
    blocking: { sw: 'Vizuizi vya idhini', en: 'Blocking failures' },
    // Per-rule status pill. A passing rule reads OK; a failing rule renders
    // its severity word in the active locale (never the raw enum token).
    statusOk: { sw: 'Sawa', en: 'OK' },
    severityUnknown: { sw: 'Haijulikani', en: 'Unknown' },
    severity: {
      info: { sw: 'Taarifa', en: 'Info' },
      low: { sw: 'Chini', en: 'Low' },
      medium: { sw: 'Wastani', en: 'Medium' },
      high: { sw: 'Juu', en: 'High' },
      critical: { sw: 'Hatari kubwa', en: 'Critical' },
      fatality: { sw: 'Kifo', en: 'Fatality' },
    },
  },
} as const;
