/**
 * Orchestrator end-to-end tests through the in-memory ports.
 */

import { describe, it, expect } from 'vitest';
import {
  createAdvisor,
  createEchoBrain,
  createStaticDataPort,
  createInMemoryAuditPort,
  type DataSnippet,
} from '../index.js';

function buildAdvisor(snippets: ReadonlyArray<DataSnippet>) {
  const brain = createEchoBrain();
  const data = createStaticDataPort(snippets);
  const audit = createInMemoryAuditPort();
  const advisor = createAdvisor({ brain, data, audit });
  return { advisor, audit };
}

describe('orchestrator.advise — happy path per role', () => {
  it('tenant asking own-lease question gets the lease snippet quoted', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'lease-1',
        resource: 'own-lease',
        scope: 'own',
        ownedByUser: true,
        tenantId: 't1',
        summary: 'Your lease ends 2026-08-31; current monthly rent KES 95,000.',
        data: { tenantId: 't1', rent: 95000 },
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'When does my lease end and what is the rent?',
    });
    expect(res.answer).toContain('Your lease ends 2026-08-31');
    expect(res.citations).toHaveLength(1);
    expect(res.intent).toBe('lease-question');
  });

  it('owner asking same question gets owner-tone framing', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'prop-1',
        resource: 'owned-properties',
        scope: 'own',
        ownedByUser: true,
        tenantId: 't1',
        summary: 'Property 4 Riverside — 12 units, 92% occupancy.',
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u2', tenantId: 't1', role: 'owner' },
      question: 'How are my owned properties doing?',
    });
    // Owner persona has 'professional' tone — system prompt should
    // include the ROI framing language.
    expect(res.answer.toLowerCase()).toContain('return on investment');
  });

  it('admin asking platform-overview gets authoritative tone', async () => {
    const { advisor } = buildAdvisor([]);
    const res = await advisor.advise({
      user: { id: 'a1', tenantId: 't1', role: 'admin' },
      question: 'Random question with no specific intent',
    });
    expect(res.answer.toLowerCase()).toContain('audit');
    expect(res.intent).toBe('general');
  });

  it('PM gets renewal-strategy framing for "is my rent fair" question', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'mkt-1',
        resource: 'public-market-data',
        scope: 'public',
        tenantId: 't1',
        summary: 'Market median rent for the area is KES 90,000.',
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'p1', tenantId: 't1', role: 'property-manager' },
      question: 'Is my rent fair given the market?',
    });
    expect(res.answer.toLowerCase()).toContain('renewal-rate');
  });
});

describe('orchestrator.advise — guard refuses cross-tenant', () => {
  it('tenant trying to read another tenant\'s data via mismatched tenantId is refused', async () => {
    const { advisor, audit } = buildAdvisor([
      {
        id: 'lease-other',
        resource: 'own-lease',
        scope: 'own',
        ownedByUser: false,
        tenantId: 'tnt-OTHER',
        summary: "Other person's lease info.",
        data: { rent: 100000 },
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'Show me the lease for unit 4B which I think is mine.',
    });
    // Snippet should be denied; orchestrator emits a refusal text.
    expect(res.answer.toLowerCase()).toContain('only discuss your own records');
    expect(res.deniedSnippetIds).toContain('lease-other');
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0]?.outcome).toBe('ok');
  });

  it('tenant cannot read managed-portfolio data even with matching tenantId', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'portfolio-1',
        resource: 'managed-portfolio',
        scope: 'tenant-wide',
        tenantId: 't1',
        summary: 'The portfolio includes 200 units across 12 buildings.',
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'Tell me about the managed portfolio for this org.',
    });
    expect(res.deniedSnippetIds).toContain('portfolio-1');
  });

  it('owner asking about tenants gets aggregated, PII-stripped response', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'agg-1',
        resource: 'tenant-aggregate-no-pii',
        scope: 'tenant-wide',
        tenantId: 't1',
        summary: 'Tenant Asha at unit 12 has been late twice this year.',
        data: {
          unit: '12',
          name: 'Asha',
          email: 'asha@example.com',
          lateCount: 2,
        },
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u2', tenantId: 't1', role: 'owner' },
      question: 'How are my tenants performing on payments?',
    });
    expect(res.redactedFields).toContain('name');
    expect(res.redactedFields).toContain('email');
    // The summary string PII should also have been redacted.
    expect(res.answer).not.toMatch(/asha@example\.com/i);
  });
});

