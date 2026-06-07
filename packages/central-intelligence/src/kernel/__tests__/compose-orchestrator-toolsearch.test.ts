/**
 * Item-3 — composeSovereign projects the kernel's real `toolRegistry`
 * into the orchestrator `toolSearch`.
 *
 * Before this wire, `buildOrchestratorDeps` hard-defaulted
 * `toolSearch = createInMemoryToolSearch([])` (EMPTY) — the main loop
 * had NO tools to search over, so the dispatcher could never execute a
 * registered BrainTool. These tests prove:
 *
 *   1. when `composeSovereign` is given a `toolRegistry` AND an
 *      orchestrator block, the loop's `toolSearch` returns the
 *      registry's tools for a matching goal; and
 *   2. an explicit `toolSearch` on the orchestrator block still wins
 *      (no surprise override).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { composeSovereign } from '../compose.js';
import { createBrainToolRegistry } from '../tool-spec.js';
import { createInMemoryToolSearch } from '../orchestrator/context-budget.js';
import { createAnthropicRouter } from '../orchestrator/anthropic-router.js';
import { createToolDispatcher } from '../orchestrator/tool-dispatcher.js';
import { createInMemoryMemoryTool } from '../orchestrator/memory-tool.js';
import type { AnthropicMessagesClient } from '../sensors/anthropic-sensor.js';
import type {
  Dispatcher,
  LLMRouter,
} from '../orchestrator/main-loop.js';
import type { Decision, DispatchResult } from '../orchestrator/decision.js';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  ThoughtRequest,
} from '../kernel-types.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_alpha',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager-head',
};

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th-compose-1',
    userMessage: 'look up the arrears ladder',
    scope: TENANT_SCOPE,
    tier: 'site',
    stakes: 'low',
    surface: 'estate-manager-app',
    ...over,
  };
}

function noopSensor(): Sensor {
  return {
    id: 'noop-sensor',
    modelId: 'noop-model',
    priority: 1,
    capabilities: ['fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text: 'legacy',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'noop-model',
        sensorId: 'noop-sensor',
      };
    },
  };
}

/** Router that emits a single tool_call for the registry tool, then ends. */
function toolThenRespondRouter(toolName: string): LLMRouter {
  const decisions: Decision[] = [
    { kind: 'tool_call', call: { toolName, input: {}, callId: 'c1' } },
    { kind: 'respond_to_owner', text: 'done' },
  ];
  let i = 0;
  return {
    async call(): Promise<Decision> {
      const next = decisions[i] ?? { kind: 'final', text: 'end' };
      i += 1;
      return next;
    },
  };
}

function recordingDispatcher(): Dispatcher & { calls: Decision[] } {
  const calls: Decision[] = [];
  return {
    calls,
    async dispatch(decision: Decision): Promise<DispatchResult> {
      calls.push(decision);
      if (decision.kind === 'tool_call') {
        return {
          kind: 'tool_ok',
          callId: decision.call.callId,
          output: { ok: true },
          latencyMs: 1,
          tokensIn: 1,
          tokensOut: 1,
          usdCost: 0,
        };
      }
      return {
        kind: 'response',
        text: decision.kind === 'respond_to_owner' ? decision.text : '',
        tokensIn: 1,
        tokensOut: 1,
        usdCost: 0,
      };
    },
  };
}

function makeRegistryWith(toolName: string): ReturnType<typeof createBrainToolRegistry> {
  const registry = createBrainToolRegistry();
  registry.register({
    name: toolName,
    description: 'arrears ladder lookup tool',
    schemaIn: z.object({}),
    schemaOut: z.object({ ok: z.boolean() }),
    tier: 'read',
    requiresApproval: false,
    executor: async () => ({ ok: true }),
  });
  return registry;
}

