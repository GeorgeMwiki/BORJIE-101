/**
 * Tab-schema generator.
 *
 * Given a `TabGenerationIntent`, calls the multi-LLM synthesizer (or
 * a single sensor when no synthesizer is wired) to draft a complete
 * `PortalTab` document. The LLM output is parsed, repaired where
 * possible, then validated against the Zod schema. On failure the
 * generator falls back to a deterministic domain skeleton so the
 * user never sees an error.
 */

import {
  PortalTabSchema,
  type GeneratorOrgContext,
  type PortalTab,
  type TabGenerationIntent,
} from '../types.js';
import {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
} from './prompt.js';
import { buildFallbackTab, getDefaultIcon } from './fallbacks.js';
import {
  buildCacheKey,
  createInMemoryGeneratorCache,
  type GeneratorCache,
} from './cache.js';

// ────────────────────────────────────────────────────────────────────
// Generator brain port — single-shot text completion. The composition
// root can satisfy this with either the multi-LLM synthesizer
// (mixture-of-agents) or one of the kernel sensors.
// ────────────────────────────────────────────────────────────────────

export interface GeneratorBrainCall {
  readonly system: string;
  readonly userMessage: string;
}

export interface GeneratorBrainResult {
  readonly text: string;
  /** Optional metadata propagated for tracing only. */
  readonly modelId?: string;
}

export interface GeneratorBrainPort {
  generate(call: GeneratorBrainCall): Promise<GeneratorBrainResult>;
}

// ────────────────────────────────────────────────────────────────────
// Public interface
// ────────────────────────────────────────────────────────────────────

export interface GenerateTabInput {
  readonly intent: TabGenerationIntent;
  readonly tenantId: string;
  /** NULL = tenant-default tab; non-null = user-specific. */
  readonly userId: string | null;
  /** Audit actor — usually the user id or `'system'`. */
  readonly actorId: string;
  /** Optional org-level context the LLM can use. */
  readonly orgContext?: GeneratorOrgContext;
  /** Optional pointer to the chat conversation that triggered this. */
  readonly sourceConversationId?: string;
}

export interface GenerateTabResult {
  readonly tab: PortalTab;
  readonly source: 'llm' | 'fallback' | 'cache';
  readonly llmModelId?: string;
  readonly latencyMs: number;
  readonly cacheKey: string;
}

export interface GeneratorDeps {
  readonly brain?: GeneratorBrainPort;
  readonly cache?: GeneratorCache;
  readonly clock?: () => Date;
  /** Override the id generator for deterministic tests. */
  readonly newId?: () => string;
}

// ────────────────────────────────────────────────────────────────────
// JSON extraction + repair
// ────────────────────────────────────────────────────────────────────

function extractFirstJsonObject(text: string): string | null {
  // First try a fenced block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const trimmed = fence[1].trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
  }
  // Fall back to balanced-brace scan from the first `{`.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Fill in the system-controlled fields the LLM is told to use
 * placeholders for: id, tenantId, userId, audit, createdAt,
 * updatedAt. The LLM owns title / description / sections /
 * permissions; we own provenance.
 */
