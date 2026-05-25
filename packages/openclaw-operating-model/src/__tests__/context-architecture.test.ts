import { describe, expect, it } from 'vitest';
import {
  assembleAgentContext,
  clearanceRank,
  defineContextSource,
  hasClearance,
  redactPii,
  type ContextFragmentFetcher,
  type ContextFragmentWithLayer,
} from '../index.js';

describe('context-architecture / PII clearance', () => {
  it('clearanceRank orders levels: none < low < medium < high', () => {
    expect(clearanceRank('none')).toBeLessThan(clearanceRank('low'));
    expect(clearanceRank('low')).toBeLessThan(clearanceRank('medium'));
    expect(clearanceRank('medium')).toBeLessThan(clearanceRank('high'));
  });

  it('hasClearance permits agent ≥ fragment requirement', () => {
    expect(
      hasClearance({ agentClearance: 'high', fragmentRequires: 'medium' }),
    ).toBe(true);
    expect(
      hasClearance({ agentClearance: 'low', fragmentRequires: 'high' }),
    ).toBe(false);
    expect(
      hasClearance({ agentClearance: 'medium', fragmentRequires: 'medium' }),
    ).toBe(true);
  });
});

describe('context-architecture / PII redaction', () => {
  it('redacts email addresses', () => {
    const { redacted, hits } = redactPii('Contact admin@example.com please');
    expect(redacted).toContain('[REDACTED:email]');
    expect(hits.some((h) => h.kind === 'email')).toBe(true);
  });

  it('redacts TZ phone numbers', () => {
    const { redacted } = redactPii('Call +255712345678 today');
    expect(redacted).toContain('[REDACTED:phone-tz]');
  });

  it('redacts NIDA 20-digit ids', () => {
    const { redacted } = redactPii('NIDA 19850101140912345001 verified');
    expect(redacted).toContain('[REDACTED:nida-tz]');
  });

  it('leaves clean text untouched', () => {
    const { redacted, hits } = redactPii('Regular sentence with no PII.');
    expect(redacted).toBe('Regular sentence with no PII.');
    expect(hits).toHaveLength(0);
  });
});

describe('context-architecture / defineContextSource', () => {
  it('round-trips a source definition', () => {
    const s = defineContextSource({
      id: 'src-1',
      name: 'Leases DB',
      kind: 'database',
      tenantScope: 'tenant',
      refreshPolicy: 'cached-5m',
      piiClearanceRequired: 'medium',
    });
    expect(s.id).toBe('src-1');
    expect(s.tenantScope).toBe('tenant');
  });
});

describe('context-architecture / assembleAgentContext', () => {
  function makeFetcher(
    fragments: ReadonlyArray<ContextFragmentWithLayer>,
  ): ContextFragmentFetcher {
    return {
      fetch: async () => fragments,
    };
  }

  it('returns layered context with token budget honoured', async () => {
    const src = defineContextSource({
      id: 'rag',
      name: 'KG',
      kind: 'knowledge_graph',
      tenantScope: 'tenant',
      refreshPolicy: 'realtime',
      piiClearanceRequired: 'none',
    });
    const fragments: ContextFragmentWithLayer[] = [
      {
        id: 'f1',
        sourceId: 'rag',
        kind: 'knowledge_graph',
        content: 'a',
        approxTokens: 100,
        piiClearanceRequired: 'none',
        layer: 'persistent',
      },
      {
        id: 'f2',
        sourceId: 'rag',
        kind: 'knowledge_graph',
        content: 'b',
        approxTokens: 200,
        piiClearanceRequired: 'none',
        layer: 'structured',
      },
      {
        id: 'f3',
        sourceId: 'rag',
        kind: 'knowledge_graph',
        content: 'c',
        approxTokens: 9999,
        piiClearanceRequired: 'none',
        layer: 'retrieved',
      },
    ];
    const ctx = await assembleAgentContext({
      agentId: 'a',
      taskId: 't',
      tenantId: 'tenant-1',
      agentPiiClearance: 'high',
      sources: [src],
      fetcher: makeFetcher(fragments),
      query: 'q',
      budgetTokens: 500,
    });
    expect(ctx.approxTokens).toBeLessThanOrEqual(500);
    expect(ctx.persistent).toHaveLength(1);
    expect(ctx.structured).toHaveLength(1);
    expect(ctx.retrieved).toHaveLength(0);
    expect(ctx.redactedFragmentIds).toContain('f3');
  });

  it('redacts fragments above agent clearance', async () => {
    const src = defineContextSource({
      id: 'pii-src',
      name: 'PII',
      kind: 'database',
      tenantScope: 'tenant',
      refreshPolicy: 'realtime',
      piiClearanceRequired: 'high',
    });
    const fragments: ContextFragmentWithLayer[] = [
      {
        id: 'pf1',
        sourceId: 'pii-src',
        kind: 'database',
        content: 'sensitive',
        approxTokens: 10,
        piiClearanceRequired: 'high',
        layer: 'structured',
      },
    ];
    const ctx = await assembleAgentContext({
      agentId: 'a',
      taskId: 't',
      tenantId: 'tenant-1',
      agentPiiClearance: 'low',
      sources: [src],
      fetcher: makeFetcher(fragments),
      query: 'q',
      budgetTokens: 1000,
    });
    expect(ctx.structured).toHaveLength(0);
    expect(ctx.redactedFragmentIds).toContain('pf1');
  });

  it('drops cross-tenant fragments (tenant-scope leak guard)', async () => {
    const src = defineContextSource({
      id: 'multi',
      name: 'Multi-tenant DB',
      kind: 'database',
      tenantScope: 'tenant',
      refreshPolicy: 'realtime',
      piiClearanceRequired: 'none',
    });
    const fragments: ContextFragmentWithLayer[] = [
      {
        id: 'own',
        sourceId: 'multi',
        kind: 'database',
        content: 'ours',
        approxTokens: 10,
        piiClearanceRequired: 'none',
        layer: 'structured',
        tenantId: 'tenant-1',
      },
      {
        id: 'other',
        sourceId: 'multi',
        kind: 'database',
        content: 'leak',
        approxTokens: 10,
        piiClearanceRequired: 'none',
        layer: 'structured',
        tenantId: 'tenant-2',
      },
    ];
    const ctx = await assembleAgentContext({
      agentId: 'a',
      taskId: 't',
      tenantId: 'tenant-1',
      agentPiiClearance: 'high',
      sources: [src],
      fetcher: makeFetcher(fragments),
      query: 'q',
      budgetTokens: 1000,
    });
    expect(ctx.structured.some((f) => f.id === 'own')).toBe(true);
    expect(ctx.structured.some((f) => f.id === 'other')).toBe(false);
    expect(ctx.redactedFragmentIds).toContain('other');
  });

  it('skips user-scoped sources when userId is absent', async () => {
    const src = defineContextSource({
      id: 'user-src',
      name: 'User',
      kind: 'database',
      tenantScope: 'user',
      refreshPolicy: 'realtime',
      piiClearanceRequired: 'none',
    });
    let called = false;
    const fetcher: ContextFragmentFetcher = {
      fetch: async () => {
        called = true;
        return [];
      },
    };
    const ctx = await assembleAgentContext({
      agentId: 'a',
      taskId: 't',
      tenantId: 'tenant-1',
      agentPiiClearance: 'high',
      sources: [src],
      fetcher,
      query: 'q',
      budgetTokens: 1000,
    });
    expect(called).toBe(false);
    expect(ctx.structured).toHaveLength(0);
  });
});
