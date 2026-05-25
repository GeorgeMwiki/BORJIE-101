/**
 * Aggregator for all glossary category data.
 */

import type { GlossaryEntry } from '../types.js';
import { TENANCY_ENTRIES } from './tenancy.js';
import { FINANCE_ENTRIES } from './finance.js';
import { COMPLIANCE_ENTRIES } from './compliance.js';
import { MAINTENANCE_ENTRIES } from './maintenance.js';
import { LEGAL_PROCEEDINGS_ENTRIES } from './legal-proceedings.js';
import {
  HR_ENTRIES,
  INSURANCE_ENTRIES,
  MARKETING_ENTRIES,
  PROCUREMENT_ENTRIES,
} from './misc.js';

export const ALL_GLOSSARY_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...TENANCY_ENTRIES,
  ...FINANCE_ENTRIES,
  ...COMPLIANCE_ENTRIES,
  ...MAINTENANCE_ENTRIES,
  ...LEGAL_PROCEEDINGS_ENTRIES,
  ...HR_ENTRIES,
  ...INSURANCE_ENTRIES,
  ...MARKETING_ENTRIES,
  ...PROCUREMENT_ENTRIES,
]);

export {
  TENANCY_ENTRIES,
  FINANCE_ENTRIES,
  COMPLIANCE_ENTRIES,
  MAINTENANCE_ENTRIES,
  LEGAL_PROCEEDINGS_ENTRIES,
  HR_ENTRIES,
  INSURANCE_ENTRIES,
  MARKETING_ENTRIES,
  PROCUREMENT_ENTRIES,
};
