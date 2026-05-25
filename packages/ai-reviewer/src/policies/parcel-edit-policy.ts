/**
 * Parcel-edit policy.
 *
 * A "parcel edit" is a change to the canonical parcel record (id,
 * size, address, classification). PreChecks ensure the diff is
 * well-formed; red-lines block changes that would orphan downstream
 * leases or break tenant scoping.
 */

import type { PolicyRule } from '../types.js';
import { issue, readString, readNumber, readArray } from './_helpers.js';

interface ParcelEditPayload {
  readonly parcelId: string;
  readonly currentName?: string;
  readonly newName?: string;
  readonly currentAreaSqm?: number;
  readonly newAreaSqm?: number;
  readonly activeLeaseIds?: ReadonlyArray<string>;
  readonly changeJustification?: string;
}

export const parcelEditPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'parcel_edit',

  preChecks(req) {
    const issues = [];
    const parcelId = readString(req.payload, ['parcelId']);
    if (!parcelId) {
      issues.push(
        issue(
          'parcel.id.missing',
          'A parcelId is required to edit a parcel.',
          'error',
          'parcelId',
        ),
      );
    }
    const newName = readString(req.payload, ['newName']);
    const currentName = readString(req.payload, ['currentName']);
    if (newName !== undefined && newName.trim().length === 0) {
      issues.push(
        issue(
          'parcel.name.empty',
          'New parcel name cannot be blank.',
          'error',
          'newName',
        ),
      );
    }
    if (newName !== undefined && currentName !== undefined && newName === currentName) {
      issues.push(
        issue(
          'parcel.name.noop',
          'New parcel name is identical to the current name.',
          'warning',
          'newName',
        ),
      );
    }
    const newArea = readNumber(req.payload, ['newAreaSqm']);
    if (newArea !== undefined && newArea <= 0) {
      issues.push(
        issue(
          'parcel.area.non_positive',
          'Parcel area must be greater than zero.',
          'error',
          'newAreaSqm',
        ),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines = [];
    const currentArea = readNumber(req.payload, ['currentAreaSqm']);
    const newArea = readNumber(req.payload, ['newAreaSqm']);
    if (currentArea !== undefined && newArea !== undefined) {
      const delta = Math.abs(newArea - currentArea) / Math.max(currentArea, 1);
      if (delta > 0.5) {
        redLines.push(
          issue(
            'parcel.area.unexplained_50pct_swing',
            `Area change exceeds 50% (${currentArea} → ${newArea}). Requires a re-survey, not an inline edit.`,
            'critical',
            'newAreaSqm',
          ),
        );
      }
    }
    const activeLeases = readArray(req.payload, ['activeLeaseIds']);
    const justification = readString(req.payload, ['changeJustification']);
    if (activeLeases && activeLeases.length > 0 && !justification) {
      redLines.push(
        issue(
          'parcel.edit.requires_justification_when_leased',
          `Parcel has ${activeLeases.length} active lease(s); edit requires written justification.`,
          'critical',
          'changeJustification',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const p = req.payload as unknown as Partial<ParcelEditPayload>;
    return [
      `You are reviewing a parcel-edit request for tenant ${req.context.tenantId}.`,
      `Parcel id: ${p.parcelId ?? '(missing)'}.`,
      `Proposed change: name ${p.currentName ?? '?'} → ${p.newName ?? '?'}; area ${
        p.currentAreaSqm ?? '?'
      } → ${p.newAreaSqm ?? '?'} sqm.`,
      `Active leases on parcel: ${(p.activeLeaseIds ?? []).length}.`,
      `Justification: ${p.changeJustification ?? '(none)'}.`,
      `Decide whether to approve, reject_with_changes, reject_final, or escalate.`,
    ].join(' ');
  },
};
