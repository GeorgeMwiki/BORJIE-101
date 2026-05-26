/**
 * Shared infrastructure for every Borjie mining junior under
 * `packages/ai-copilot/src/juniors/`.
 *
 * Centralises the three concerns every junior needs:
 *   1. Ports — typed contracts for Claude completion, Drizzle-like DB
 *      execution, and the structured logger.
 *   2. Lazy default adapters — wire ANTHROPIC_API_KEY + DATABASE_URL
 *      without forcing the junior file to import network code.
 *   3. Universal-envelope helpers — the AGENT_PROMPT_LIBRARY §0
 *      SYSTEM/MANDATE/TOOLS/EVIDENCE/OUTPUT_SCHEMA/CONFIDENCE_FLOOR/
 *      AUTONOMY_DOMAIN/HARD_RULES scaffold + a `runClaudeJunior` helper
 *      that calls Claude, tolerates fenced JSON, and fails fast on
 *      empty `evidence_ids`.
 *
 * Every junior consumes this module so the per-junior file stays focused
 * on its prompt + Zod schema + (optional) DB writes.
 */

import { z, type ZodSchema } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Ports — shared across every junior
// ─────────────────────────────────────────────────────────────────────

export interface ClaudeClient {
  complete(args: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly model?: string;
  }): Promise<{ readonly content: string }>;
}

/**
 * Minimal Drizzle surface the juniors need.
 *
 * - `execute(q)` for legacy raw-SQL paths (kept so we can fall back
 *   when a typed schema is genuinely unavailable).
 * - `insert(table)` returning a builder with `values()` /
 *   `onConflictDoNothing()`. The real Drizzle client matches this
 *   shape — the narrow interface lets us keep this package free of
 *   a hard dep on `@borjie/database` (see `lazyDb()` below).
 */
export interface DrizzleInsertBuilder {
  values(row: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>): DrizzleInsertBuilder & Promise<unknown>;
  onConflictDoNothing(args?: { target?: unknown }): Promise<unknown>;
}

export interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
  insert(table: unknown): DrizzleInsertBuilder;
}

export interface JuniorLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface JuniorDeps {
  readonly claude: ClaudeClient;
  readonly db?: DrizzleLikeClient | null;
  readonly logger?: JuniorLogger;
}

// ─────────────────────────────────────────────────────────────────────
// Universal-envelope builder (AGENT_PROMPT_LIBRARY §0)
// ─────────────────────────────────────────────────────────────────────

export interface UniversalEnvelope {
  readonly juniorName: string;
  readonly mandate: string;
  readonly tools: string;
  readonly evidence: string;
  readonly outputSchema: string;
  readonly confidenceFloor: number;
  readonly autonomyDomain: string;
  readonly hardRules: ReadonlyArray<string>;
  readonly extras?: string;
}

const DEFAULT_HARD_RULES: ReadonlyArray<string> = [
  'Never give unsafe operational instructions (explosives, mercury-exposure-increasing, illegal export routes).',
  'Never quote a USD price for a domestic TZ transaction (GN 198/2025).',
  'Never mark a recommendation "high confidence" without >= 2 independent evidence sources.',
  'Never assume the owner intent — ask.',
  'Output STRICT JSON only — no markdown fences, no prose.',
];

