/**
 * Maintenance-completion policy.
 *
 * Closes a maintenance ticket. Pre-checks ensure the ticket id and
 * completion notes are present. Red-lines block closures that have
 * an open invoice but no payment confirmation and closures where the
 * resolution code does not match any of the allowed values.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readBoolean, readNumber, readString } from './_helpers.js';

const RESOLUTION_CODES = [
  'fixed',
  'replaced',
  'no_fault_found',
  'tenant_resolved',
  'deferred',
  'cancelled',
] as const;

export const maintenanceCompletionPolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'maintenance_completion',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const ticketId = readString(req.payload, ['ticketId']);
    if (!ticketId) {
      issues.push(issue('maintenance.ticket.missing', 'ticketId is required.', 'error', 'ticketId'));
    }
    const notes = readString(req.payload, ['completionNotes']);
    if (!notes || notes.trim().length < 10) {
      issues.push(
        issue(
          'maintenance.notes.too_short',
          'Completion notes must be at least 10 characters.',
          'error',
          'completionNotes',
        ),
      );
    }
    const resolution = readString(req.payload, ['resolutionCode']);
    if (!resolution) {
      issues.push(
        issue(
          'maintenance.resolution.missing',
          'resolutionCode is required.',
          'error',
          'resolutionCode',
        ),
      );
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const resolution = readString(req.payload, ['resolutionCode']);
    if (
      resolution &&
      !RESOLUTION_CODES.includes(resolution as (typeof RESOLUTION_CODES)[number])
    ) {
      redLines.push(
        issue(
          'maintenance.resolution.invalid',
          `resolutionCode "${resolution}" is not one of: ${RESOLUTION_CODES.join(', ')}.`,
          'critical',
          'resolutionCode',
        ),
      );
    }
    const invoiceTotal = readNumber(req.payload, ['invoiceTotal']);
    const paid = readBoolean(req.payload, ['invoicePaid']);
    if (invoiceTotal !== undefined && invoiceTotal > 0 && paid !== true) {
      redLines.push(
        issue(
          'maintenance.invoice.unpaid_at_completion',
          `Cannot close ticket with invoice total ${invoiceTotal} unpaid.`,
          'critical',
          'invoicePaid',
        ),
      );
    }
    const photos = readArray(req.payload, ['completionPhotos']) ?? [];
    if (resolution === 'fixed' && photos.length === 0) {
      redLines.push(
        issue(
          'maintenance.fixed.requires_photo',
          'Closing as "fixed" requires at least one completion photo.',
          'critical',
          'completionPhotos',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const ticketId = readString(req.payload, ['ticketId']) ?? '(missing)';
    const resolution = readString(req.payload, ['resolutionCode']) ?? '(missing)';
    return [
      `You are reviewing the completion of maintenance ticket ${ticketId} for tenant ${req.context.tenantId}.`,
      `Resolution code: ${resolution}.`,
      `Decide whether the completion narrative matches the resolution code and the evidence supplied.`,
    ].join(' ');
  },
};
