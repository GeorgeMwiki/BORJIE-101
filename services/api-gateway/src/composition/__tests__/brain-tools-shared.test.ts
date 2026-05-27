/**
 * Persona-aware brain-tool catalog — shared-tools tests.
 *
 * Covers the four tools every persona gets (`borjie.ask`, `borjie.cite`,
 * `documents.upload`, `documents.search`) plus the persona-gating /
 * kill-switch invariants implemented in `types.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPersonaToolHandlers,
  toBrainToolHandler,
  SHARED_TOOLS,
  type PersonaToolAuditEntry,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import { borjieAskTool, documentsUploadTool } from '../brain-tools/shared-tools';

function makeHttpClientMock(): PersonaToolHttpClient {
  return {
    async get<T>(_path: string): Promise<T> {
      return { hits: [], totalHits: 0 } as unknown as T;
    },
    async post<T>(_path: string): Promise<T> {
      return {
        answer: 'mock answer',
        evidenceIds: ['ev-1'],
        documentId: 'doc-1',
        uploadUrl: 'https://example.com/upload',
        expiresAt: new Date().toISOString(),
      } as unknown as T;
    },
  };
}

function makeContext(personaSlug: string) {
  return {
    tenant: { tenantId: 't-1' } as never,
    actor: { id: 'u-1' } as never,
    persona: { id: 'p-1', allowedTools: [] } as never,
    threadId: 'th-1',
  };
}

function makeGate(overrides: Partial<PersonaToolGate> = {}): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => 'T1_owner_strategist',
    httpClient: makeHttpClientMock(),
    ...overrides,
  };
}

describe('shared-tools — registration', () => {
  it('exposes four shared tools', () => {
    const ids = SHARED_TOOLS.map((t) => t.id).sort();
    expect(ids).toEqual([
      'borjie.ask',
      'borjie.cite',
      'documents.search',
      'documents.upload',
    ]);
  });

  it('exposes every shared tool to every persona slug', () => {
    for (const tool of SHARED_TOOLS) {
      expect(tool.personaSlugs).toContain('T1_owner_strategist');
      expect(tool.personaSlugs).toContain('T4_field_employee');
      expect(tool.personaSlugs).toContain('T_auditor');
    }
  });
});

describe('shared-tools — execution', () => {
  it('runs borjie.ask with valid input', async () => {
    const handler = toBrainToolHandler(borjieAskTool, makeGate());
    const result = await handler.execute(
      { question: 'how many tonnes today?' },
      makeContext('T1_owner_strategist') as never,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('answer');
  });

  it('rejects borjie.ask on missing required field (zod fail)', async () => {
    const handler = toBrainToolHandler(borjieAskTool, makeGate());
    const result = await handler.execute(
      {},
      makeContext('T1_owner_strategist') as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid params/);
  });

  it('refuses every tool when kill-switch is open', async () => {
    const handler = toBrainToolHandler(
      borjieAskTool,
      makeGate({ killSwitchOpen: true }),
    );
    const result = await handler.execute(
      { question: 'anything' },
      makeContext('T1_owner_strategist') as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/kill-switch open/);
  });

  it('refuses when persona cannot be resolved (fail-closed)', async () => {
    const handler = toBrainToolHandler(
      borjieAskTool,
      makeGate({ resolvePersonaSlug: () => undefined }),
    );
    const result = await handler.execute(
      { question: 'anything' },
      makeContext('T1_owner_strategist') as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/persona not resolved/);
  });
});

describe('catalog gating', () => {
  it('returns empty catalog when kill-switch is open', () => {
    const handlers = buildPersonaToolHandlers(
      makeGate({ killSwitchOpen: true }),
    );
    expect(handlers.length).toBe(0);
  });

  it('returns all 43 unique tool ids when kill-switch is closed', () => {
    const handlers = buildPersonaToolHandlers(makeGate());
    const uniqueIds = new Set(handlers.map((h) => h.name));
    // 4 shared + 8 owner + 9 manager + 9 worker + 7 buyer + 6 admin = 43
    expect(uniqueIds.size).toBe(43);
    expect(handlers.length).toBe(43);
  });

  it('emits an audit entry for write tools', async () => {
    const collected: PersonaToolAuditEntry[] = [];
    const sink = {
      async append(entry: PersonaToolAuditEntry) {
        collected.push(entry);
      },
    };
    // documents.upload is read-only — pick a write tool from a persona file.
    const handler = toBrainToolHandler(
      {
        ...documentsUploadTool,
        id: 'documents.upload.test-write',
        isWrite: true,
      },
      makeGate({ auditSink: sink }),
    );
    const result = await handler.execute(
      {
        fileName: 'kyc.pdf',
        contentType: 'application/pdf',
        byteSize: 1024,
      },
      makeContext('T1_owner_strategist') as never,
    );
    expect(result.ok).toBe(true);
    expect(collected).toHaveLength(1);
    expect(collected[0].outcome).toBe('ok');
    expect(collected[0].tenantId).toBe('t-1');
  });
});