export function buildUniversalPrompt(envelope: UniversalEnvelope): string {
  const allRules = [...envelope.hardRules, ...DEFAULT_HARD_RULES];
  return [
    `SYSTEM:`,
    `You are the ${envelope.juniorName} — a specialist Borjie AI agent inside a Tanzanian mining business.`,
    `You report to the Master Brain. You are stateless; the truth lives in the Living Mining Business Map (LMBM).`,
    `Owner-preferred language: Swahili by default for Tanzanian tenants, English on request.`,
    ``,
    `MANDATE:`,
    envelope.mandate,
    ``,
    `TOOLS YOU CAN CALL:`,
    envelope.tools,
    ``,
    `EVIDENCE REQUIREMENTS:`,
    envelope.evidence,
    ``,
    `OUTPUT_SCHEMA (strict JSON, no markdown fences, no prose):`,
    envelope.outputSchema,
    ``,
    `CONFIDENCE_FLOOR: ${envelope.confidenceFloor.toFixed(2)} for binding actions. Below this, mark the response pending and request human review.`,
    `AUTONOMY_DOMAIN: ${envelope.autonomyDomain}`,
    ``,
    `HARD_RULES:`,
    allRules.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    envelope.extras ? `\n${envelope.extras}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Output base — every junior output must carry these audit fields
// ─────────────────────────────────────────────────────────────────────

export const AuditedOutputBase = z.object({
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence_ids: z.array(z.string().min(1)).min(1, 'evidence_ids cannot be empty (Auditor will reject)'),
  citations: z.array(z.string()).default([]),
});
export type AuditedOutputBase = z.infer<typeof AuditedOutputBase>;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

export function parseClaudeJson(raw: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] : raw).trim();
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function deterministicId(prefix: string, ...parts: ReadonlyArray<string>): string {
  const hash = Buffer.from(parts.join('::')).toString('hex');
  return `${prefix}_${hash.slice(0, 32)}`;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// runClaudeJunior — the standard call-and-validate loop
// ─────────────────────────────────────────────────────────────────────

export interface RunClaudeArgs<TSchema extends ZodSchema> {
  readonly claude: ClaudeClient;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schema: TSchema;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly logger?: JuniorLogger;
  readonly juniorName: string;
}

export async function runClaudeJunior<TSchema extends ZodSchema>(
  args: RunClaudeArgs<TSchema>,
): Promise<z.infer<TSchema>> {
  const response = await args.claude.complete({
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    model: args.model ?? 'claude-haiku-4-5-20251001',
    maxTokens: args.maxTokens ?? 1500,
    temperature: args.temperature ?? 0,
  });

  const parsed = parseClaudeJson(response.content);
  if (!parsed.ok) {
    args.logger?.warn(`${args.juniorName}: malformed JSON from Claude`, {
      raw: response.content.slice(0, 256),
    });
    const parseErr = (parsed as { ok: false; error: string }).error;
    throw new Error(`${args.juniorName}: parse_failed: ${parseErr}`);
  }

  const validation = args.schema.safeParse(parsed.value);
  if (!validation.success) {
    args.logger?.warn(`${args.juniorName}: schema validation failed`, {
      issues: validation.error.issues,
    });
    throw new Error(
      `${args.juniorName}: validation_failed: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return validation.data;
}

// ─────────────────────────────────────────────────────────────────────
// Default lazy adapters
// ─────────────────────────────────────────────────────────────────────

export function lazyClaudeClient(): ClaudeClient {
  let realPromise: Promise<ClaudeClient> | null = null;
  const getReal = async (): Promise<ClaudeClient> => {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY missing — wire a ClaudeClient explicitly');
    }
    return {
      async complete({ systemPrompt, userPrompt, maxTokens, temperature, model }) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model ?? 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens ?? 1500,
            temperature: temperature ?? 0,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        if (!response.ok) {
          throw new Error(`anthropic ${response.status}: ${await response.text()}`);
        }
        const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
        const text = (body.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');
        return { content: text };
      },
    };
  };
  return {
    async complete(args) {
      if (!realPromise) realPromise = getReal();
      const real = await realPromise;
      return real.complete(args);
    },
  };
}

let cachedDb: DrizzleLikeClient | null | undefined;
export async function lazyDb(): Promise<DrizzleLikeClient | null> {
  if (cachedDb !== undefined) return cachedDb;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    cachedDb = null;
    return null;
  }
  try {
    // TODO(#29): declare @borjie/database in this package's dependencies
    // so this can be a static import. String-spelled specifier defers
    // module resolution to runtime (pnpm symlink graph hoists it in
    // practice) so the typechecker stays green without the local
    // manifest dep.
    const databaseSpecifier: string = '@borjie/database';
    const mod = (await import(databaseSpecifier)) as {
      createDatabaseClient?: (u: string) => DrizzleLikeClient;
    };
    if (typeof mod.createDatabaseClient !== 'function') {
      cachedDb = null;
      return null;
    }
    cachedDb = mod.createDatabaseClient(url);
    return cachedDb;
  } catch {
    cachedDb = null;
    return null;
  }
}

export function defaultJuniorDeps(): JuniorDeps {
  return {
    claude: lazyClaudeClient(),
    db: null,
  };
}

/** Resolve the db at call-time. Useful for `createDefaultXxxAgent` lazy variants. */
export async function withResolvedDb(deps: JuniorDeps): Promise<JuniorDeps> {
  if (deps.db) return deps;
  const db = await lazyDb();
  return { ...deps, db };
}

/**
 * Lazy import the @borjie/database schemas barrel. Returns the table
 * object map (e.g. `{ forecastSnapshots, decisionLog, ... }`).
 *
 * Like `lazyDb`, this uses a string-spelled specifier so this package's
 * typecheck doesn't require `@borjie/database` in its dependencies
 * (see _shared.ts comment on lazyDb). Returns `null` if the import
 * fails — the caller should silently skip the write in that case.
 */
let cachedSchemas: Record<string, unknown> | null | undefined;
export async function loadJuniorSchemas(): Promise<Record<string, unknown> | null> {
  if (cachedSchemas !== undefined) return cachedSchemas;
  try {
    const databaseSpecifier: string = '@borjie/database';
    const mod = (await import(databaseSpecifier)) as Record<string, unknown>;
    cachedSchemas = mod;
    return cachedSchemas;
  } catch {
    cachedSchemas = null;
    return null;
  }
}
