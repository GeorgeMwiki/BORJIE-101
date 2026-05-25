/**
 * Estate-glossary public barrel.
 */

export * from './types.js';
export {
  buildGlossaryRegistry,
  getDefaultGlossaryRegistry,
  lookupTerm,
  searchByText,
  byJurisdiction,
  byCategory,
  translate,
  computeCoverage,
  type GlossaryRegistry,
  type CoverageReport,
} from './lookup.js';
export {
  ALL_GLOSSARY_ENTRIES,
  TENANCY_ENTRIES,
  FINANCE_ENTRIES,
  COMPLIANCE_ENTRIES,
  MAINTENANCE_ENTRIES,
  LEGAL_PROCEEDINGS_ENTRIES,
  HR_ENTRIES,
  INSURANCE_ENTRIES,
  MARKETING_ENTRIES,
  PROCUREMENT_ENTRIES,
} from './glossary-data/index.js';
