/**
 * `compileSkillFromNL` — the public chat-handoff API.
 *
 * Composition pipeline:
 *
 *   1. `classifyIntent`            → reject non-recurring / non-conditional NL.
 *   2. `@borjie/aop-compiler::compileAOP` → NL → AST → validated bundle.
 *   3. `validateScopePolicy`       → enforce owner-customer vs internal-admin
 *                                    tool blocklists + tenant-authority guards.
 *   4. `AutonomyValidator.evaluate` (optional) → autonomy-cap check.
 *   5. Materialise a `SkillRegistryEntry` anchored to the conversation.
 *   6. Compose chat-friendly confirmation prose.
 *
 * Every failure mode produces a `CompileSkillFailure` with a `stage` tag and
 * an owner-facing `chatRejection` so the chat surface never has to invent
 * its own error messages.
 */

import { compileAOP } from '@borjie/aop-compiler';
import type { BrainToolRegistry, LLMRouter } from '@borjie/aop-compiler';
import { classifyIntent } from '../intent/classifier.js';
import { validateScopeArgs } from '../scope/scope-routing.js';
import type {
  AutonomyValidator,
  CompileSkillResult,
  ConversationAnchor,
  SkillRegistryEntry,
  SkillScope,
  ValidationError,
} from '../types.js';
import { validateScopePolicy } from './destructive-guard.js';
import { buildChatConfirmation, buildChatRejection, summariseNextRun } from './chat-prose.js';

export interface CompileSkillFromNLArgs {
  /** Required: the owner-authored NL. */
  readonly nl: string;
  /** Required: who's authoring this — owner-customer or internal-admin. */
  readonly scope: SkillScope;
  /**
   * Required for owner-customer scope; optional for internal-admin (when
   * absent on internal-admin, the skill is platform-wide).
   */
  readonly tenantId: string | null;
  /** The actor authoring the skill — for audit trail + registry. */
  readonly authorActorId: string;
  /** Conversation anchor — every skill remembers where it was born. */
  readonly conversationId: string;
  readonly messageId: string;
  /** ISO timestamp when this compile request was issued. */
  readonly nowIso: string;
  /** LLM + tool registry — same shape the AOP compiler consumes. */
  readonly llm: LLMRouter;
  readonly toolRegistry: BrainToolRegistry;
  /** Optional: autonomy cap evaluator. When absent, autonomy is not checked. */
  readonly autonomyValidator?: AutonomyValidator | undefined;
  /**
   * Optional: the classifier's verdict, if already computed. Lets the chat
   * surface re-use the verdict it just showed the user instead of
   * re-classifying. When absent, the compiler computes it.
   */
  readonly precomputedVerdict?:
    | ReturnType<typeof classifyIntent>
    | undefined;
}

function uniqueId(): string {
  // Tiny, dependency-free unique id. Real wire-side adapters can use crypto
  // UUIDs; tests benefit from determinism via the seedable variant below.
  return `skl_${Math.random().toString(36).slice(2, 11)}_${Date.now().toString(36)}`;
}

/**
 * For deterministic tests — call with a stable `id` to bypass the random
 * generator. Internal: not exported from the package barrel.
 */
export interface CompileSkillInternalOptions {
  readonly idGenerator?: (() => string) | undefined;
}

export async function compileSkillFromNL(
  args: CompileSkillFromNLArgs,
  internal: CompileSkillInternalOptions = {},
): Promise<CompileSkillResult> {
  // Validate scope/tenant pairing up front via the scope-routing policy.
  const scopeArgsError = validateScopeArgs(args.scope, args.tenantId);
  if (scopeArgsError !== null) {
    return rejection('intent-rejected', [
      {
        code: 'invalid-scope-args',
        message: scopeArgsError,
        path: ['tenantId'],
      },
    ]);
  }

  // ── 1. Intent classification ──
  const verdict = args.precomputedVerdict ?? classifyIntent(args.nl);
  if (!verdict.compileEligible) {
    return rejection('intent-rejected', [
      {
        code: 'not-compile-eligible',
        message: `intent classified as ${verdict.kind} — only recurring and conditional intents are compiled`,
        path: ['nl'],
      },
    ]);
  }

  // ── 2. AOP compile (NL → AST → validate → emit) ──
  const aopResult = await compileAOP(args.nl, {
    llm: args.llm,
    toolRegistry: args.toolRegistry,
  });
  if (!aopResult.ok) {
    // Distinguish parse from validation failures via error codes the
    // compiler emits.
    const isParseFailure = aopResult.errors.some(
      (e) => e.code === 'invalid-json' || e.code === 'empty-input',
    );
    return rejection(
      isParseFailure ? 'aop-parse-failed' : 'aop-validation-failed',
      aopResult.errors,
    );
  }

  // ── 3. Scope-policy validation ──
  const scopeErrors = validateScopePolicy(aopResult.ast, args.scope);
  if (scopeErrors.length > 0) {
    return rejection('destructive-blocked', scopeErrors);
  }

  // ── 4. Autonomy cap (optional) ──
  if (args.autonomyValidator !== undefined) {
    const autonomyVerdict = await args.autonomyValidator.evaluate({
      scope: args.scope,
      tenantId: args.tenantId,
      ast: aopResult.ast,
    });
    if (!autonomyVerdict.ok) {
      return rejection('autonomy-rejected', [
        {
          code: 'autonomy-cap-exceeded',
          message: autonomyVerdict.reason ?? 'autonomy cap would be exceeded',
          path: ['autonomy'],
        },
      ]);
    }
  }

  // ── 5. Materialise the registry entry ──
  const id = (internal.idGenerator ?? uniqueId)();
  const anchor: ConversationAnchor = Object.freeze({
    conversationId: args.conversationId,
    messageId: args.messageId,
    createdAt: args.nowIso,
    originalNL: args.nl,
  });

  const entry: SkillRegistryEntry = Object.freeze({
    id,
    scope: args.scope,
    tenantId: args.tenantId,
    authorActorId: args.authorActorId,
    anchor,
    aopName: aopResult.ast.name,
    aopVersion: aopResult.ast.version,
    lifecycle: 'active',
    summary: aopResult.ast.description ?? aopResult.ast.name,
    history: Object.freeze([
      {
        at: args.nowIso,
        kind: 'created' as const,
        note: 'compiled from chat',
      },
      {
        at: args.nowIso,
        kind: 'activated' as const,
      },
    ]),
    cronHandle: aopResult.cron ? `cron:${aopResult.ast.name}:${aopResult.cron.schedule}` : null,
    runCount: 0,
    lastRun: null,
  });

  // ── 6. Chat-friendly prose ──
  const chatConfirmation = buildChatConfirmation({
    ast: aopResult.ast,
    scope: args.scope,
    nextRunHint: summariseNextRun(aopResult.ast),
  });

  return Object.freeze({
    ok: true as const,
    aopResult,
    registryEntry: entry,
    chatConfirmation,
  });
}

function rejection(
  stage:
    | 'intent-rejected'
    | 'autonomy-rejected'
    | 'aop-parse-failed'
    | 'aop-validation-failed'
    | 'destructive-blocked',
  errors: ReadonlyArray<ValidationError>,
): CompileSkillResult {
  return Object.freeze({
    ok: false as const,
    stage,
    errors: Object.freeze([...errors]),
    chatRejection: buildChatRejection({ stage, errors }),
  });
}
