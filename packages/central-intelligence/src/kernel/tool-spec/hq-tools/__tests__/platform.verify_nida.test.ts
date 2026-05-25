import { describe, it, expect } from 'vitest';
import {
  createVerifyNidaTool,
  type NidaVerificationPort,
  VerifyNidaInputSchema,
} from '../platform.verify_nida.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(opts: {
  kind?: 'ok' | 'unverified' | 'gateway-error';
  throws?: Error;
} = {}): { port: NidaVerificationPort; calls: Array<{ nidaNumber: string }> } {
  const calls: Array<{ nidaNumber: string }> = [];
  return {
    calls,
    port: {
      async verifyIdentity(args) {
        if (opts.throws) throw opts.throws;
        calls.push({ nidaNumber: args.nidaNumber });
        if (opts.kind === 'unverified') {
          return { kind: 'unverified', reason: 'no match' };
        }
        if (opts.kind === 'gateway-error') {
          return { kind: 'gateway-error', message: 'NIDA 503' };
        }
        return {
          kind: 'ok',
          verified: true,
          name: 'Asha Mwangi',
          dob: '1990-01-01',
          photo_match_score: 0.96,
        };
      },
    },
  };
}

const VALID = {
  tenantId: 't-alpha',
  nidaNumber: '19900101001500012345',
  biometricHash: 'a'.repeat(64),
  purposeCode: 'tenant-kyc' as const,
};

const READ_SCOPES = ['platform:kyc:read', 'platform:admin'];

describe('platform.verify_nida', () => {
  it('happy path — returns verified identity', async () => {
    const { port, calls } = stub();
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.verified).toBe(true);
    expect(out.output.name).toBe('Asha Mwangi');
    expect(out.output.photo_match_score).toBeCloseTo(0.96);
    expect(calls).toHaveLength(1);
  });

  it('declares read tier with approval-not-required', () => {
    const { port } = stub();
    const tool = createVerifyNidaTool({ nida: port });
    expect(tool.riskTier).toBe('read');
    expect(tool.approvalRequired).toBe(false);
  });

  it('refused when caller lacks platform:kyc:read', async () => {
    const { port } = stub();
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(
      VALID,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refused when caller cannot reach tenant', async () => {
    const { port } = stub();
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(
      VALID,
      buildCtx({
        scopes: [
          'platform:kyc:read',
          ...TENANT_SCOPED_SCOPES('t-other'),
        ],
      }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — bad nidaNumber rejected', () => {
    expect(
      VerifyNidaInputSchema.safeParse({
        ...VALID,
        nidaNumber: '1234',
      }).success,
    ).toBe(false);
  });

  it('input validation — raw biometric template rejected', () => {
    expect(
      VerifyNidaInputSchema.safeParse({
        ...VALID,
        biometricHash: 'raw template data here that is not hex',
      }).success,
    ).toBe(false);
  });

  it('input validation — unknown purposeCode rejected', () => {
    expect(
      VerifyNidaInputSchema.safeParse({
        ...VALID,
        purposeCode: 'mystery',
      }).success,
    ).toBe(false);
  });

  it('unverified outcome returns ok with verified=false and empty name/dob', async () => {
    const { port } = stub({ kind: 'unverified' });
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.verified).toBe(false);
    expect(out.output.name).toBe('');
    expect(out.output.dob).toBe('');
  });

  it('gateway-error result returns failed with gateway message', async () => {
    const { port } = stub({ kind: 'gateway-error' });
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('NIDA 503');
  });

  it('thrown port error is captured as failed', async () => {
    const { port } = stub({ throws: new Error('boom') });
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('boom');
  });

  it('emits a verifiedAt timestamp on success', async () => {
    const { port } = stub();
    const tool = createVerifyNidaTool({ nida: port });
    const out = await tool.execute(VALID, buildCtx({ scopes: READ_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
