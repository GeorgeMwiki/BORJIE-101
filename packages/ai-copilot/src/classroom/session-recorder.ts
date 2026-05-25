/**
 * Session recorder (Wave 11).
 *
 * Captures a classroom transcript (text turns + audio references) so the
 * session can be replayed later or persisted for audit.
 *
 * Audio is NOT stored inline — only a reference (URL / storage key). The
 * voice module is responsible for uploading the blob; this recorder just
 * tracks which turn maps to which asset.
 *
 * Pure in-memory state — integrates with the router / persistence layer
 * that writes rows via the migrations below.
 */

export interface TranscriptEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly participantId: string;
  readonly role: 'instructor' | 'learner' | 'ai_professor';
  readonly text: string;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly audioRef?: string; // storage URL / key
  readonly occurredAt: string;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly entries: readonly TranscriptEntry[];
}

export interface SessionRecorder {
  readonly record: SessionRecord;
  append(
    entry: Omit<TranscriptEntry, 'id' | 'sessionId' | 'occurredAt'>
  ): SessionRecorder;
  serializeForAudit(): string;
}

export interface RecorderDeps {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly idGenerator?: () => string;
  readonly now?: () => Date;
}

export function createSessionRecorder(deps: RecorderDeps): SessionRecorder {
  const genId =
    deps.idGenerator ?? (() => `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const now = deps.now ?? (() => new Date());

  return makeRecorder({
    sessionId: deps.sessionId,
    tenantId: deps.tenantId,
    entries: [],
  });

  function makeRecorder(record: SessionRecord): SessionRecorder {
    return {
      record,
      append(partial) {
        const entry: TranscriptEntry = {
          id: genId(),
          sessionId: record.sessionId,
          participantId: partial.participantId,
          role: partial.role,
          text: partial.text,
          language: partial.language,
          audioRef: partial.audioRef,
          occurredAt: now().toISOString(),
        };
        const next = {
          ...record,
          entries: [...record.entries, entry],
        };
        return makeRecorder(next);
      },
      serializeForAudit() {
        return JSON.stringify(record, null, 2);
      },
    };
  }
}
