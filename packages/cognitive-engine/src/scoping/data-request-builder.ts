/**
 * Data-request builder — Discipline 4, stage 2.
 *
 * Produces `DataRequest` chips proposed to the owner when the
 * sufficiency check identifies a missing critical data join. Pure
 * function; the runtime owns surfacing the chip.
 *
 * @module @borjie/cognitive-engine/scoping/data-request-builder
 */

import type { DataRequest, DataRequestKind, IngestKind } from '../types.js';

export interface BuildDataRequestInput {
  readonly missing_kind: 'corpus' | 'data_join' | 'research_artifact' | 'ingest' | 'ui_state';
  readonly intent: string;
  readonly preferred_data_kind?: IngestKind;
}

/** Map missing-evidence kinds to default request kinds + descriptions. */
export function buildDataRequest(
  input: BuildDataRequestInput,
): DataRequest {
  const kind: DataRequestKind =
    input.preferred_data_kind ?? defaultKind(input.missing_kind);
  return {
    kind,
    description: describe(input),
    required: input.missing_kind === 'data_join' || input.missing_kind === 'ingest',
    why_needed: rationaleFor(input),
  };
}

function defaultKind(
  missing: BuildDataRequestInput['missing_kind'],
): DataRequestKind {
  switch (missing) {
    case 'ingest':
      return 'excel';
    case 'data_join':
      return 'csv';
    case 'research_artifact':
      return 'manual_form';
    case 'corpus':
      return 'pdf';
    case 'ui_state':
      return 'manual_form';
    default:
      return 'manual_form';
  }
}

function describe(input: BuildDataRequestInput): string {
  const what = (() => {
    switch (input.missing_kind) {
      case 'ingest':
        return 'a relevant data file (Excel or CSV) for this intent';
      case 'data_join':
        return 'the underlying table or join the question depends on';
      case 'research_artifact':
        return 'an external reference (PDF, URL, or scan) supporting the claim';
      case 'corpus':
        return 'a corpus document that codifies the policy or rule';
      case 'ui_state':
        return 'a screenshot or note describing what you are looking at';
      default:
        return 'additional context';
    }
  })();
  return `Please share ${what} so I can act on "${truncate(input.intent, 80)}".`;
}

function rationaleFor(input: BuildDataRequestInput): string {
  switch (input.missing_kind) {
    case 'ingest':
      return 'No relevant ingest is attached to this session — I need the data to compose.';
    case 'data_join':
      return 'The required table is not yet joined to your workspace.';
    case 'research_artifact':
      return 'I need a primary source to cite — without it I cannot ground the claim.';
    case 'corpus':
      return 'No corpus rule matches this intent — please upload the source policy.';
    case 'ui_state':
      return 'I cannot see the surface you are referencing; a screenshot helps.';
    default:
      return 'Additional context is required to act safely.';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