describe('composeSovereign — Item-3 toolRegistry → toolSearch projection', () => {
  it('projects the kernel toolRegistry into the orchestrator toolSearch (dispatcher runs the tool)', async () => {
    const dispatcher = recordingDispatcher();
    const registry = makeRegistryWith('arrears.lookup');
    const sov = composeSovereign({
      extraSensors: [noopSensor()],
      toolRegistry: registry,
      orchestrator: {
        router: toolThenRespondRouter('arrears.lookup'),
        dispatcher,
        // Item-5 canary lever — exercise the DEFAULT-OFF main loop.
        useByDefault: true,
      },
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
    // The projected tool was searchable AND dispatched.
    const toolCalls = dispatcher.calls.filter((d) => d.kind === 'tool_call');
    expect(toolCalls.length).toBe(1);
    if (toolCalls[0]?.kind === 'tool_call') {
      expect(toolCalls[0].call.toolName).toBe('arrears.lookup');
    }
  });

  it('honours an explicit toolSearch override on the orchestrator block', async () => {
    const dispatcher = recordingDispatcher();
    const registry = makeRegistryWith('arrears.lookup');
    // Explicit override exposes a DIFFERENT tool name; the registry must
    // NOT be projected when the caller pins toolSearch.
    const sov = composeSovereign({
      extraSensors: [noopSensor()],
      toolRegistry: registry,
      orchestrator: {
        router: toolThenRespondRouter('override.only'),
        dispatcher,
        useByDefault: true,
        toolSearch: createInMemoryToolSearch([
          {
            name: 'override.only',
            description: 'override tool',
            keywords: ['arrears', 'ladder', 'look'],
          },
        ]),
      },
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
    // The override tool was dispatched; the registry projection did not
    // clobber it.
    const toolCalls = dispatcher.calls.filter((d) => d.kind === 'tool_call');
    if (toolCalls[0]?.kind === 'tool_call') {
      expect(toolCalls[0].call.toolName).toBe('override.only');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Full-stack — the REAL Anthropic router + REAL tool dispatcher driving
// the kernel through composeSovereign, with toolRegistry projection,
// memory recall/persist, and citation propagation all live. Proves the
// orchestrator path is genuinely CONSUMED end-to-end (not dead wiring),
// while production keeps it OFF by default.
// ─────────────────────────────────────────────────────────────────────

/**
 * Scripted Anthropic client: first response is a tool_use for the
 * registry tool, the second is a final text answer. Mirrors a two-tick
 * agentic loop (call tool → read result → answer).
 */
function scriptedAnthropicClient(toolName: string): AnthropicMessagesClient {
  let turn = 0;
  return {
    messages: {
      async create() {
        turn += 1;
        if (turn === 1) {
          return {
            id: 'msg_1',
            model: 'm',
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: toolName,
                input: { value: 10 },
              },
            ],
          } as never;
        }
        return {
          id: 'msg_2',
          model: 'm',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'the doubled value is 20' }],
        } as never;
      },
    },
  };
}

describe('composeSovereign — full-stack orchestrator (router + dispatcher)', () => {
  it('drives the kernel through the real router + dispatcher with grounding citations', async () => {
    // A registry tool whose executor returns an evidence_id so the
    // dispatcher's tool result feeds the citation harvester.
    const realRegistry = createBrainToolRegistry();
    realRegistry.register({
      name: 'estate.metric',
      description: 'estate metric tool',
      schemaIn: z.object({ value: z.number() }),
      schemaOut: z.object({ doubled: z.number(), evidence_id: z.string() }),
      tier: 'read',
      requiresApproval: false,
      executor: async (input) => ({
        doubled: input.value * 2,
        evidence_id: 'corpus_estate_7',
      }),
    });

    const client = scriptedAnthropicClient('estate.metric');
    const router = createAnthropicRouter(client, { model: 'm' });
    const dispatcher = createToolDispatcher({ registry: realRegistry });
    const memoryTool = createInMemoryMemoryTool();

    const sov = composeSovereign({
      extraSensors: [noopSensor()],
      // Grounding facts so the kernel threads a citation id into the
      // orchestrator request (Item-1 + Item-2 parity).
      groundingFacts: {
        async fetch() {
          return [
            {
              id: 'fact_metric_1',
              label: 'estate metric',
              value: 10,
              source: 'ledger',
              asOf: '2026-06-07',
            },
          ];
        },
      },
      toolRegistry: realRegistry,
      orchestrator: {
        router,
        dispatcher,
        memoryTool,
        useByDefault: true,
      },
    });

    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
    if (decision.kind === 'answer') {
      expect(decision.text).toBe('the doubled value is 20');
      const ids = decision.citations.map((c) => c.id);
      // Grounding-fact id (kernel-threaded) AND tool evidence id (harvested).
      expect(ids).toContain('fact_metric_1');
      expect(ids).toContain('corpus_estate_7');
    }

    // Memory persisted the end-of-turn note under the tenant scope.
    const view = await memoryTool.view('t_alpha', 'turn-notes.md');
    expect(view.kind).toBe('file');
  });
});
