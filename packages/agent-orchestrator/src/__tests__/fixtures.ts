/**
 * Shared test fixtures — deterministic in-memory `BrainPort` + a
 * couple of toy `ToolPort`s. Avoids re-implementing the same stub in
 * every test file.
 */

import type {
  AgentSpec,
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
  BrainToolCall,
  StopReason,
  ToolPort,
} from '../types.js';

export interface ScriptedTurn {
  /** Plain text the brain returns. */
  readonly text: string;
  /** Optional tool calls to emit. */
  readonly toolCalls?: ReadonlyArray<BrainToolCall>;
  readonly stopReason?: StopReason;
  /** Custom token usage; defaults to small fixed counts. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Override the model id surfaced in the response. */
  readonly model?: string;
}

export interface ScriptedBrainOptions {
  readonly turns: ReadonlyArray<ScriptedTurn>;
  readonly defaultModel?: string;
  /** Called once per request — handy for assertions on the last system prompt. */
  readonly onRequest?: (req: BrainCallRequest) => void;
}

export function makeScriptedBrain(opts: ScriptedBrainOptions): {
  readonly brain: BrainPort;
  readonly callCount: () => number;
  readonly lastRequest: () => BrainCallRequest | null;
  readonly allRequests: () => ReadonlyArray<BrainCallRequest>;
} {
  let i = 0;
  let last: BrainCallRequest | null = null;
  const all: BrainCallRequest[] = [];
  return {
    brain: {
      async call(req: BrainCallRequest): Promise<BrainCallResponse> {
        last = req;
        all.push(req);
        if (opts.onRequest) opts.onRequest(req);
        const turn = opts.turns[Math.min(i, opts.turns.length - 1)] ?? {
          text: '',
          stopReason: 'end_turn' as const,
        };
        i++;
        return {
          text: turn.text,
          toolCalls: turn.toolCalls ?? [],
          usage: {
            inputTokens: turn.inputTokens ?? 100,
            outputTokens: turn.outputTokens ?? 20,
          },
          model: turn.model ?? opts.defaultModel ?? 'fake-model',
          stopReason: turn.stopReason ?? (turn.toolCalls && turn.toolCalls.length > 0 ? 'tool_use' : 'end_turn'),
        };
      },
    },
    callCount: () => i,
    lastRequest: () => last,
    allRequests: () => all,
  };
}

export function makeEchoTool(): ToolPort<{ readonly value: string }, { readonly echoed: string }> {
  return {
    name: 'echo',
    description: 'echo input back to caller',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    async execute(input: { readonly value: string }) {
      return { echoed: input.value };
    },
  };
}

export function makeAddTool(): ToolPort<{ readonly a: number; readonly b: number }, { readonly sum: number }> {
  return {
    name: 'add',
    description: 'add two integers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    async execute(input: { readonly a: number; readonly b: number }) {
      return { sum: input.a + input.b };
    },
  };
}

export function makeFlakyTool(failTimes: number): ToolPort<unknown, { readonly ok: true }> {
  let calls = 0;
  return {
    name: 'flaky',
    description: 'fails the first N calls then succeeds',
    inputSchema: { type: 'object' },
    async execute(_input: unknown) {
      calls++;
      if (calls <= failTimes) {
        throw new Error(`flaky failure #${calls}`);
      }
      return { ok: true as const };
    },
  };
}

export function makeAgent(overrides?: Partial<AgentSpec>): AgentSpec {
  const base = {
    id: overrides?.id ?? 'test-agent',
    name: overrides?.name ?? 'Test Agent',
    role: overrides?.role ?? 'worker',
    systemPrompt: overrides?.systemPrompt ?? 'You are a helpful test agent.',
    toolAllowlist: overrides?.toolAllowlist ?? ['echo', 'add', 'flaky'],
  } as const;
  return overrides?.preferredModel !== undefined
    ? { ...base, preferredModel: overrides.preferredModel }
    : base;
}
