/**
 * New-lease policy.
 *
 * A new lease creates a binding obligation. Pre-checks verify parties,
 * unit, dates, and rent are present. Red-lines block leases that
 * conflict with an existing active lease on the same unit, have
 * negative rent, or attempt to back-date the start by more than 60
 * days (clear data-entry mistake or fraud signal).
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readNumber, readString } from './_helpers.js';

const MAX_BACKDATE_DAYS = 60;

export const newLeasePolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'new_lease',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const required = [
      { path: ['unitId'], field: 'unitId' },
      { path: ['tenantPartyId'], field: 'tenantPartyId' },
      { path: ['landlordPartyId'], field: 'landlordPartyId' },
      { path: ['startDate'], field: 'startDate' },
      { path: ['endDate'], field: 'endDate' },
    ] as const;
    for (const r of required) {
      const v = readString(req.payload, r.path);
      if (!v) {
        issues.push(
          issue(
            `lease.${r.field}.missing`,
            `${r.field} is required.`,
            'error',
            r.field,
          ),
        );
      }
    }
    const rent = readNumber(req.payload, ['monthlyRent']);
    if (rent === undefined) {
      issues.push(
        issue('lease.rent.missing', 'monthlyRent is required.', 'error', 'monthlyRent'),
      );
    } else if (rent < 0) {
      issues.push(
        issue(
          'lease.rent.negative',
          'monthlyRent cannot be negative.',
          'error',
          'monthlyRent',
        ),
      );
    }
    const start = readString(req.payload, ['startDate']);
    const end = readString(req.payload, ['endDate']);
    if (start && end && end <= start) {
      issues.push(
        issue(
          'lease.dates.end_before_start',
          'endDate must be after startDate.',
          'error',
          'endDate',
        ),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const start = readString(req.payload, ['startDate']);
    if (start) {
      const startMs = Date.parse(start);
      const submittedMs = Date.parse(req.context.submittedAt);
      if (!Number.isNaN(startMs) && !Number.isNaN(submittedMs)) {
        const dayMs = 24 * 60 * 60 * 1000;
        const backdateDays = (submittedMs - startMs) / dayMs;
        if (backdateDays > MAX_BACKDATE_DAYS) {
          redLines.push(
            issue(
              'lease.start.excessive_backdate',
              `Lease start is back-dated by ${Math.round(backdateDays)} days (limit: ${MAX_BACKDATE_DAYS}). Refusing.`,
              'critical',
              'startDate',
            ),
          );
        }
      }
    }
    const conflictingLeases = readArray(req.payload, ['conflictingActiveLeaseIds']) ?? [];
    if (conflictingLeases.length > 0) {
      redLines.push(
        issue(
          'lease.conflict.active_overlap',
          `Unit already has ${conflictingLeases.length} active overlapping lease(s).`,
          'critical',
          'unitId',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const unitId = readString(req.payload, ['unitId']) ?? '(missing)';
    const rent = readNumber(req.payload, ['monthlyRent']);
    const start = readString(req.payload, ['startDate']);
    const end = readString(req.payload, ['endDate']);
    return [
      `You are reviewing a new lease on unit ${unitId} for tenant ${req.context.tenantId}.`,
      `Rent: ${rent ?? '?'} per month; period ${start ?? '?'} to ${end ?? '?'}.`,
      `Assess whether the rent and term are plausible for the unit class and location.`,
    ].join(' ');
  },
};
