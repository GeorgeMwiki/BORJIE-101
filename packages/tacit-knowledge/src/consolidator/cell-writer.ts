/**
 * Cell writer.
 *
 * Wave HARVEST. Consumes a `RedundancyDecision` + an `ExtractionDraft`
 * and writes into the cognitive-memory store via the
 * `CognitiveMemorySink` port (the package never imports the
 * cognitive-memory package directly — the host wires the production
 * sink). Always emits a `{ cellId }` for the extraction repository to
 * attach via `setPersisted`.
 *
 * For `novel` decisions: calls `sink.observe`.
 * For `redundant` decisions: calls `sink.reinforce` with a small
 * configurable confidence delta.
 */

import type {
  CognitiveMemorySink,
  ExtractionDraft,
  GeoPoint,
  Interview,
} from '../types.js';
import { REINFORCE_CONFIDENCE_DELTA } from '../types.js';
import type { RedundancyDecision } from './redundancy-checker.js';

export interface CellWriter {
  write(input: {
    readonly interview: Interview;
    readonly draft: ExtractionDraft;
    readonly decision: RedundancyDecision;
    readonly at: string; // ISO timestamp of the utterance
    readonly place: GeoPoint | null;
  }): Promise<{ readonly cellId: string }>;
}

export function createCellWriter(
  sink: CognitiveMemorySink,
): CellWriter {
  return {
    async write(input) {
      if (input.decision.kind === 'novel') {
        return sink.observe({
          tenantId: input.interview.tenantId,
          subjectUserId: input.interview.subjectUserId,
          interviewId: input.interview.id,
          mode: input.interview.mode,
          entityKind: input.draft.entityKind,
          entity: input.draft.entity,
          confidence: input.draft.confidence,
          at: input.at,
          place: input.place,
        });
      }
      return sink.reinforce({
        tenantId: input.interview.tenantId,
        cellId: input.decision.cellId,
        interviewId: input.interview.id,
        additionalConfidence: REINFORCE_CONFIDENCE_DELTA,
      });
    },
  };
}
