/**
 * undo-chain-tools tests — Wave CE-5.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  UNDO_CHAIN_TOOLS,
  undoLastNTool,
  undoByIdTool,
} from '../undo-chain-tools.js';

const CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
  chatSessionId: 'sess-1',
  chatTurnId: 'turn-1',
});

describe('undoLastNTool', () => {
  it('throws without httpClient', async () => {
    await expect(
      undoLastNTool.handler({ n: 3 }, CTX),
    ).rejects.toThrow(/requires httpClient/);
  });

  it('chains N successful undos and returns all ids', async () => {
    let i = 0;
    const post = vi.fn(async () => {
      i += 1;
      return {
        data: { undone: true, journalId: `j${i}` },
      };
    });
    const result = await undoLastNTool.handler(
      { n: 3 },
      { ...CTX, httpClient: { get: vi.fn(), post } },
    );
    expect(result.requested).toBe(3);
    expect(result.undoneCount).toBe(3);
    expect(result.undoneIds).toEqual(['j1', 'j2', 'j3']);
    expect(result.stoppedReason).toBeNull();
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('stops early when the journal returns undone=false', async () => {
    let i = 0;
    const post = vi.fn(async () => {
      i += 1;
      if (i === 2) return { data: { undone: false, journalId: null } };
      return { data: { undone: true, journalId: `j${i}` } };
    });
    const result = await undoLastNTool.handler(
      { n: 5 },
      { ...CTX, httpClient: { get: vi.fn(), post } },
    );
    expect(result.undoneCount).toBe(1);
    expect(result.undoneIds).toEqual(['j1']);
    expect(result.stoppedReason).toBe('no_more_reversible_actions');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('forwards chat provenance with a per-step reason suffix', async () => {
    const post = vi.fn(async () => ({
      data: { undone: true, journalId: 'j1' },
    }));
    await undoLastNTool.handler(
      { n: 2, reason: 'mass cleanup' },
      { ...CTX, httpClient: { get: vi.fn(), post } },
    );
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/owner/undo-journal/undo-last');
    expect(
      (body as Record<string, unknown>).reason,
    ).toContain('step 1/2');
    expect(
      ((body as Record<string, unknown>).provenance as Record<string, unknown>)
        .via,
    ).toBe('chat');
  });

  it('rejects N=0 and N>10 (schema cap)', () => {
    expect(undoLastNTool.inputSchema.safeParse({ n: 0 }).success).toBe(false);
    expect(undoLastNTool.inputSchema.safeParse({ n: 11 }).success).toBe(false);
    expect(undoLastNTool.inputSchema.safeParse({ n: 5 }).success).toBe(true);
  });
});

describe('undoByIdTool', () => {
  it('throws without httpClient', async () => {
    await expect(
      undoByIdTool.handler(
        { journalId: 'j1', reason: 'r' },
        CTX,
      ),
    ).rejects.toThrow(/requires httpClient/);
  });

  it('hits the by-id endpoint with the supplied journalId + reason', async () => {
    const post = vi.fn(async () => ({
      data: {
        undone: true,
        journalId: 'j1',
        actionKind: 'dispatch',
        entityType: 'rfb',
        entityId: 'rfb-1',
      },
    }));
    const result = await undoByIdTool.handler(
      { journalId: 'j1', reason: 'fixed typo' },
      { ...CTX, httpClient: { get: vi.fn(), post } },
    );
    expect(result.undone).toBe(true);
    expect(result.journalId).toBe('j1');
    expect(result.actionKind).toBe('dispatch');
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/owner/undo-journal/undo-by-id');
    expect((body as Record<string, unknown>).reason).toBe('fixed typo');
  });

  it('handles flat response envelope (no .data wrapper)', async () => {
    const post = vi.fn(async () => ({
      undone: true,
      journalId: 'j7',
      actionKind: null,
      entityType: null,
      entityId: null,
    }));
    const result = await undoByIdTool.handler(
      { journalId: 'j7', reason: 'r' },
      { ...CTX, httpClient: { get: vi.fn(), post } },
    );
    expect(result.undone).toBe(true);
    expect(result.journalId).toBe('j7');
  });

  it('requires a non-empty reason for the audit chain', () => {
    expect(
      undoByIdTool.inputSchema.safeParse({ journalId: 'j' }).success,
    ).toBe(false);
  });
});

describe('UNDO_CHAIN_TOOLS catalog', () => {
  it('exports exactly 2 tools with the expected ids', () => {
    expect(UNDO_CHAIN_TOOLS).toHaveLength(2);
    expect(UNDO_CHAIN_TOOLS.map((t) => t.id).sort()).toEqual(
      ['undo.by_id', 'undo.last_n'],
    );
  });

  it('both tools are owner+admin scoped, MEDIUM stakes, isWrite=true', () => {
    for (const tool of UNDO_CHAIN_TOOLS) {
      expect(tool.stakes).toBe('MEDIUM');
      expect(tool.isWrite).toBe(true);
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
    }
  });
});
