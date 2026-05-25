/**
 * Tool-call loop test.
 *
 * Validates the orchestrator's iterative protocol: model emits tool_use,
 * dispatcher executes, tool_result gets fed back, model finalizes.
 *
 * Uses a stub provider so behaviour is deterministic. The real Anthropic
 * provider has its own retry tests in `anthropic-provider.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ToolDispatcher } from '../orchestrator/tool-dispatcher.js';
import {
  PersonaRegistry,
  Persona,
  PERSONA_IDS,
} from '../personas/persona.js';
import { DEFAULT_PERSONAE } from '../personas/personas.catalog.js';
import {
  InMemoryThreadStore,
  ThreadStore,
} from '../thread/thread-store.js';
import { createReviewService } from '../services/review-service.js';
import { createAIGovernanceService } from '../governance/ai-governance.js';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIContentBlock,
} from '../providers/ai-provider.js';
import { aiOk, asModelId } from '../types/core.types.js';
import { registerDefaultSkills } from '../skills/index.js';

class ScriptedAnthropicLikeProvider implements AIProvider {
  readonly providerId = 'scripted-anthropic';
  readonly supportedModels = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
  private callIdx = 0;

  constructor(private readonly responses: AICompletionResponse[]) {}

  async complete(_req: AICompletionRequest) {
    const r = this.responses[this.callIdx];
    this.callIdx = Math.min(this.callIdx + 1, this.responses.length - 1);
    return aiOk(r);
  }
  supportsModel() {
    return true;
  }
  getModelInfo() {
    return null;
  }
  async healthCheck() {
    return true;
  }
}

function makeResp(opts: {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  finishReason?: 'stop' | 'tool_use';
}): AICompletionResponse {
  const blocks: AIContentBlock[] = [];
  if (opts.text) blocks.push({ type: 'text', text: opts.text });
  if (opts.toolCalls)
    for (const tc of opts.toolCalls)
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
  return {
    content: opts.text ?? '',
    modelId: asModelId('claude-sonnet-4-6'),
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    processingTimeMs: 10,
    finishReason: opts.finishReason ?? (opts.toolCalls?.length ? 'tool_use' : 'stop'),
    toolCalls: opts.toolCalls,
    rawContent: blocks,
  };
}

function buildOrchestrator(provider: AIProvider) {
  const personas = new PersonaRegistry();
  for (const p of DEFAULT_PERSONAE) personas.register(p);
  const threads = new ThreadStore(new InMemoryThreadStore());
  const tools = new ToolDispatcher(threads);
  registerDefaultSkills(tools);
  const orchestrator = new Orchestrator({
    personas,
    threads,
    tools,
    reviewService: createReviewService(),
    governance: createAIGovernanceService(),
    executorProvider: provider,
    advisorProvider: provider,
    defaultTokenBudget: 100_000,
  });
  return { orchestrator, tools };
}

describe('orchestrator tool-call loop', () => {
  it('dispatches a tool_use, feeds the result back, and finalizes', async () => {
    // Turn 1: model wants to call swahili_draft.
    // Turn 2: model returns a final text response.
    const provider = new ScriptedAnthropicLikeProvider([
      makeResp({
        toolCalls: [
          {
            id: 'tu_1',
            name: 'skill.kenya.swahili_draft',
            input: {
              kind: 'rent_reminder_gentle',
              locale: 'sw',
              tenantName: 'Asha',
              unitLabel: 'A-1',
              amountKes: 25_000,
              date: '2026-03-31',
              propertyName: 'Kilimani Heights',
            },
          },
        ],
      }),
      makeResp({ text: 'Drafted the Swahili reminder.' }),
    ]);
    const { orchestrator } = buildOrchestrator(provider);

    const result = await orchestrator.startThread({
      tenant: { tenantId: 't1', tenantName: 't1', environment: 'development' },
      actor: { type: 'user', id: 'u1', roles: ['admin'] },
      viewer: {
        userId: 'u1',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText:
        'Draft a gentle Swahili rent reminder to A-1 tenants for 31 March.',
      forcePersonaId: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.turn.toolCalls).toEqual([
        { tool: 'skill.kenya.swahili_draft', ok: true },
      ]);
      expect(result.data.turn.responseText).toContain('Drafted');
    }
  });

  it('records a failed tool dispatch as ok:false but still produces a final response', async () => {
    // Tool that does not exist — dispatcher returns TOOL_NOT_FOUND, loop continues.
    const provider = new ScriptedAnthropicLikeProvider([
      makeResp({
        toolCalls: [
          {
            id: 'tu_1',
            name: 'skill.does_not_exist',
            input: {},
          },
        ],
      }),
      makeResp({ text: 'I could not find that tool — escalating to human review.' }),
    ]);
    const { orchestrator, tools } = buildOrchestrator(provider);

    // Allow the persona to "call" the missing tool by adding it to the
    // allowed list so the dispatcher reaches `TOOL_NOT_FOUND` (rather than
    // `TOOL_NOT_ALLOWED`).
    const personas = (orchestrator as unknown as { cfg: { personas: PersonaRegistry } }).cfg
      .personas;
    const tpl = personas.get(PERSONA_IDS.JUNIOR_COMMUNICATIONS)!;
    tpl.allowedTools.push('skill.does_not_exist');
    void tools;

    const result = await orchestrator.startThread({
      tenant: { tenantId: 't1', tenantName: 't1', environment: 'development' },
      actor: { type: 'user', id: 'u1', roles: ['admin'] },
      viewer: {
        userId: 'u1',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'do something nonsense',
      forcePersonaId: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.turn.toolCalls[0].ok).toBe(false);
      expect(result.data.turn.responseText).toContain('escalating');
    }
  });

  it('respects the per-turn token budget and returns TOKEN_BUDGET_EXHAUSTED', async () => {
    // Provider always wants another tool call; budget should kick in.
    const provider = new ScriptedAnthropicLikeProvider([
      makeResp({
        toolCalls: [
          { id: 'tu_loop', name: 'skill.kenya.swahili_draft', input: { kind: 'rent_reminder_gentle' } },
        ],
      }),
    ]);
    const { orchestrator } = buildOrchestrator(provider);
    // Override the default budget to a tiny value.
    (orchestrator as unknown as { cfg: { defaultTokenBudget: number } }).cfg.defaultTokenBudget = 100;

    const result = await orchestrator.startThread({
      tenant: { tenantId: 't1', tenantName: 't1', environment: 'development' },
      actor: { type: 'user', id: 'u1', roles: ['admin'] },
      viewer: {
        userId: 'u1',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'spam tool calls forever',
      forcePersonaId: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TOKEN_BUDGET_EXHAUSTED');
    }
  });
});
