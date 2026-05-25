/**
 * Inspection policy.
 *
 * Submission of a completed inspection report. Pre-checks ensure every
 * required checklist section is present; red-lines block reports that
 * claim "no issues" while photographs prove otherwise (heuristic — the
 * brain handles nuanced cases) and reports submitted by an unauthorised
 * role.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readBoolean, readString } from './_helpers.js';

const REQUIRED_SECTIONS = ['exterior', 'interior', 'utilities', 'safety'] as const;
const ALLOWED_INSPECTOR_ROLES = ['inspector', 'property_manager', 'admin'] as const;

export const inspectionPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'inspection',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const sections = readArray(req.payload, ['sections']) ?? [];
    const presentSectionKeys = new Set<string>();
    for (const s of sections) {
      const key = readString(s as Readonly<Record<string, unknown>>, ['key']);
      if (key) presentSectionKeys.add(key);
    }
    for (const required of REQUIRED_SECTIONS) {
      if (!presentSectionKeys.has(required)) {
        issues.push(
          issue(
            'inspection.section.missing',
            `Required section "${required}" is missing from the report.`,
            'error',
            'sections',
          ),
        );
      }
    }
    const inspectorId = readString(req.payload, ['inspectorId']);
    if (!inspectorId) {
      issues.push(
        issue(
          'inspection.inspector.missing',
          'inspectorId is required on every inspection submission.',
          'error',
          'inspectorId',
        ),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    if (!ALLOWED_INSPECTOR_ROLES.includes(req.context.actorRole as (typeof ALLOWED_INSPECTOR_ROLES)[number])) {
      redLines.push(
        issue(
          'inspection.role.unauthorised',
          `Role "${req.context.actorRole}" cannot submit inspection reports.`,
          'critical',
        ),
      );
    }
    // "No issues but defects array non-empty" is an inconsistency the
    // policy can catch deterministically.
    const noIssuesClaimed = readBoolean(req.payload, ['noIssuesFound']);
    const defects = readArray(req.payload, ['defects']) ?? [];
    if (noIssuesClaimed === true && defects.length > 0) {
      redLines.push(
        issue(
          'inspection.contradictory_no_issues_claim',
          `Report claims "no issues" but lists ${defects.length} defect(s). Resolve before submission.`,
          'critical',
          'noIssuesFound',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const sections = readArray(req.payload, ['sections']) ?? [];
    const defects = readArray(req.payload, ['defects']) ?? [];
    const inspectorId = readString(req.payload, ['inspectorId']) ?? '(missing)';
    return [
      `You are reviewing an inspection report by ${inspectorId} for tenant ${req.context.tenantId}.`,
      `Sections submitted: ${sections.length}. Defects logged: ${defects.length}.`,
      `Decide whether the report is internally consistent and complete enough to file.`,
    ].join(' ');
  },
};
