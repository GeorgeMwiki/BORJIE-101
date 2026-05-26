/**
 * Junior Input Synthesizer
 *
 * Given a chat message, mode, tenant id, optional LMBM context, and a
 * junior's Zod input schema, ask Claude Haiku to generate a JSON object
 * that satisfies the schema. On Zod validation failure we retry once with
 * the error string appended to the prompt; on a second failure we return
 * a structured `SynthesisFailure` so the executor can record the miss and
 * keep dispatching the rest of the plan.
 *
 * Why Haiku: the synthesizer's job is mechanical schema-coercion of
 * narrative chat text. We do NOT want it making domain decisions — that
 * is the junior's job downstream. Haiku is cheap, fast, and adequate.
 *
 * Why no mock fallback: per the recent "strip the mock fallback"
 * directive, if `ANTHROPIC_API_KEY` is missing the executor aborts with
 * a `BorjieConfigError` before ever reaching this module. The
 * synthesizer ONLY runs in a real-LLM context.
 */

import { z, type ZodSchema } from 'zod';
import {
  parseClaudeJson,
  type ClaudeClient,
  type JuniorLogger,
} from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SynthesisContext {
  readonly junior_name: string;
  readonly chat_message: string;
  readonly mode: string;
  readonly tenantId: string;
  readonly lmbm_context: Readonly<Record<string, unknown>>;
}

export interface SynthesisSuccess<T> {
  readonly ok: true;
  readonly input: T;
}

export interface SynthesisFailure {
  readonly ok: false;
  readonly reason: string;
  readonly attempts: number;
}

export type SynthesisResult<T> = SynthesisSuccess<T> | SynthesisFailure;

export interface SynthesizeArgs<TSchema extends ZodSchema> {
  readonly claude: ClaudeClient;
  readonly schema: TSchema;
  readonly context: SynthesisContext;
  readonly logger?: JuniorLogger | undefined;
  readonly model?: string | undefined;
  readonly maxTokens?: number | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You are the Borjie Junior Input Synthesizer.',
  'Your ONLY job is to read a user chat message + a Zod schema and emit a',
  'single valid JSON object that satisfies the schema.',
  '',
  'Rules:',
  '1. Output STRICT JSON only — no prose, no markdown fences, no comments.',
  '2. Match the schema exactly. If a field is required but the chat',
  '   message does not contain that information, use a sensible neutral',
  '   default that the schema accepts (zero numbers, empty strings of the',
  '   minimum allowed length, empty arrays, today\'s ISO date, etc.).',
  '3. NEVER invent specific business facts (prices, tonnages, employee',
  '   ids, licence numbers). If the chat message did not supply them,',
  '   leave them at the neutral defaults described above.',
  '4. Always include the tenantId from the SYNTHESIS_CONTEXT verbatim',
  '   wherever the schema requires a tenant id.',
].join('\n');

function describeSchema(schema: ZodSchema): string {
  // Minimal schema dump: rely on Zod's internal `_def` representation
  // surfaced through JSON.stringify. Good enough for Haiku to infer the
  // shape; we are NOT trying to be a JSON Schema generator.
  try {
    return JSON.stringify(schema, replacer, 2).slice(0, 6000);
  } catch {
    return '<schema not introspectable>';
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map || value instanceof Set) return Array.from(value);
  if (typeof value === 'function') return undefined;
  return value;
}

function buildUserPrompt(
  ctx: SynthesisContext,
  schema: ZodSchema,
  priorError: string | null,
): string {
  const parts: string[] = [
    `JUNIOR: ${ctx.junior_name}`,
    `MODE: ${ctx.mode}`,
    `TENANT_ID: ${ctx.tenantId}`,
    `LMBM_CONTEXT_JSON: ${JSON.stringify(ctx.lmbm_context).slice(0, 2000)}`,
    `CHAT_MESSAGE:`,
    '"""',
    ctx.chat_message.slice(0, 4000),
    '"""',
    '',
    `ZOD_SCHEMA_INTROSPECTION:`,
    describeSchema(schema),
    '',
    'Reply with ONLY the JSON object satisfying the schema.',
  ];
  if (priorError) {
    parts.push(
      '',
      'PRIOR_VALIDATION_ERROR (fix this in your retry):',
      priorError.slice(0, 1500),
    );
  }
  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Synthesizer
// ─────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 2;

export async function synthesizeJuniorInput<TSchema extends ZodSchema>(
  args: SynthesizeArgs<TSchema>,
): Promise<SynthesisResult<z.infer<TSchema>>> {
  let priorError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let raw: string;
    try {
      const response = await args.claude.complete({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(args.context, args.schema, priorError),
        model: args.model ?? 'claude-haiku-4-5-20251001',
        maxTokens: args.maxTokens ?? 1200,
        temperature: 0,
      });
      raw = response.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      args.logger?.warn('synthesizer: claude call failed', {
        junior: args.context.junior_name,
        attempt,
        error: message,
      });
      return { ok: false, reason: `claude_call_failed: ${message}`, attempts: attempt };
    }

    const parsed = parseClaudeJson(raw);
    if (parsed.ok !== true) {
      const errString = (parsed as { ok: false; error: string }).error;
      priorError = `JSON parse error: ${errString}. Raw: ${raw.slice(0, 200)}`;
      args.logger?.warn('synthesizer: malformed JSON', {
        junior: args.context.junior_name,
        attempt,
      });
      continue;
    }

    const validation = args.schema.safeParse(parsed.value);
    if (validation.success) {
      return { ok: true, input: validation.data };
    }

    priorError = validation.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    args.logger?.warn('synthesizer: schema validation failed', {
      junior: args.context.junior_name,
      attempt,
      issues: priorError,
    });
  }

  return {
    ok: false,
    reason: `validation_failed_after_${MAX_ATTEMPTS}_attempts: ${priorError ?? 'unknown'}`,
    attempts: MAX_ATTEMPTS,
  };
}
