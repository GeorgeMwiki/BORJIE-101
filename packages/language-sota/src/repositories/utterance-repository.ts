/**
 * `language_utterances` repository.
 *
 * In-memory implementation. The SQL-backed adapter ships in the
 * database package (Wave 19G SQL adapter — Drizzle on the schema
 * created by migration 0048). Both implementations conform to
 * `UtteranceRepository` from `../types.ts`.
 *
 * Immutability: rows are frozen on insert; state transitions return a
 * fresh object every time.
 *
 * Consent gate: writes whose `consentState` field is not one of the
 * four legal states return `null` — the caller is expected to log the
 * silent drop. This is the FOUNDER_LOCKED §3 + §4 enforcement boundary.
 */

import { randomUUID } from 'node:crypto';

import {
  CONSENT_STATES,
  type ClockPort,
  type Utterance,
  type UtteranceRepository,
} from '../types.js';
import {
  GENESIS_HASH,
  computeUtteranceAuditHash,
} from '../audit/audit-chain-link.js';

export interface InMemoryUtteranceRepoDeps {
  readonly clock?: ClockPort;
}

export function createInMemoryUtteranceRepository(
  deps: InMemoryUtteranceRepoDeps = {},
): UtteranceRepository {
  const clock: ClockPort = deps.clock ?? { now: () => new Date() };
  const rows = new Map<string, Utterance>();
  /** Per-tenant chain head — the last utterance row's auditHash. */
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async recordUtterance(input) {
      if (!CONSENT_STATES.includes(input.consentState)) {
        return null;
      }
      const id = randomUUID();
      const recordedAt = clock.now();
      const prevHash = head(input.tenantId);
      const auditHash = computeUtteranceAuditHash(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          channel: input.channel,
          sourceLang: input.sourceLang,
          detectedLang: input.detectedLang,
          text: input.text,
          recordedAtIso: recordedAt.toISOString(),
          consentState: input.consentState,
        },
        prevHash,
      );
      const row: Utterance = Object.freeze({
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        channel: input.channel,
        sourceLang: input.sourceLang,
        detectedLang: input.detectedLang,
        text: input.text,
        phonemes: Object.freeze([...input.phonemes]),
        prosody: Object.freeze({
          ...input.prosody,
          f0Contour: Object.freeze([...input.prosody.f0Contour]),
          stressBins: Object.freeze([...input.prosody.stressBins]),
        }),
        codeswitchSegments: Object.freeze([...input.codeswitchSegments]),
        confidence: input.confidence,
        provider: input.provider,
        consentState: input.consentState,
        recordedAt,
        auditHash,
        prevHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async listRecentForTenant(tenantId, limit) {
      return collectRecent(rows, (r) => r.tenantId === tenantId, limit);
    },

    async listRecentForUser(tenantId, userId, limit) {
      return collectRecent(
        rows,
        (r) => r.tenantId === tenantId && r.userId === userId,
        limit,
      );
    },
  };
}

function collectRecent(
  rows: Map<string, Utterance>,
  predicate: (r: Utterance) => boolean,
  limit: number,
): ReadonlyArray<Utterance> {
  const filtered: Utterance[] = [];
  for (const row of rows.values()) {
    if (predicate(row)) {
      filtered.push(row);
    }
  }
  filtered.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  return filtered.slice(0, Math.max(0, limit));
}

// =============================================================================
// SQL adapter — the row shape that a Drizzle-backed runtime will produce.
// =============================================================================

/**
 * Row shape returned by the Drizzle binding to `language_utterances`.
 * The SQL adapter consumed by the host app is defined in
 * `packages/database` (not in this package, to avoid drizzle-orm as a
 * runtime dep here). This interface documents the conversion contract.
 */
export interface UtteranceSqlRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly channel: string;
  readonly source_lang: string;
  readonly detected_lang: string;
  readonly text: string;
  readonly phonemes: unknown;
  readonly prosody: unknown;
  readonly codeswitch_segments: unknown;
  readonly confidence: number;
  readonly provider: string | null;
  readonly consent_state: string;
  readonly recorded_at: Date;
  readonly audit_hash: string;
  readonly prev_hash: string;
}
