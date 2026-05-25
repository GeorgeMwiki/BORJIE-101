/**
 * DataPort integration test.
 *
 * Wires the real profile + signal + trigger + search stack with mocked
 * db + spy audit. Exercises:
 *   - Returns ranked snippets
 *   - Calls the audit port exactly once
 *   - Honours role scoping (a PM question doesn't get tenant-only docs)
 *   - Revoked consent → empty snippets BUT audit row still written
 */
import { describe, expect, it, vi } from 'vitest';
import { createUserContextDataPort } from '../data-port.js';
import { InMemoryCorpusIndex } from '../search/in-memory-index.js';
import { createMockEmbedder } from '../search/embedders.js';
import type { CorpusItem, ContextAuditPort } from '../types.js';

const embedder = createMockEmbedder({ dimension: 32 });

async function makeItem(
  id: string,
  text: string,
  overrides: Partial<CorpusItem> = {},
): Promise<CorpusItem> {
  return {
    id,
    tenantId: overrides.tenantId ?? 't1',
    visibleToUserIds: overrides.visibleToUserIds ?? '*',
    visibleToRoles: overrides.visibleToRoles ?? ['tenant'],
    source: `doc ${id}`,
    citation: { kind: 'document', id },
    content: text,
    embedding: await embedder.embed(text),
    ...overrides,
  };
}

function fakeDb(consent: 'granted' | 'implicit' | 'revoked' = 'implicit') {
  return {
    async execute(args: unknown) {
      const arg = args as { sql?: string };
      const sql = arg.sql ?? '';
      if (sql.includes('user_consent_preferences')) {
        return { rows: [{ decision: consent }] };
      }
      // Profile / signal queries — return empty so we get a thin dossier.
      return { rows: [] };
    },
  };
}

function spyAudit(): ContextAuditPort & { calls: Array<unknown> } {
  const calls: Array<unknown> = [];
  return {
    calls,
    recordFetch(record) {
      calls.push(record);
    },
  };
}

describe('createUserContextDataPort', () => {
  it('returns snippets including profile + search results', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    index.add(await makeItem('a', 'lease renewal policy details'));
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb('granted'),
      embedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'lease.renewal',
      question: 'When does my lease renew?',
    });
    expect(snippets.length).toBeGreaterThan(0);
    expect(audit.calls.length).toBe(1);
  });

  it('records audit exactly once per call', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb(),
      embedder,
      audit,
      index,
    });
    await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'x',
      question: 'y',
    });
    expect(audit.calls).toHaveLength(1);
    const rec = audit.calls[0] as { role: string; consent: string };
    expect(rec.role).toBe('tenant');
    expect(rec.consent).toBe('implicit');
  });

  it('returns no snippets when consent is revoked, still audits', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    index.add(await makeItem('a', 'lease info'));
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb('revoked'),
      embedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'x',
      question: 'y',
    });
    expect(snippets).toEqual([]);
    expect(audit.calls).toHaveLength(1);
    const rec = audit.calls[0] as { consent: string; snippetCount: number };
    expect(rec.consent).toBe('revoked');
    expect(rec.snippetCount).toBe(0);
  });

  it('respects role scoping in semantic search', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    // Doc only visible to PMs.
    index.add(await makeItem('pm-only', 'manager analytics', { visibleToRoles: ['pm'] }));
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb(),
      embedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'reports',
      question: 'manager analytics',
    });
    expect(snippets.every((s) => s.source !== 'doc pm-only')).toBe(true);
  });

  it('does not throw when search fails', async () => {
    const audit = spyAudit();
    // Use a broken embedder so search throws.
    const brokenEmbedder = {
      dimension: 32,
      embed: async () => { throw new Error('embed failed'); },
    };
    const index = new InMemoryCorpusIndex(brokenEmbedder);
    index.add(await makeItem('a', 'x'));
    const port = createUserContextDataPort({
      db: fakeDb('granted'),
      embedder: brokenEmbedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'x',
      question: 'y',
    });
    // Profile snippets may still appear; the call should not have thrown.
    expect(Array.isArray(snippets)).toBe(true);
  });

  it('intent-aware ranking boosts content that mentions intent tokens', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    index.add(await makeItem('a', 'maintenance request submission instructions'));
    index.add(await makeItem('b', 'general dashboard navigation tips'));
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb('granted'),
      embedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'tenant',
      tenantId: 't1',
      userId: 'u1',
      intent: 'maintenance submission help',
      question: 'unrelated topic',
    });
    const hasMaintenance = snippets.some((s) => /maintenance/.test(s.content));
    expect(hasMaintenance).toBe(true);
  });

  it('minimises PII when audience is not data_subject', async () => {
    const index = new InMemoryCorpusIndex(embedder);
    index.add(await makeItem('a', 'contact alice@example.com today'));
    const audit = spyAudit();
    const port = createUserContextDataPort({
      db: fakeDb('granted'),
      embedder,
      audit,
      index,
    });
    const snippets = await port.fetchSnippets({
      role: 'pm',
      tenantId: 't1',
      userId: 'u1',
      intent: 'tenant',
      question: 'contact info',
    });
    const joined = snippets.map((s) => s.content).join(' ');
    if (joined.includes('alice')) {
      // If the snippet survived ranking, it should be redacted.
      expect(joined).toContain('[redacted:email]');
    }
    // Vitality: at least audit ran.
    expect(audit.calls).toHaveLength(1);
    // Silence unused-import lint when no email path triggers.
    void vi;
  });
});
