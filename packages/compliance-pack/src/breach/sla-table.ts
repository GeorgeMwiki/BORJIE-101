/**
 * Per-jurisdiction breach notification SLAs.
 *
 * Drawn from the actual legal texts:
 *   - GDPR Art.33 — 72h to supervisory authority; Art.34 — to
 *     subjects without undue delay when high risk
 *   - CCPA — no regulator notification, "expedient" to subjects
 *   - POPIA s.22 — "as soon as reasonably possible"
 *   - TZ-DPA s.28 — 72h regulator; without undue delay to subjects
 *   - KE-DPA s.43 — 72h regulator
 *   - UG-DPA s.23 — 72h regulator
 *   - RW-DPA Art.36 — 48h regulator
 *   - NG-NDPR/DPA s.40 — 72h regulator
 */

import type { BreachNotificationSpec, Jurisdiction } from '../types.js';

export const BREACH_SLAS: Readonly<Record<Jurisdiction, BreachNotificationSpec>> = {
  GLOBAL: {
    jurisdiction: 'GLOBAL',
    regulator: null,
    notifyRegulatorWithinHours: null,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
  EU: {
    jurisdiction: 'EU',
    regulator: 'EDPB / national supervisory authority',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
  UK: {
    jurisdiction: 'UK',
    regulator: 'ICO (Information Commissioner)',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
  'US-CA': {
    jurisdiction: 'US-CA',
    regulator: null,
    notifyRegulatorWithinHours: null,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'always',
  },
  ZA: {
    jurisdiction: 'ZA',
    regulator: 'Information Regulator (South Africa)',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'always',
  },
  TZ: {
    jurisdiction: 'TZ',
    regulator: 'Personal Data Protection Commission (PDPC)',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: 72,
    subjectNotificationThreshold: 'high_risk_only',
  },
  KE: {
    jurisdiction: 'KE',
    regulator: 'Office of the Data Protection Commissioner (ODPC)',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: 72,
    subjectNotificationThreshold: 'high_risk_only',
  },
  UG: {
    jurisdiction: 'UG',
    regulator: 'Personal Data Protection Office (PDPO) / NITA-U',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
  RW: {
    jurisdiction: 'RW',
    regulator: 'National Cyber Security Authority (NCSA)',
    notifyRegulatorWithinHours: 48,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
  NG: {
    jurisdiction: 'NG',
    regulator: 'Nigeria Data Protection Commission (NDPC)',
    notifyRegulatorWithinHours: 72,
    notifySubjectsWithinHours: null,
    subjectNotificationThreshold: 'high_risk_only',
  },
};
