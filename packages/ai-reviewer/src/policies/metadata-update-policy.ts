/**
 * Metadata-update policy.
 *
 * Updates to descriptive metadata (tags, notes, classifications) on an
 * entity. Pre-checks enforce shape and tag hygiene; red-lines block
 * destructive bulk-clears and tag namespaces that would collide with
 * system-reserved keys.
 */

import type { PolicyRule, ValidationIssue } from '../types.js';
import { issue, readArray, readString } from './_helpers.js';

const RESERVED_TAG_PREFIXES = ['system:', 'audit:', 'internal:'] as const;

export const metadataUpdatePolicy: PolicyRule<Readonly<Record<string, unknown>>> = {
  kind: 'metadata_update',

  preChecks(req) {
    const issues: ValidationIssue[] = [];
    const entityId = readString(req.payload, ['entityId']);
    if (!entityId) {
      issues.push(
        issue(
          'metadata.entity.missing',
          'entityId is required for a metadata update.',
          'error',
          'entityId',
        ),
      );
    }
    const tagsToAdd = readArray(req.payload, ['tagsToAdd']) ?? [];
    for (let i = 0; i < tagsToAdd.length; i += 1) {
      const tag = tagsToAdd[i];
      if (typeof tag !== 'string' || tag.length === 0) {
        issues.push(
          issue(
            'metadata.tag.invalid',
            `Tag at index ${i} is not a non-empty string.`,
            'error',
            `tagsToAdd[${i}]`,
          ),
        );
      }
    }
    return issues;
  },

  redLines(req) {
    const redLines: ValidationIssue[] = [];
    const tagsToAdd = readArray(req.payload, ['tagsToAdd']) ?? [];
    for (let i = 0; i < tagsToAdd.length; i += 1) {
      const tag = tagsToAdd[i];
      if (typeof tag !== 'string') continue;
      if (RESERVED_TAG_PREFIXES.some((p) => tag.startsWith(p))) {
        redLines.push(
          issue(
            'metadata.tag.reserved_prefix',
            `Tag "${tag}" uses a reserved prefix (${RESERVED_TAG_PREFIXES.join(
              ', ',
            )}); user-defined tags cannot use these.`,
            'critical',
            `tagsToAdd[${i}]`,
          ),
        );
      }
    }
    const clearAll = req.payload['clearAllTags'] === true;
    const hasConfirmation = readString(req.payload, ['confirmationToken']);
    if (clearAll && !hasConfirmation) {
      redLines.push(
        issue(
          'metadata.clear_all.requires_confirmation',
          'Bulk-clear of all tags requires a confirmation token; aborting.',
          'critical',
          'clearAllTags',
        ),
      );
    }
    return redLines;
  },

  brainPrompt(req) {
    const entityId = readString(req.payload, ['entityId']) ?? '(missing)';
    const tagsToAdd = readArray(req.payload, ['tagsToAdd']) ?? [];
    const tagsToRemove = readArray(req.payload, ['tagsToRemove']) ?? [];
    return [
      `You are reviewing a metadata update on entity ${entityId} for tenant ${req.context.tenantId}.`,
      `Tags to add: ${tagsToAdd.length}. Tags to remove: ${tagsToRemove.length}.`,
      `Verify the change does not break downstream filters or reports the team relies on.`,
    ].join(' ');
  },
};
