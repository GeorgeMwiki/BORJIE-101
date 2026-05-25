import { describe, it, expect } from 'vitest';
import {
  createReadFeatureFlagTool,
  type FeatureFlagReadPort,
} from '../platform.read_feature_flag.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(): FeatureFlagReadPort {
  return {
    async read(flagName: string) {
      return {
        flagName,
        globalValue: true,
        tenantOverrides: [
          {
            tenantId: 't-alpha',
            value: false,
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
          {
            tenantId: 't-beta',
            value: true,
            updatedAt: '2026-05-12T00:00:00.000Z',
          },
        ],
      };
    },
  };
}

describe('platform.read_feature_flag', () => {
  it('happy path — platform admin sees all overrides', async () => {
    const tool = createReadFeatureFlagTool({ flags: stub() });
    const out = await tool.execute({ flagName: 'jarvis.streaming' }, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.tenantOverrides).toHaveLength(2);
  });

  it('input validation — flagName regex rejects spaces', () => {
    expect(
      createReadFeatureFlagTool({ flags: stub() }).inputSchema.safeParse({
        flagName: 'has space',
      }).success,
    ).toBe(false);
  });

  it('auth-gated — caller without scope refused', async () => {
    const tool = createReadFeatureFlagTool({ flags: stub() });
    const out = await tool.execute(
      { flagName: 'jarvis.streaming' },
      buildCtx({ scopes: ['platform:tenants:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('filters overrides by caller scope', async () => {
    const tool = createReadFeatureFlagTool({ flags: stub() });
    const out = await tool.execute(
      { flagName: 'jarvis.streaming' },
      buildCtx({
        scopes: ['platform:feature-flags:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.tenantOverrides.map((o) => o.tenantId)).toEqual(['t-alpha']);
  });

  it('preserves globalValue regardless of tenant scope', async () => {
    const tool = createReadFeatureFlagTool({ flags: stub() });
    const out = await tool.execute(
      { flagName: 'jarvis.streaming' },
      buildCtx({
        scopes: ['platform:feature-flags:read'],
      }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.globalValue).toBe(true);
  });
});