function overlaySystemFields(
  candidate: Record<string, unknown>,
  args: GenerateTabInput,
  id: string,
  nowIso: string,
): Record<string, unknown> {
  return {
    ...candidate,
    id,
    version: 1,
    tenantId: args.tenantId,
    userId: args.userId,
    icon:
      typeof candidate.icon === 'string' && candidate.icon.length > 0
        ? candidate.icon
        : getDefaultIcon(args.intent.domain),
    audit: {
      createdBy: args.actorId,
      updatedBy: args.actorId,
      history: [
        {
          actor: 'agent' as const,
          actorId: args.actorId,
          action: 'created' as const,
          at: nowIso,
          note: `Generated via LLM from intent: "${args.intent.sourceMessage.slice(0, 100)}"`,
        },
      ],
      ...(args.sourceConversationId !== undefined
        ? { sourceConversationId: args.sourceConversationId }
        : {}),
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function fallbackId(): string {
  // Avoid pulling in `crypto.randomUUID` so this module works in
  // older Node + the browser test runner. A 64-bit hex string is
  // ample for in-cluster uniqueness; the persistence layer's
  // unique index is the real guarantee.
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const a = Math.floor(Math.random() * 0xffff_ffff);
  const b = Math.floor(Math.random() * 0xffff_ffff);
  const c = Date.now() & 0xffff_ffff;
  return `tab_${hex(a)}${hex(b)}${hex(c)}`;
}

// ────────────────────────────────────────────────────────────────────
// Generator factory
// ────────────────────────────────────────────────────────────────────

export interface TabGenerator {
  generate(input: GenerateTabInput): Promise<GenerateTabResult>;
}

export function createTabGenerator(deps: GeneratorDeps = {}): TabGenerator {
  const clock = deps.clock ?? (() => new Date());
  const cache = deps.cache ?? createInMemoryGeneratorCache();
  const newId = deps.newId ?? fallbackId;
  const systemPrompt = buildGenerationSystemPrompt();

  async function generate(input: GenerateTabInput): Promise<GenerateTabResult> {
    const startedAt = clock().getTime();
    const cacheKey = buildCacheKey(input.intent, input.orgContext);
    const hit = cache.get(cacheKey);
    if (hit) {
      const reused: PortalTab = {
        ...hit.tab,
        id: newId(),
        tenantId: input.tenantId,
        userId: input.userId,
        createdAt: clock().toISOString(),
        updatedAt: clock().toISOString(),
        audit: {
          createdBy: input.actorId,
          updatedBy: input.actorId,
          history: [
            {
              actor: 'system',
              actorId: input.actorId,
              action: 'created',
              at: clock().toISOString(),
              note: 'Generated from generator cache hit',
            },
          ],
          ...(input.sourceConversationId !== undefined
            ? { sourceConversationId: input.sourceConversationId }
            : {}),
        },
      };
      return {
        tab: reused,
        source: 'cache',
        latencyMs: clock().getTime() - startedAt,
        cacheKey,
      };
    }

    // Try the LLM. If it's not wired or it fails, fall through.
    if (deps.brain) {
      try {
        const userMessage = buildGenerationUserMessage({
          intent: input.intent,
          orgContext: input.orgContext,
        });
        const llm = await deps.brain.generate({
          system: systemPrompt,
          userMessage,
        });
        const jsonBlock = extractFirstJsonObject(llm.text);
        if (jsonBlock) {
          let raw: unknown;
          try {
            raw = JSON.parse(jsonBlock);
          } catch {
            raw = null;
          }
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const id = newId();
            const nowIso = clock().toISOString();
            const overlaid = overlaySystemFields(
              raw as Record<string, unknown>,
              input,
              id,
              nowIso,
            );
            const validated = PortalTabSchema.safeParse(overlaid);
            if (validated.success) {
              cache.set(cacheKey, {
                tab: validated.data,
                storedAt: clock().getTime(),
              });
              const result: GenerateTabResult = {
                tab: validated.data,
                source: 'llm',
                latencyMs: clock().getTime() - startedAt,
                cacheKey,
                ...(llm.modelId !== undefined
                  ? { llmModelId: llm.modelId }
                  : {}),
              };
              return result;
            }
          }
        }
      } catch {
        // Swallow — the fallback below catches every failure mode.
      }
    }

    // Fallback path — deterministic skeleton.
    const id = newId();
    const nowIso = clock().toISOString();
    const tab = buildFallbackTab({
      intent: input.intent,
      tenantId: input.tenantId,
      userId: input.userId,
      actorId: input.actorId,
      nowIso,
      id,
      sourceConversationId: input.sourceConversationId,
    });
    cache.set(cacheKey, {
      tab,
      storedAt: clock().getTime(),
    });
    return {
      tab,
      source: 'fallback',
      latencyMs: clock().getTime() - startedAt,
      cacheKey,
    };
  }

  return { generate };
}