describe('orchestrator.advise — own-lease passes through', () => {
  it('tenant asking own lease gets the lease in evidence', async () => {
    const { advisor } = buildAdvisor([
      {
        id: 'lease-x',
        resource: 'own-lease',
        scope: 'own',
        ownedByUser: true,
        tenantId: 't1',
        summary: 'Your lease at unit 7C runs through 2027-05-01.',
      },
    ]);
    const res = await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'When does my lease run through?',
    });
    expect(res.evidence.some((e) => e.id === 'lease-x')).toBe(true);
  });
});

describe('orchestrator.advise — audit', () => {
  it('writes exactly one audit entry per advise call', async () => {
    const { advisor, audit } = buildAdvisor([]);
    await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'hello',
    });
    expect(audit.entries.length).toBe(1);
  });

  it('audit entry contains role + intent', async () => {
    const { advisor, audit } = buildAdvisor([]);
    await advisor.advise({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      question: 'My lease is up for renewal.',
    });
    const entry = audit.entries[0]!;
    expect(entry.role).toBe('tenant');
    expect(entry.intent).toBe('lease-question');
    expect(entry.action).toBe('advisor.ask');
  });

  it('audit entry includes redactedFields when redaction happened', async () => {
    const { advisor, audit } = buildAdvisor([
      {
        id: 'agg-1',
        resource: 'tenant-aggregate-no-pii',
        scope: 'tenant-wide',
        tenantId: 't1',
        summary: 'aggregate.',
        data: { name: 'Asha', count: 5 },
      },
    ]);
    await advisor.advise({
      user: { id: 'u2', tenantId: 't1', role: 'owner' },
      question: 'Tenant aggregate summary.',
    });
    const entry = audit.entries[0]!;
    expect(entry.redactedFields).toContain('name');
  });
});

describe('orchestrator.advise — follow-ups', () => {
  it('emits role-tuned follow-ups for a lease question', async () => {
    const { advisor } = buildAdvisor([]);
    const tenantRes = await advisor.advise({
      user: { id: 'u', tenantId: 't', role: 'tenant' },
      question: 'My lease is ending.',
    });
    const ownerRes = await advisor.advise({
      user: { id: 'u', tenantId: 't', role: 'owner' },
      question: 'My tenant\'s lease is ending.',
    });
    expect(tenantRes.suggestedFollowUps).not.toEqual(
      ownerRes.suggestedFollowUps,
    );
    expect(tenantRes.suggestedFollowUps.length).toBeGreaterThan(0);
  });

  it('falls back to generic follow-ups for general intent', async () => {
    const { advisor } = buildAdvisor([]);
    const res = await advisor.advise({
      user: { id: 'u', tenantId: 't', role: 'tenant' },
      question: 'xyzzy',
    });
    expect(res.suggestedFollowUps.length).toBeGreaterThan(0);
  });
});

describe('orchestrator.advise — sessionId + answerId', () => {
  it('forwards sessionId into the audit entry', async () => {
    const { advisor, audit } = buildAdvisor([]);
    await advisor.advise({
      user: { id: 'u', tenantId: 't', role: 'tenant' },
      question: 'q',
      sessionId: 'sess-123',
    });
    expect(audit.entries[0]?.sessionId).toBe('sess-123');
  });

  it('emits a stable answerId shape', async () => {
    const { advisor } = buildAdvisor([]);
    const res = await advisor.advise({
      user: { id: 'u', tenantId: 't', role: 'tenant' },
      question: 'q',
    });
    expect(res.answerId.startsWith('ans_')).toBe(true);
  });
});
