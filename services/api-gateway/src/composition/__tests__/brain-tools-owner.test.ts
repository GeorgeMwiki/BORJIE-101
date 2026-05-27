/**
 * Owner-tools tests (T1_owner_strategist).
 *
 * Verifies:
 *   - Tool count + every tool gated to the owner slug
 *   - Daily brief runs with valid input
 *   - Persona gating refuses calls from worker / buyer slugs
 *   - HTTP client receives the tenant id from the execution context
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  OWNER_TOOLS,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import { ownerDailyBriefTool } from '../brain-tools/owner-tools';

interface CapturedCall {
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

function recordingClient(): {
  readonly client: PersonaToolHttpClient;
  readonly calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  return {
    calls,
    client: {
      async get<T>(path: string, init?: { query?: Readonly<Record<string, string | number | undefined>> }): Promise<T> {
        calls.push({ path, query: init?.query });
        return {
          headlineEn: 'all systems nominal',
          headlineSw: 'mifumo yote ni shwari',
          highlights: [],
          generatedAt: new Date().toISOString(),
        } as unknown as T;
      },
      async post<T>(path: string, body: Readonly<Record<string, unknown>>): Promise<T> {
        calls.push({ path, body });
        return {} as T;
      },
    },
  };
}

function gateWithOwner(httpClient: PersonaToolHttpClient): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => 'T1_owner_strategist',
    httpClient,
  };
}

function ctx() {
  return {
    tenant: { tenantId: 'tenant-owner-1' } as never,
    actor: { id: 'actor-1' } as never,
    persona: { id: 'p-1', allowedTools: [] } as never,
    threadId: 'th-1',
  };
}

describe('owner-tools — surface', () => {
  it('registers exactly eight owner tools', () => {
    expect(OWNER_TOOLS).toHaveLength(8);
  });

  it('every owner tool is gated to T1_owner_strategist only', () => {
    for (const t of OWNER_TOOLS) {
      expect(t.personaSlugs).toEqual(['T1_owner_strategist']);
    }
  });

  it('every owner tool is read-only (no WRITE in cockpit)', () => {
    for (const t of OWNER_TOOLS) {
      expect(t.isWrite).toBe(false);
    }
  });
});

describe('owner-tools — execution', () => {
  it('runs mining.cockpit.daily-brief with valid input', async () => {
    const { client, calls } = recordingClient();
    const handler = toBrainToolHandler(ownerDailyBriefTool, gateWithOwner(client));
    const result = await handler.execute({ locale: 'sw' }, ctx() as never);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/mining/cockpit/daily-brief');
    expect(calls[0].query?.tenantId).toBe('tenant-owner-1');
    expect(calls[0].query?.locale).toBe('sw');
  });

  it('rejects invalid locale (zod enum fail)', async () => {
    const { client } = recordingClient();
    const handler = toBrainToolHandler(ownerDailyBriefTool, gateWithOwner(client));
    const result = await handler.execute(
      { locale: 'fr' as never },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid params/);
  });

  it('refuses when caller persona is a worker, not an owner', async () => {
    const { client } = recordingClient();
    const gate: PersonaToolGate = {
      killSwitchOpen: false,
      resolvePersonaSlug: () => 'T4_field_employee',
      httpClient: client,
    };
    const handler = toBrainToolHandler(ownerDailyBriefTool, gate);
    const result = await handler.execute({}, ctx() as never);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/persona T4_field_employee not in allowlist/);
  });
});
