import { describe, it, expect } from 'vitest';
import {
  createSetFeatureFlagTool,
  type FeatureFlagWritePort,
  type SetFeatureFlagOutput,
} from '../platform.set_feature_flag.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(): {
  port: FeatureFlagWritePort;
  restored: Array<{ flagName: string; scope: string; previousValue: unknown }>;
} {
  const restored: Array<{
    flagName: string;
    scope: string;
    previousValue: unknown;
  }> = [];
  return {
    restored,
    port: {
      async setFlag(args): Promise<SetFeatureFlagOutput> {
        return {
          flagName: args.flagName,
          scope: args.scope,
          previousValue: false,
          value: args.value,
          updatedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async restoreFlag(args) {
        restored.push({
          flagName: args.flagName,
          scope: args.scope,
          previousValue: args.previousValue,
        });
      },
    },
  };
}

describe('platform.set_feature_flag', () => {
  it('happy path — flips global flag', async () => {
    const { port } = stub();
    const tool = createSetFeatureFlagTool({ flags: port });
    const out = await tool.execute(
      { flagName: 'jarvis.streaming', value: true, scope: 'global' },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.value).toBe(true);
    expect(out.output.previousValue).toBe(false);
  });

  it('input validation — bad flag name rejected', () => {
    const { port } = stub();
    const tool = createSetFeatureFlagTool({ flags: port });
    expect(
      tool.inputSchema.safeParse({
        flagName: '!bad',
        value: true,
        scope: 'global',
      }).success,
    ).toBe(false);
  });

  it('auth-gated — caller without write scope refused', async () => {
    const { port } = stub();
    const tool = createSetFeatureFlagTool({ flags: port });
    const out = await tool.execute(
      { flagName: 'a.b', value: true, scope: 'global' },
      buildCtx({ scopes: ['platform:feature-flags:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant scope the caller cannot reach', async () => {
    const { port } = stub();
    const tool = createSetFeatureFlagTool({ flags: port });
    const out = await tool.execute(
      { flagName: 'a.b', value: true, scope: 'tenant:t-beta' },
      buildCtx({
        scopes: [
          'platform:feature-flags:write',
          ...TENANT_SCOPED_SCOPES('t-alpha'),
        ],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('rollback restores previous value', async () => {
    const { port, restored } = stub();
    const tool = createSetFeatureFlagTool({ flags: port });
    const out = await tool.execute(
      { flagName: 'a.b', value: true, scope: 'global' },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx());
    expect(restored).toEqual([
      { flagName: 'a.b', scope: 'global', previousValue: false },
    ]);
  });
});
