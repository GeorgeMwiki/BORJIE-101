import { describe, it, expect } from 'vitest';
import {
  createVerifyEardhiTitleTool,
  type EardhiTitlePort,
  VerifyEardhiTitleInputSchema,
} from '../platform.verify_eardhi_title.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(opts: {
  kind?: 'ok' | 'not-found' | 'gateway-error';
  encumbrances?: number;
  throws?: Error;
} = {}): { port: EardhiTitlePort; calls: Array<{ titleNumber: string }> } {
  const calls: Array<{ titleNumber: string }> = [];
  return {
    calls,
    port: {
      async verifyTitle(args) {
        if (opts.throws) throw opts.throws;
        calls.push({ titleNumber: args.titleNumber });
        if (opts.kind === 'not-found') return { kind: 'not-found' };
        if (opts.kind === 'gateway-error') {
          return { kind: 'gateway-error', message: 'e-Ardhi 502' };
        }
        const encs = Array.from({ length: opts.encumbrances ?? 0 }, (_, i) => ({
          kind: 'mortgage' as const,
          noteRef: `MTG-${i}`,
          registeredAt: '2023-01-01',
        }));
        return {
          kind: 'ok',
          valid: true,
          owner_name: 'Borjie Investments Ltd',
          registered_at: '2022-03-15',
          encumbrances: encs,
        };
      },
    },
  };
}

const VALID = {
  tenantId: 't-alpha',
  titleNumber: 'DSM/0014/000123',
};

const READ_SCOPES = ['platform:property:verify', 'platform:admin'];

describe('platform.verify_eardhi_title', () => {
  it('happy path — returns title + encumbrances', async () => {
    const { port, calls } = stub({ encumbrances: 2 });
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.valid).toBe(true);
    expect(out.output.encumbrances).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it('declares read tier with approval-not-required', () => {
    const { port } = stub();
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    expect(tool.riskTier).toBe('read');
    expect(tool.approvalRequired).toBe(false);
  });

  it('refused when caller lacks platform:property:verify', async () => {
    const { port } = stub();
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(
      VALID,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refused when caller cannot reach tenant', async () => {
    const { port } = stub();
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(
      VALID,
      buildCtx({
        scopes: [
          'platform:property:verify',
          ...TENANT_SCOPED_SCOPES('t-other'),
        ],
      }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — bad title number rejected', () => {
    expect(
      VerifyEardhiTitleInputSchema.safeParse({
        ...VALID,
        titleNumber: 'invalid-format',
      }).success,
    ).toBe(false);
  });

  it('not-found result returns ok with valid=false and empty owner', async () => {
    const { port } = stub({ kind: 'not-found' });
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.valid).toBe(false);
    expect(out.output.owner_name).toBe('');
    expect(out.output.encumbrances).toHaveLength(0);
  });

  it('gateway-error result returns failed', async () => {
    const { port } = stub({ kind: 'gateway-error' });
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('e-Ardhi 502');
  });

  it('thrown port error is captured as failed', async () => {
    const { port } = stub({ throws: new Error('boom') });
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('boom');
  });

  it('emits a verifiedAt timestamp on success', async () => {
    const { port } = stub();
    const tool = createVerifyEardhiTitleTool({ eardhi: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
