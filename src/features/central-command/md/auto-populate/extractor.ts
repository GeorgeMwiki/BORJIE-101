/**
 * Auto-Populate — Entity Extractor
 *
 * Given a single chat turn plus optional recent-conversation context,
 * call the Claude sensor with a structured-output prompt and return a
 * validated `ExtractedEntity[]`.
 *
 * Design notes:
 *   - We use the standard `chat()` channel with an explicit
 *     "respond with a JSON array, no prose" instruction, then parse +
 *     Zod-validate. The Anthropic tool-use channel is overkill for an
 *     append-only sensor: we don't need the model to "act", only to
 *     emit typed JSON.
 *   - We never throw on extractor failure — the caller (MD core) must
 *     still answer the owner. We log + return [] instead.
 *   - The system prompt is cache-eligible (long, mostly static) so
 *     subsequent turns within a session pay ~10% of the prefix cost.
 *   - We bound the user-message size to keep the prompt cheap; the
 *     extractor only needs the latest turn + the trailing 6 messages.
 */

import { z } from "zod";
import { getClaudeService } from "@/core/ai/claude-service";
import { createLogger } from "@/lib/logger";
import {
  ALL_ENTITY_KINDS,
  canonicaliseName,
  extractedEntitySchema,
  type ExtractedEntity,
  type EntityKind,
  type SourceSpan,
} from "./entity-types";

const log = createLogger("md.auto-populate.extractor");

/**
 * Coerce an unknown caught value into a JSON-serialisable shape so the
 * structured logger can accept it. Borjie's `createLogger` expects a
 * `LogContext` (plain object), unlike Kaboni's which auto-normalises.
 */
