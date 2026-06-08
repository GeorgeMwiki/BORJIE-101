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

  // ── Plan result — OSHA compliance ───────────────────────────────────
  compliance: {
    title: { sw: 'Ufuasi wa OSHA-TZ', en: 'OSHA-TZ compliance' },
    pass: { sw: 'Imepita', en: 'PASS' },
    fail: { sw: 'Imeshindwa', en: 'FAIL' },
    blocking: { sw: 'Vizuizi vya idhini', en: 'Blocking failures' },
  },
} as const;
