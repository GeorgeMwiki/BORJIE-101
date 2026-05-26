/**
 * Voice-turn log — Drizzle-backed adapter for the `voice_turns` table
 * (migration 0110). Adapts to the voice-agent's `VoiceTurnRepository`
 * port at the api-gateway / agent-platform composition root.
 *
 * The port is duck-typed (consumer-side `VoiceTurnRepository` lives in
 * `@borjie/ai-copilot/ai-native/voice-agent/types.ts`) so this
 * service does not compile-time-depend on ai-copilot.
 *
 * Hard DB failures degrade gracefully:
 *   - insert        : logs + rethrows so the agent can record degraded mode
 *   - countBySession: returns 0 on error (the agent uses 0-indexed turns)
 *   - list          : returns [] on error
 */

import { and, asc, count, eq } from 'drizzle-orm';
import { voiceTurns } from '../schemas/voice-turns.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export interface VoiceToolCallShape {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export interface VoiceTurnRowShape {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly customerId: string | null;
  readonly detectedLanguage: string;
  readonly inputTranscript: string;
  readonly responseText: string;
  readonly responseAudioRef: string | null;
  readonly toolCalls: ReadonlyArray<VoiceToolCallShape>;
  readonly degradedMode: boolean;
  readonly modelVersion: string | null;
  readonly promptHash: string | null;
  readonly latencyMs: number | null;
  readonly createdAt: string;
}

export interface VoiceTurnsService {
  insert(row: VoiceTurnRowShape): Promise<VoiceTurnRowShape>;
  countBySession(tenantId: string, sessionId: string): Promise<number>;
  list(
    tenantId: string,
    sessionId: string,
  ): Promise<ReadonlyArray<VoiceTurnRowShape>>;
}

export function createVoiceTurnsService(db: DatabaseClient): VoiceTurnsService {
  return {
    async insert(row) {
      if (!row.tenantId || !row.sessionId || !row.id) {
        throw new Error(
          'voice-turns.insert requires tenantId, sessionId, and id',
        );
      }
      try {
        await db.insert(voiceTurns).values({
          id: row.id,
          tenantId: row.tenantId,
          sessionId: row.sessionId,
          customerId: row.customerId,
          turnIndex: row.turnIndex,
          detectedLanguage: row.detectedLanguage,
          inputTranscript: row.inputTranscript,
          responseText: row.responseText,
          responseAudioRef: row.responseAudioRef,
          toolCalls: row.toolCalls as unknown as Record<string, unknown>[],
          degradedMode: row.degradedMode,
          modelVersion: row.modelVersion,
          promptHash: row.promptHash,
          latencyMs: row.latencyMs,
          createdAt: new Date(row.createdAt),
        } as never);
        return row;
      } catch (error) {
        logger.error('voice-turns.insert failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('voice-turns.insert failed');
      }
    },

    async countBySession(tenantId, sessionId) {
      try {
        if (!tenantId || !sessionId) return 0;
        const result = (await db
          .select({ value: count() })
          .from(voiceTurns)
          .where(
            and(
              eq(voiceTurns.tenantId, tenantId),
              eq(voiceTurns.sessionId, sessionId),
            ),
          )) as ReadonlyArray<{ value: number }>;
        return Number(result?.[0]?.value ?? 0);
      } catch (error) {
        logger.error('voice-turns.countBySession failed', { error: error });
        return 0;
      }
    },

    async list(tenantId, sessionId) {
      try {
        if (!tenantId || !sessionId) return [];
        const rows = (await db
          .select()
          .from(voiceTurns)
          .where(
            and(
              eq(voiceTurns.tenantId, tenantId),
              eq(voiceTurns.sessionId, sessionId),
            ),
          )
          .orderBy(asc(voiceTurns.turnIndex))) as ReadonlyArray<VoiceTurnRowDb>;
        return rows.map(rowToShape);
      } catch (error) {
        logger.error('voice-turns.list failed', { error: error });
        return [];
      }
    },
  };
}

interface VoiceTurnRowDb {
  id: string;
  tenantId: string;
  sessionId: string;
  customerId: string | null;
  turnIndex: number;
  detectedLanguage: string | null;
  inputTranscript: string | null;
  responseText: string | null;
  responseAudioRef: string | null;
  toolCalls: unknown;
  degradedMode: boolean | null;
  modelVersion: string | null;
  promptHash: string | null;
  latencyMs: number | null;
  createdAt: Date | string;
}

function rowToShape(row: VoiceTurnRowDb): VoiceTurnRowShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    customerId: row.customerId,
    turnIndex: row.turnIndex,
    detectedLanguage: row.detectedLanguage ?? '',
    inputTranscript: row.inputTranscript ?? '',
    responseText: row.responseText ?? '',
    responseAudioRef: row.responseAudioRef,
    toolCalls: parseToolCalls(row.toolCalls),
    degradedMode: row.degradedMode ?? false,
    modelVersion: row.modelVersion,
    promptHash: row.promptHash,
    latencyMs: row.latencyMs,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

function parseToolCalls(raw: unknown): ReadonlyArray<VoiceToolCallShape> {
  if (!Array.isArray(raw)) return [];
  const out: VoiceToolCallShape[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : '';
    if (!name) continue;
    const args =
      obj.arguments && typeof obj.arguments === 'object'
        ? (obj.arguments as Record<string, unknown>)
        : {};
    const result =
      obj.result && typeof obj.result === 'object'
        ? (obj.result as Record<string, unknown>)
        : undefined;
    const error = typeof obj.error === 'string' ? obj.error : undefined;
    out.push({
      name,
      arguments: args,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }
  return out;
}

export { voiceTurns };