function errorToLogValue(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/** Maximum entities we will accept from a single turn. */
const MAX_ENTITIES_PER_TURN = 12;

/** Maximum characters of the live turn text we forward to the LLM. */
const MAX_TURN_CHARS = 4000;

/** Maximum trailing context messages forwarded with the turn. */
const MAX_CONTEXT_MESSAGES = 6;

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface ContextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ExtractorInput {
  /** The turn text we just received from the owner. */
  readonly text: string;
  /** Trailing N messages from the conversation (most recent last). */
  readonly recentMessages?: ReadonlyArray<ContextMessage>;
  /** Override the model for cheap/expensive trade-offs. */
  readonly model?: string;
}

export interface ExtractorResult {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly rawResponse: string | null;
  readonly parseError: string | null;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are the silent observer for an SMB owner. The owner is chatting freely with their AI Managing Director.",
  "Your ONLY job is to extract structured business entities the owner mentions in passing.",
  "",
  "RULES:",
  "1. Return a JSON array of entity objects. No prose, no preamble, no markdown fences.",
  `2. Each entity MUST have one of these "kind" values: ${ALL_ENTITY_KINDS.join(", ")}.`,
  "3. Required fields: kind, canonicalName, displayName, confidence (0..1), sourceSpan ({start, end, text}).",
  "4. canonicalName: lowercase, no punctuation, no corporate suffixes (Ltd, Inc, etc).",
  "5. displayName: the human-facing name as the owner phrased it.",
  "6. sourceSpan.start/end: zero-indexed character offsets into the LATEST turn text.",
  "7. sourceSpan.text: the exact substring that produced this entity.",
  "8. confidence: how sure you are this is a real, durable entity (0 = guess, 1 = explicit).",
  "9. Only extract entities the owner CONFIRMED or STATED. Do not extract hypotheticals, questions, or AI replies.",
  `10. Maximum ${MAX_ENTITIES_PER_TURN} entities per turn. If more, return the most salient ${MAX_ENTITIES_PER_TURN}.`,
  "11. If nothing is extractable, return [].",
  "",
  'EXAMPLE owner text: "We just signed Acme Corp for $50k ARR, and our top SKU is the X-200."',
  "EXAMPLE response: [",
  '  {"kind":"customer","canonicalName":"acme","displayName":"Acme Corp","confidence":0.95,"sourceSpan":{"start":15,"end":24,"text":"Acme Corp"},"arrUsd":50000,"status":"active"},',
  '  {"kind":"product","canonicalName":"x 200","displayName":"X-200","confidence":0.9,"sourceSpan":{"start":53,"end":58,"text":"X-200"},"isTopSeller":true}',
  "]",
  "",
  "Return ONLY the JSON array.",
].join("\n");

function buildUserPrompt(input: ExtractorInput): string {
  const recent = (input.recentMessages ?? [])
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 600)}`)
    .join("\n");

  const turn = input.text.slice(0, MAX_TURN_CHARS);

  return [
    recent ? `RECENT CONTEXT:\n${recent}\n` : "",
    "LATEST TURN (extract entities from this text only):",
    turn,
    "",
    "Return the JSON array now.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Best-effort JSON-array extraction from a possibly-wrapped LLM response. */
function extractJsonArray(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const match = trimmed.match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

const rawArraySchema = z.array(z.record(z.string(), z.unknown()));

/**
 * Patch missing `canonicalName` and ensure `sourceSpan` fields exist before
 * Zod validation. The LLM occasionally drops canonicalName even when asked
 * to include it — we derive it from displayName as a safe default.
 */
function normaliseRawEntity(
  raw: Record<string, unknown>,
  turnText: string,
): Record<string, unknown> {
  const display = typeof raw.displayName === "string" ? raw.displayName : "";
  const canonical =
    typeof raw.canonicalName === "string" && raw.canonicalName.length > 0
      ? raw.canonicalName
      : canonicaliseName(display);

  const span = raw.sourceSpan as Partial<SourceSpan> | undefined;
  const safeSpan: SourceSpan = {
    start: Math.max(
      0,
      Number.isFinite(span?.start as number) ? Number(span?.start) : 0,
    ),
    end: Math.max(
      1,
      Number.isFinite(span?.end as number)
        ? Number(span?.end)
        : Math.min(1, turnText.length),
    ),
    text:
      typeof span?.text === "string" && span.text.length > 0
        ? span.text.slice(0, 800)
        : display.slice(0, 800) || turnText.slice(0, 64) || "(unknown)",
  };

  return {
    ...raw,
    canonicalName: canonical || "unknown",
    displayName: display || "unknown",
    sourceSpan: safeSpan,
  };
}

function parseEntities(
  raw: string,
  turnText: string,
): {
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly error: string | null;
} {
  const arrayText = extractJsonArray(raw);
  if (!arrayText) {
    return { entities: [], error: "no JSON array found in response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch (err) {
    return {
      entities: [],
      error: `JSON.parse failed: ${(err as Error).message}`,
    };
  }

  const arr = rawArraySchema.safeParse(parsed);
  if (!arr.success) {
    return { entities: [], error: "response was not an array of objects" };
  }

  const accepted: ExtractedEntity[] = [];
  for (const candidate of arr.data.slice(0, MAX_ENTITIES_PER_TURN)) {
    const normalised = normaliseRawEntity(candidate, turnText);
    const validated = extractedEntitySchema.safeParse(normalised);
    if (validated.success) {
      accepted.push(validated.data);
    } else {
      log.debug("dropping invalid entity", {
        issues: validated.error.issues,
        kind: normalised.kind,
      });
    }
  }

  return { entities: accepted, error: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract structured entities from a chat turn. Never throws; on any
 * failure returns an empty entity list plus a parseError string for
 * the audit trail.
 */
export async function extractEntities(
  input: ExtractorInput,
): Promise<ExtractorResult> {
  if (!input.text || !input.text.trim()) {
    return { entities: [], rawResponse: null, parseError: null };
  }

  const claude = getClaudeService({ modelTier: "fast" });
  if (!claude.isConfigured) {
    log.warn("claude service unconfigured — auto-populate disabled this turn");
    return {
      entities: [],
      rawResponse: null,
      parseError: "claude unconfigured",
    };
  }

  const userPrompt = buildUserPrompt(input);

  let raw = "";
  try {
    raw = await claude.chat(
      [{ role: "user", content: userPrompt }],
      SYSTEM_PROMPT,
      {
        cacheSystemPrompt: true,
        temperature: 0,
        maxTokens: 2048,
        model: input.model,
      },
    );
  } catch (err) {
    log.error("claude.chat failed", { error: errorToLogValue(err) });
    return {
      entities: [],
      rawResponse: null,
      parseError: `claude.chat threw: ${(err as Error).message}`,
    };
  }

  const { entities, error } = parseEntities(raw, input.text);
  if (error) {
    log.warn("entity parse failed", { error });
  }

  return { entities, rawResponse: raw, parseError: error };
}

/**
 * Pure variant for testing — parse a JSON-array string directly with no LLM
 * round-trip. Mirrors what `extractEntities` does internally so unit tests
 * can assert behaviour against fixed strings.
 */
export function parseEntitiesFromRaw(
  raw: string,
  turnText: string,
): ExtractorResult {
  const { entities, error } = parseEntities(raw, turnText);
  return { entities, rawResponse: raw, parseError: error };
}

/** Cheap typeguard: does this kind appear in our discriminated union? */
export function isKnownEntityKind(k: string): k is EntityKind {
  return (ALL_ENTITY_KINDS as ReadonlyArray<string>).includes(k);
}
