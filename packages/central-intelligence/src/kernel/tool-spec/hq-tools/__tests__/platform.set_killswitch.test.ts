import { describe, it, expect } from 'vitest';
import {
  createSetKillswitchTool,
  type KillswitchWritePort,
  type SetKillswitchOutput,
} from '../platform.set_killswitch.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

function stub(): {
  port: KillswitchWritePort;
  restored: Array<unknown>;
} {
  const restored: Array<unknown> = [];
  return {
    restored,
    port: {
      async writeKillswitch(args): Promise<SetKillswitchOutput> {
        return {
          scope: args.scope,
          level: args.level,
          reasonCode: args.reasonCode,
          note: args.note,
          previous: {
            level: 'live',
            reasonCode: 'KILLSWITCH_HALT',
            note: null,
          },
          updatedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async restoreKillswitch(args) {
        restored.push(args);
      },
    },
  };
}

const DESTROY_SCOPES = ['platform:killswitch:write', 'platform:ops:write'];

describe('platform.set_killswitch', () => {
  it('happy path — halts the platform', async () => {
    const { port } = stub();
    const tool = createSetKillswitchTool({ killswitch: port });
    const out = await tool.execute(
      {
        scope: 'platform',
        level: 'halt',
        reasonCode: 'COMPLIANCE_HOLD_CBK',
        note: 'CBK directive 2026-05-15',
      },
      buildCtx({ scopes: DESTROY_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.level).toBe('halt');
  });

  it('auth-gated — missing one of the two required scopes refused', async () => {
    const { port } = stub();
    const tool = createSetKillswitchTool({ killswitch: port });
    const out = await tool.execute(
      {
        scope: 'platform',
        level: 'halt',
        reasonCode: 'COMPLIANCE_HOLD_CBK',
      },
      buildCtx({ scopes: ['platform:killswitch:write'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('emits sovereign-ledger row at destroy tier', async () => {
    const { port } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createSetKillswitchTool({ killswitch: port });
    await tool.execute(
      {
        scope: 'platform',
        level: 'degraded',
        reasonCode: 'PROVIDER_INCIDENT',
      },
      buildCtx({ scopes: DESTROY_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].riskTier).toBe('destroy');
    expect(ledger.rows[0].approvalRequired).toBe(true);
  });

  it('refuses tenant scope the caller cannot reach', async () => {
    const { port } = stub();
    const tool = createSetKillswitchTool({ killswitch: port });
    const out = await tool.execute(
      {
        scope: 'tenant:t-beta',
        level: 'halt',
        reasonCode: 'TENANT_DATA_LEAK_SUSPECTED',
      },
      buildCtx({
        scopes: [...DESTROY_SCOPES, ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('input validation — unknown reason code rejected', () => {
    const { port } = stub();
    const tool = createSetKillswitchTool({ killswitch: port });
    expect(
      tool.inputSchema.safeParse({
        scope: 'platform',
        level: 'halt',
        reasonCode: 'NOT_A_REAL_REASON',
      }).success,
    ).toBe(false);
  });

  it('rollback restores previous state', async () => {
    const { port, restored } = stub();
    const tool = createSetKillswitchTool({ killswitch: port });
    const out = await tool.execute(
      {
        scope: 'platform',
        level: 'halt',
        reasonCode: 'COMPLIANCE_HOLD_CBK',
      },
      buildCtx({ scopes: DESTROY_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: DESTROY_SCOPES }));
    expect(restored).toHaveLength(1);
  });
});
