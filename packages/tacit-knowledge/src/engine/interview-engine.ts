/**
 * Interview engine.
 *
 * Wave HARVEST. Orchestrates one harvest session end-to-end:
 *
 *   1. `start()`     — open a row in `tacit_interviews` after a
 *                      consent check.
 *   2. `appendTurn()` — append a transcript turn (Mr. Mwikila or
 *                      subject). When the buffer hits the chunk
 *                      size, run the extractor → redundancy check →
 *                      cell write pipeline.
 *   3. `complete()`  — close the session (status flip).
 *
 * Consent revocation during a running session is honoured before the
 * next extraction call — the engine short-circuits, marks the
 * interview `ended_revoked`, and refuses to persist further drafts.
 *
 * Every persisted extraction is written into the `tacit_extractions`
 * repository **and** into cognitive-memory via the
 * `CognitiveMemorySink` port. Provenance (subjectUserId, mode, at,
 * place, interviewId) is attached on the way through.
 */

import { randomUUID } from 'node:crypto';

import {
  TacitKnowledgeError,
  type Extraction,
  type Interview,
  type StartInterviewInput,
  type TacitExtractionRepository,
  type TacitInterviewRepository,
  type TranscriptTurn,
  type EntityExtractor,
  type ExtractionDraft,
} from '../types.js';
import { GENESIS_HASH, computeTacitAuditHash } from '../audit/audit-chain-link.js';
import type { ConsentManager } from '../consent/consent-manager.js';
import type {
  RedundancyChecker,
  RedundancyDecision,
} from '../consolidator/redundancy-checker.js';
import type { CellWriter } from '../consolidator/cell-writer.js';
import { getModeTemplate } from '../modes/mode-registry.js';

export interface InterviewEngineDeps {
  readonly interviewRepo: TacitInterviewRepository;
  readonly extractionRepo: TacitExtractionRepository;
  readonly consent: ConsentManager;
  readonly extractor: EntityExtractor;
  readonly redundancy: RedundancyChecker;
  readonly cellWriter: CellWriter;
  readonly now: () => Date;
  readonly chunkSize: number;
}

export interface InterviewEngine {
  start(input: StartInterviewInput): Promise<Interview>;
  appendTurn(input: {
    readonly interviewId: string;
    readonly tenantId: string;
    readonly turn: TranscriptTurn;
  }): Promise<EngineTurnResult>;
  complete(input: {
    readonly interviewId: string;
    readonly tenantId: string;
  }): Promise<Interview>;
}

export interface EngineTurnResult {
  readonly interview: Interview;
  readonly extractionsPersisted: ReadonlyArray<Extraction>;
  readonly extractionsDropped: ReadonlyArray<ExtractionDraft>;
}

