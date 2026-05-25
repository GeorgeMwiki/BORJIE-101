/**
 * Self-modification power-tool tests — Reflexion-style persona rewrite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInMemoryAnchorSummaryAdapter,
  createSelfModificationPowerTool,
  type InMemoryAnchorSummaryAdapter,
} from '../self-modification.js';
import type { PowerToolContext } from '../types.js';

function makeCtx(
  overrides: Partial<PowerToolContext> = {},
): PowerToolContext {
  return {
    callerId: 'u_self_mod',
    tier: 'estate-manager',
    tenantId: 't_1',
    threadId: 'thread_1',
    approvalRecordId: 'appr_42',
    auditSink: null,
    clock: () => new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const SAMPLE_SUMMARY =
  'When the tenant cites the Rent Restriction Act, slow down and quote section by section.';

describe('createSelfModificationPowerTool', () => {
  let adapter: InMemoryAnchorSummaryAdapter;
  let tool: ReturnType<typeof createSelfModificationPowerTool>;

  beforeEach(() => {
    adapter = createInMemoryAnchorSummaryAdapter();
    tool = createSelfModificationPowerTool(adapter);
  });

  it('declares the expected static shape', () => {
    expect(tool.id).toBe('self_modification');
    expect(tool.requiredTier).toBe('estate-manager');
    expect(tool.requiresApproval).toBe(true);
    expect(tool.auditDestination).toBe('sovereign-action-ledger');
  });

  it('persists a row to the anchor adapter on success', async () => {
    const result = await tool.execute(makeCtx(), {
      anchorKey: 'persona.estate-manager.eviction',
      summary: SAMPLE_SUMMARY,
      kind: 'lesson',
    });
    expect(result.kind).toBe('ok');
    expect(adapter.records).toHaveLength(1);
    expect(adapter.records[0].anchorKey).toBe(
      'persona.estate-manager.eviction',
    );
    expect(adapter.records[0].approvalRecordId).toBe('appr_42');
  });

  it('refuses when approvalRecordId is null (defence-in-depth)', async () => {
    const result = await tool.execute(makeCtx({ approvalRecordId: null }), {
      anchorKey: 'persona.estate-manager.eviction',
      summary: SAMPLE_SUMMARY,
      kind: 'lesson',
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('APPROVAL_MISSING');
    }
    expect(adapter.records).toHaveLength(0);
  });

  it('refuses when adapter is not wired', async () => {
    const stubTool = createSelfModificationPowerTool(null);
    const result = await stubTool.execute(makeCtx(), {
      anchorKey: 'persona.estate-manager.eviction',
      summary: SAMPLE_SUMMARY,
      kind: 'lesson',
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('NOT_IMPLEMENTED');
    }
  });

  it('refuses summary with control characters', async () => {
    // Build the polluted string from `fromCharCode` so a tool-roundtrip
    // that strips literal control bytes cannot weaken the assertion.
    const polluted =
      'When the tenant cites the Rent Restriction Act, ' +
      String.fromCharCode(0) +
      'slow down and quote section by section.';
    const result = await tool.execute(makeCtx(), {
      anchorKey: 'persona.estate-manager.eviction',
      summary: polluted,
      kind: 'lesson',
    });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toContain('control characters');
    }
    expect(adapter.records).toHaveLength(0);
  });

  it('Zod schema rejects anchorKey with disallowed characters', () => {
    const parsed = tool.schema.safeParse({
      anchorKey: 'persona.estate-manager.eviction with spaces',
      summary: SAMPLE_SUMMARY,
      kind: 'lesson',
    });
    expect(parsed.success).toBe(false);
  });
});
