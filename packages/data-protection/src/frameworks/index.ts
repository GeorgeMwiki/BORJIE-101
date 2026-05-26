/**
 * Compliance-framework helpers — package-internal utilities only.
 *
 * IMPORTANT: this module does NOT name any specific jurisdiction. Real
 * `ComplianceFrameworkPort` instances live in `@borjie/jurisdiction-
 * profiles` or `@borjie/compliance-plugins`. The functions below are
 * helpers callers use to combine, validate, or pick the strictest of
 * several frameworks for a multi-jurisdictional tenant.
 */

import type {
  Classification,
  ComplianceFrameworkPort,
} from '../types.js';

/**
 * Combine N frameworks into one synthetic "strictest" framework. The
 * resulting port enforces:
 *
 *   - the SHORTEST authority + subject notification windows;
 *   - the LONGEST per-class minimum retention;
 *   - the SHORTEST per-class maximum retention;
 *   - the FEWEST days for RTBF fulfilment.
 *
 * Provenance is the union of all provenances.
 */
export function combineStrictest(
  frameworks: ReadonlyArray<ComplianceFrameworkPort>,
): ComplianceFrameworkPort {
  if (frameworks.length === 0) {
    throw new Error('combineStrictest: at least one framework required');
  }
  const ids = frameworks.map((f) => f.id).sort();
  const id = `strictest:${ids.join('+')}`;
  const label = `Strictest of ${ids.join(' + ')}`;
  const breachAuthorityNotificationHours = frameworks.reduce(
    (acc, f) => Math.min(acc, f.breachAuthorityNotificationHours),
    Number.POSITIVE_INFINITY,
  );
  const breachSubjectNotificationHours = frameworks.reduce(
    (acc, f) => Math.min(acc, f.breachSubjectNotificationHours),
    Number.POSITIVE_INFINITY,
  );
  const rtbfFulfilmentDays = frameworks.reduce(
    (acc, f) => Math.min(acc, f.rtbfFulfilmentDays),
    Number.POSITIVE_INFINITY,
  );
  const minRetentionDaysByClass: Partial<Record<Classification, number>> = {};
  const maxRetentionDaysByClass: Partial<Record<Classification, number>> = {};
  for (const f of frameworks) {
    for (const [cls, days] of Object.entries(f.minRetentionDaysByClass) as ReadonlyArray<
      [Classification, number]
    >) {
      const prior = minRetentionDaysByClass[cls];
      minRetentionDaysByClass[cls] =
        prior === undefined ? days : Math.max(prior, days);
    }
    for (const [cls, days] of Object.entries(f.maxRetentionDaysByClass) as ReadonlyArray<
      [Classification, number]
    >) {
      const prior = maxRetentionDaysByClass[cls];
      maxRetentionDaysByClass[cls] =
        prior === undefined ? days : Math.min(prior, days);
    }
  }
  return Object.freeze({
    id,
    label,
    breachAuthorityNotificationHours,
    breachSubjectNotificationHours,
    rtbfFulfilmentDays,
    minRetentionDaysByClass: Object.freeze(minRetentionDaysByClass),
    maxRetentionDaysByClass: Object.freeze(maxRetentionDaysByClass),
    provenance: Object.freeze(
      frameworks.flatMap((f) => f.provenance.map((p) => Object.freeze({ ...p }))),
    ),
  });
}

/**
 * Validate a framework's invariants — e.g., notification windows must
 * be positive, fulfilment days must be ≥ 1, every retention pair must
 * satisfy `min ≤ max` per class.
 */
export function validateFramework(
  framework: ComplianceFrameworkPort,
): ReadonlyArray<string> {
  const errors: string[] = [];
  if (framework.breachAuthorityNotificationHours <= 0) {
    errors.push('breachAuthorityNotificationHours must be positive');
  }
  if (framework.breachSubjectNotificationHours <= 0) {
    errors.push('breachSubjectNotificationHours must be positive');
  }
  if (framework.rtbfFulfilmentDays <= 0) {
    errors.push('rtbfFulfilmentDays must be positive');
  }
  for (const [cls, min] of Object.entries(framework.minRetentionDaysByClass) as ReadonlyArray<
    [Classification, number]
  >) {
    const max = framework.maxRetentionDaysByClass[cls];
    if (max !== undefined && max < min) {
      errors.push(`retention bounds invalid for ${cls}: min(${min}) > max(${max})`);
    }
  }
  if (framework.provenance.length === 0) {
    errors.push('provenance must include at least one URL+title+date');
  }
  return Object.freeze(errors);
}