export function createInterviewEngine(deps: InterviewEngineDeps): InterviewEngine {
  return {
    async start(input: StartInterviewInput): Promise<Interview> {
      const granted = await deps.consent.isGranted(
        input.subjectUserId,
        input.tenantId,
      );
      if (!granted) {
        throw new TacitKnowledgeError(
          'TACIT_CONSENT_MISSING',
          'Subject has not granted consent for harvest sessions',
          { subjectUserId: input.subjectUserId, tenantId: input.tenantId },
        );
      }
      // Validate the mode shape exists (also locks the template).
      getModeTemplate(input.mode);

      const id = randomUUID();
      const startedAt = deps.now().toISOString();
      const prevHash = GENESIS_HASH;
      const auditHash = computeTacitAuditHash(
        {
          kind: 'interview.start',
          id,
          tenantId: input.tenantId,
          subjectUserId: input.subjectUserId,
          mode: input.mode,
          startedAt,
        },
        prevHash,
      );

      const row: Interview = {
        id,
        tenantId: input.tenantId,
        subjectUserId: input.subjectUserId,
        interviewer: input.interviewer ?? 'mr-mwikila',
        mode: input.mode,
        startedAt,
        endedAt: null,
        status: 'running',
        transcript: [],
        locationGeog: input.locationGeog ?? null,
        auditHash,
        prevHash,
      };
      return deps.interviewRepo.insert(row);
    },

    async appendTurn(input): Promise<EngineTurnResult> {
      const interview = await deps.interviewRepo.read(
        input.interviewId,
        input.tenantId,
      );
      if (interview === null) {
        throw new TacitKnowledgeError(
          'TACIT_INTERVIEW_NOT_FOUND',
          'Interview not found',
          { interviewId: input.interviewId, tenantId: input.tenantId },
        );
      }
      if (interview.status !== 'running') {
        throw new TacitKnowledgeError(
          'TACIT_INTERVIEW_CLOSED',
          'Cannot append a turn to a non-running interview',
          { interviewId: input.interviewId, status: interview.status },
        );
      }

      const updated = await deps.interviewRepo.appendTurn(
        interview.id,
        interview.tenantId,
        input.turn,
      );
      if (updated === null) {
        throw new TacitKnowledgeError(
          'TACIT_APPEND_FAILED',
          'appendTurn returned null',
          { interviewId: interview.id },
        );
      }

      // Only run extraction when buffer reaches chunk size and
      // current turn is a subject utterance. Skips Mr. Mwikila's own
      // utterances — only subject content yields know-how.
      if (
        input.turn.speaker !== 'subject' ||
        updated.transcript.length < deps.chunkSize
      ) {
        return Object.freeze({
          interview: updated,
          extractionsPersisted: Object.freeze([]),
          extractionsDropped: Object.freeze([]),
        });
      }

      // Pre-check consent before running any persistence work. If
      // revoked mid-session, mark the interview ended_revoked and
      // bail out before extractor + sink calls.
      const granted = await deps.consent.isGranted(
        updated.subjectUserId,
        updated.tenantId,
      );
      if (!granted) {
        const endedAt = deps.now().toISOString();
        const flipped = await deps.interviewRepo.setStatus(
          updated.id,
          updated.tenantId,
          'ended_revoked',
          endedAt,
        );
        return Object.freeze({
          interview: flipped ?? updated,
          extractionsPersisted: Object.freeze([]),
          extractionsDropped: Object.freeze([]),
        });
      }

      // Run extractor over the last `chunkSize` turns.
      const chunk = updated.transcript.slice(-deps.chunkSize);
      const drafts = await deps.extractor.extract({
        tenantId: updated.tenantId,
        mode: updated.mode,
        chunk,
      });

      const persisted: Extraction[] = [];
      const dropped: ExtractionDraft[] = [];

      for (const draft of drafts) {
        const decision: RedundancyDecision = await deps.redundancy.check({
          tenantId: updated.tenantId,
          draft,
        });

        const write = await deps.cellWriter.write({
          interview: updated,
          draft,
          decision,
          at: input.turn.at,
          place: input.turn.gps ?? updated.locationGeog,
        });

        const exId = randomUUID();
        const createdAt = deps.now().toISOString();
        const auditHash = computeTacitAuditHash({
          kind: 'extraction.insert',
          extractionId: exId,
          interviewId: updated.id,
          tenantId: updated.tenantId,
          entityKind: draft.entityKind,
          createdAt,
        });

        const extraction: Extraction = {
          id: exId,
          interviewId: updated.id,
          tenantId: updated.tenantId,
          entityKind: draft.entityKind,
          entity: draft.entity,
          confidence: draft.confidence,
          novel: decision.kind === 'novel',
          redundantWithCellId:
            decision.kind === 'redundant' ? decision.cellId : null,
          persistedCellId: write.cellId,
          createdAt,
          auditHash,
        };
        await deps.extractionRepo.insert(extraction);
        persisted.push(extraction);
      }

      return Object.freeze({
        interview: updated,
        extractionsPersisted: Object.freeze(persisted),
        extractionsDropped: Object.freeze(dropped),
      });
    },

    async complete(input): Promise<Interview> {
      const endedAt = deps.now().toISOString();
      const updated = await deps.interviewRepo.setStatus(
        input.interviewId,
        input.tenantId,
        'ended_ok',
        endedAt,
      );
      if (updated === null) {
        throw new TacitKnowledgeError(
          'TACIT_INTERVIEW_NOT_FOUND',
          'Interview not found for completion',
          { interviewId: input.interviewId },
        );
      }
      return updated;
    },
  };
}

export const DEFAULT_CHUNK_SIZE = 2;
