import { describe, it, expect } from 'vitest';
import {
  InMemoryKnowledgeStore,
  KnowledgeChunkSchema,
} from '../knowledge-store.js';
import { indexDocument, splitIntoChunks } from '../knowledge-indexer.js';
import { retrieveKnowledge } from '../knowledge-retriever.js';
import { buildCitation, renderCitationInline } from '../citations.js';
import { getPolicyPack, listPolicyPacks, POLICY_PACKS } from '../policy-packs.js';

describe('knowledge-store', () => {
  it('upserts and retrieves a chunk', async () => {
    const store = new InMemoryKnowledgeStore();
    const chunk = await store.upsert({
      tenantId: 't1',
      knowledgeSource: 'handbook',
      title: 'Rent collection playbook',
      chunkIndex: 0,
      content: 'Send the first reminder on day 3 after the rent due date.',
      kind: 'playbook',
      tags: ['arrears'],
      metadata: {},
    });
    expect(chunk.id).toBeTruthy();
    const results = await store.search({
      tenantId: 't1',
      query: 'reminder day 3',
      limit: 5,
    });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(chunk.id);
  });

  it('isolates tenants — no cross-tenant reads', async () => {
    const store = new InMemoryKnowledgeStore();
    await store.upsert({
      tenantId: 't1',
      knowledgeSource: 'h',
      title: 'T1 secret',
      chunkIndex: 0,
      content: 'confidential tenant-one policy',
      kind: 'knowledge_base',
      tags: [],
      metadata: {},
    });
    const crossRead = await store.search({ tenantId: 't2', query: 'confidential' });
    expect(crossRead.length).toBe(0);
  });

  it('removes only chunks owned by the caller tenant', async () => {
    const store = new InMemoryKnowledgeStore();
    const c = await store.upsert({
      tenantId: 't1',
      knowledgeSource: 'h',
      title: 'p',
      chunkIndex: 0,
      content: 'hi',
      kind: 'knowledge_base',
      tags: [],
      metadata: {},
    });
    expect(await store.remove('t2', c.id)).toBe(false);
    expect(await store.remove('t1', c.id)).toBe(true);
  });
});

describe('knowledge-indexer', () => {
  it('splits a long body into overlapping chunks', () => {
    const body = Array(10).fill('Paragraph content.').join('\n\n');
    const chunks = splitIntoChunks(body, 40, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('indexes a document end-to-end', async () => {
    const store = new InMemoryKnowledgeStore();
    const result = await indexDocument(store, {
      tenantId: 't1',
      knowledgeSource: 'manual',
      sourceId: 'policy-001',
      kind: 'policy_pack',
      title: 'Arrears escalation policy',
      body: 'Day 1: gentle reminder.\n\nDay 10: firm reminder.\n\nDay 30: formal demand.',
      tags: ['arrears'],
      chunkSize: 50,
      chunkOverlap: 10,
    });
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.chunks[0].tenantId).toBe('t1');
  });
});

describe('knowledge-retriever', () => {
  it('returns citations for matched chunks', async () => {
    const store = new InMemoryKnowledgeStore();
    await store.upsert({
      tenantId: 't1',
      knowledgeSource: 'compliance',
      sourceId: 'LTA-4',
      title: 'Kenya LTA section 4',
      chunkIndex: 0,
      content: 'For controlled tenancies, the landlord must serve notice 60 days before termination.',
      kind: 'legal_reference',
      tags: ['kenya'],
      metadata: {},
      countryCode: 'KE',
    });
    const out = await retrieveKnowledge(store, {
      tenantId: 't1',
      query: '60 days notice termination',
      countryCode: 'KE',
    });
    expect(out.snippets.length).toBe(1);
    expect(out.snippets[0].citation.source).toBe('compliance');
    expect(out.snippets[0].citation.countryCode).toBe('KE');
  });

  it('filters by country', async () => {
    const store = new InMemoryKnowledgeStore();
    await store.upsert({
      tenantId: 't1',
      knowledgeSource: 's',
      title: 'Tanzania ref',
      chunkIndex: 0,
      content: 'tanzania rule',
      kind: 'legal_reference',
      tags: [],
      metadata: {},
      countryCode: 'TZ',
    });
    const out = await retrieveKnowledge(store, {
      tenantId: 't1',
      query: 'rule',
      countryCode: 'KE',
    });
    expect(out.snippets.length).toBe(0);
  });

  it('respects the limit', async () => {
    const store = new InMemoryKnowledgeStore();
    for (let i = 0; i < 10; i += 1) {
      await store.upsert({
        tenantId: 't1',
        knowledgeSource: 's',
        title: `chunk ${i}`,
        chunkIndex: i,
        content: 'common term token',
        kind: 'knowledge_base',
        tags: [],
        metadata: {},
      });
    }
    const out = await retrieveKnowledge(store, {
      tenantId: 't1',
      query: 'common',
      limit: 3,
    });
    expect(out.snippets.length).toBe(3);
  });
});

describe('citations', () => {
  it('builds and renders a citation', () => {
    const chunk = KnowledgeChunkSchema.parse({
      id: 'c1',
      tenantId: 't1',
      knowledgeSource: 'compliance',
      sourceId: 'LTA-4',
      title: 'Kenya LTA section 4',
      chunkIndex: 0,
      content: 'notice 60 days',
      kind: 'legal_reference',
      tags: [],
      metadata: {},
      countryCode: 'KE',
    });
    const cit = buildCitation(chunk);
    expect(cit.citationId).toContain('c1');
    expect(renderCitationInline(cit)).toContain('Kenya LTA');
    expect(renderCitationInline(cit)).toContain('KE');
  });
});

describe('policy-packs', () => {
  it('ships four country packs', () => {
    expect(listPolicyPacks().length).toBe(4);
  });

  it('retrieves Kenya pack by code', () => {
    const pack = getPolicyPack('KE');
    expect(pack.countryCode).toBe('KE');
    expect(pack.keyReferences.length).toBeGreaterThan(0);
  });

  it('every pack has key references', () => {
    for (const pack of Object.values(POLICY_PACKS)) {
      expect(pack.keyReferences.length).toBeGreaterThan(0);
    }
  });
});
