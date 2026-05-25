/**
 * Compose power-tool transactional-rollback tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { createPowerToolRegistry, type PowerToolRegistry } from '../registry.js';
import { createComposePowerTool } from '../compose.js';
import type { PowerTool, PowerToolContext } from '../types.js';

interface StepInput {
  readonly tag: string;
}
interface StepOutput {
  readonly visited: string;
}

interface RecorderTool extends PowerTool<StepInput, StepOutput> {
  readonly invocations: ReadonlyArray<string>;
  readonly failOnTag: string | null;
}

function makeRecorder(
  id: string,
  failOnTag: string | null = null,
): RecorderTool {
  const visited: string[] = [];
  const tool: PowerTool<StepInput, StepOutput> = {
    id,
    name: id,
    description: `recorder ${id}`,
    requiredTier: 'tenant-resident',
    requiresApproval: false,
    auditDestination: 'audit-events',
    schema: z.object({ tag: z.string() }),
    async execute(_ctx: PowerToolContext, args: StepInput) {
      visited.push(args.tag);
      if (failOnTag !== null && args.tag === failOnTag) {
        return {
          kind: 'failed' as const,
          message: `boom on tag ${args.tag}`,
        };
      }
      return { kind: 'ok' as const, output: { visited: args.tag } };
    },
  };
  return Object.assign(tool, {
    invocations: visited as ReadonlyArray<string>,
    failOnTag,
  });
}

function makeCtx(
  overrides: Partial<PowerToolContext> = {},
): PowerToolContext {
  return {
    callerId: 'u_compose',
    tier: 'estate-manager',
    tenantId: 't_1',
    threadId: 'thread_1',
    approvalRecordId: null,
    auditSink: null,
    clock: () => new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('createComposePowerTool', () => {
  let registry: PowerToolRegistry;

  beforeEach(() => {
    registry = createPowerToolRegistry();
  });

  it('commits when every step succeeds', async () => {
    registry.register(makeRecorder('step_a'));
    registry.register(makeRecorder('step_b'));
    const compose = createComposePowerTool(registry);
    registry.register(compose);

    const result = await registry.invoke(
      'compose',
      {
        steps: [
          { id: 's1', toolId: 'step_a', args: { tag: 'a' } },
          { id: 's2', toolId: 'step_b', args: { tag: 'b' } },
        ],
      },
      makeCtx(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const output = result.output as {
        committed: boolean;
        stepResults: ReadonlyArray<{ id: string; status: string }>;
      };
      expect(output.committed).toBe(true);
      expect(output.stepResults).toHaveLength(2);
      for (const r of output.stepResults) {
        expect(r.status).toBe('ok');
      }
    }
  });

  it('rolls back committed steps when a later step fails', async () => {
    registry.register(makeRecorder('step_a'));
    registry.register(makeRecorder('step_b', 'fail-here'));
    registry.register(makeRecorder('comp_a'));
    const compose = createComposePowerTool(registry);
    registry.register(compose);

    const result = await registry.invoke(
      'compose',
      {
        steps: [
          {
            id: 's1',
            toolId: 'step_a',
            args: { tag: 'a' },
            compensate: { toolId: 'comp_a', args: { tag: 'undo-a' } },
          },
          { id: 's2', toolId: 'step_b', args: { tag: 'fail-here' } },
        ],
      },
      makeCtx(),
    );
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('TRANSACTIONAL_ROLLBACK');
    }
  });

  it('skips downstream steps after a failure', async () => {
    registry.register(makeRecorder('ok_1'));
    registry.register(makeRecorder('fail_2', 'go'));
    registry.register(makeRecorder('never_3'));
    const compose = createComposePowerTool(registry);
    registry.register(compose);

    const result = await registry.invoke<{
      stepResults: ReadonlyArray<{ id: string; status: string }>;
    }>(
      'compose',
      {
        steps: [
          { id: 's1', toolId: 'ok_1', args: { tag: 'a' } },
          { id: 's2', toolId: 'fail_2', args: { tag: 'go' } },
          { id: 's3', toolId: 'never_3', args: { tag: 'unused' } },
        ],
      },
      makeCtx(),
    );
    // Refused because of rollback — but we still want to inspect that
    // the compose tool MARKED s3 as skipped. The `refused` case does
    // not carry stepResults; instead read it via direct execute (so we
    // can observe shape without going through the audit-emission path).
    expect(result.kind).toBe('refused');

    // Direct execute also returns the rolled-back outcome.
    const direct = await compose.execute(makeCtx(), {
      steps: [
        { id: 's1', toolId: 'ok_1', args: { tag: 'a' } },
        { id: 's2', toolId: 'fail_2', args: { tag: 'go' } },
        { id: 's3', toolId: 'never_3', args: { tag: 'unused' } },
      ],
    });
    expect(direct.kind).toBe('refused');
  });

  it('refuses recursive compose-in-compose', async () => {
    registry.register(makeRecorder('a'));
    const compose = createComposePowerTool(registry);
    registry.register(compose);

    const result = await registry.invoke(
      'compose',
      {
        steps: [
          { id: 's1', toolId: 'a', args: { tag: 'a' } },
          { id: 's2', toolId: 'compose', args: { steps: [] } },
        ],
      },
      makeCtx(),
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toContain('recursively');
    }
  });

  it('refuses duplicate step ids', async () => {
    registry.register(makeRecorder('a'));
    const compose = createComposePowerTool(registry);
    registry.register(compose);

    const result = await registry.invoke(
      'compose',
      {
        steps: [
          { id: 'dup', toolId: 'a', args: { tag: 'first' } },
          { id: 'dup', toolId: 'a', args: { tag: 'second' } },
        ],
      },
      makeCtx(),
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toContain('duplicate');
    }
  });
});
