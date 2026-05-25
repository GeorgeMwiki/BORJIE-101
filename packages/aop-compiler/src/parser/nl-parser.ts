/**
 * Natural-language -> AOP AST parser.
 *
 * The parser delegates the heavy lifting (extracting structure from prose) to
 * an LLM via the injected `LLMRouter`. To keep the module testable without
 * spinning up a real LLM, the router contract is a plain interface (see
 * `types.ts`) — tests pass an in-memory stub.
 *
 * Hardening:
 *  - Strips markdown fences before JSON-parsing (defensive: LLMs love them).
 *  - Validates the parsed value against the Zod grammar.
 *  - Returns a structured error rather than throwing on malformed JSON.
 */

import type { AOP, LLMRouter, ValidationError } from '../types.js';
import { AOPSchema } from './grammar.js';
import { NL_TO_AST_SYSTEM_PROMPT, buildNLUserPrompt } from './prompts.js';

export interface ParseSuccess {
  readonly ok: true;
  readonly ast: AOP;
}

export interface ParseFailure {
  readonly ok: false;
  readonly errors: ReadonlyArray<ValidationError>;
}

export type ParseResult = ParseSuccess | ParseFailure;

const stripFences = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\n?/, '');
  return withoutOpening.replace(/```$/, '').trim();
};

const safeJsonParse = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(stripFences(raw)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export async function parseNL(
  naturalLanguageInput: string,
  llm: LLMRouter,
): Promise<ParseResult> {
  if (!naturalLanguageInput.trim()) {
    return {
      ok: false,
      errors: [{ code: 'empty-input', message: 'NL input is empty' }],
    };
  }

  const raw = await llm.complete({
    system: NL_TO_AST_SYSTEM_PROMPT,
    user: buildNLUserPrompt(naturalLanguageInput),
  });

  const json = safeJsonParse(raw);
  if (!json.ok) {
    return {
      ok: false,
      errors: [{ code: 'invalid-json', message: json.error }],
    };
  }

  const parsed = AOPSchema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
    };
  }

  return { ok: true, ast: parsed.data };
}

/** Idempotent re-parse from a JSON-encoded AST string (round-trip helper). */
export function parseAST(astJson: string): ParseResult {
  const json = safeJsonParse(astJson);
  if (!json.ok) {
    return {
      ok: false,
      errors: [{ code: 'invalid-json', message: json.error }],
    };
  }
  const parsed = AOPSchema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
    };
  }
  return { ok: true, ast: parsed.data };
}
