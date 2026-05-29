/**
 * Admin-tools tests (T2_admin_strategist).
 *
 * Verifies:
 *   - Six admin tools, all gated to admin slug
 *   - Kill-switch status is HIGH-risk and policy-rule-literal
 *   - Audit-search runs with valid input
 *   - Persona gating refuses an owner from calling admin tools
 *   - Catalog registration goes through brain-extensions registerPersonaToolHandlers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  toBrainToolHandler,
  ADMIN_TOOLS,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  adminAuditSearchTool,
  adminKillSwitchStatusTool,
} from '../brain-tools/admin-tools';
import {
  getBrainExtraSkills,
  registerPersonaToolHandlers,
  setBrainExtraSkills,
} from '../brain-extensions';

function client(): PersonaToolHttpClient {
  return {
    async get<T>(): Promise<T> {
      return {
        isOpen: false,
        lastChangedAt: '2026-01-01T00:00:00.000Z',
        entries: [],
        totalEntries: 0,
      } as unknown as T;
    },
    async post<T>(): Promise<T> {
      return {} as T;
    },
  };
}

function gate(persona: string): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => persona,
    httpClient: client(),
  };
}

function ctx() {
  return {
    tenant: { tenantId: 'tenant-admin' } as never,
    actor: { id: 'admin-1' } as never,
    persona: { id: 'p-a' } as never,
    threadId: 'th-1',
  };
}

describe('admin-tools — surface', () => {
  // Original v1 surface had six admin tools. Issue #194 (Compliance +
  // regulator chain) added adminRegulatorCreateRequestTool which lifts
  // the count to seven. Raise the floor when more land.
  it('registers exactly seven admin tools', () => {
    expect(ADMIN_TOOLS).toHaveLength(7);
  });

  it('every admin tool is gated to T2_admin_strategist only', () => {
    for (const t of ADMIN_TOOLS) {
      expect(t.personaSlugs).toEqual(['T2_admin_strategist']);
    }
  });

  it('kill-switch status is flagged HIGH risk and policy-rule literal', () => {
    expect(adminKillSwitchStatusTool.stakes).toBe('HIGH');
    expect(adminKillSwitchStatusTool.requiresPolicyRuleLiteral).toBe(true);
  });
});

describe('admin-tools — execution', () => {
  it('searches audit trail with valid query', async () => {
    const handler = toBrainToolHandler(
      adminAuditSearchTool,
      gate('T2_admin_strategist'),
    );
    const result = await handler.execute(
      { query: 'login_failed' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses an owner from calling kill-switch status', async () => {
    const handler = toBrainToolHandler(
      adminKillSwitchStatusTool,
      gate('T1_owner_strategist'),
    );
    const result = await handler.execute({}, ctx() as never);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/persona T1_owner_strategist not in allowlist/);
  });
});

describe('brain-extensions — persona tool registration', () => {
  beforeEach(() => {
    setBrainExtraSkills([]);
  });

  it('registers the full catalog in replace mode', () => {
    const handlers = registerPersonaToolHandlers({
      gate: gate('T2_admin_strategist'),
    });
    expect(handlers.length).toBeGreaterThanOrEqual(43);
    const extras = getBrainExtraSkills();
    expect(extras).toEqual(handlers);
  });

  it('returns an empty catalog when kill-switch is open', () => {
    const handlers = registerPersonaToolHandlers({
      gate: { ...gate('T2_admin_strategist'), killSwitchOpen: true },
    });
    expect(handlers).toHaveLength(0);
    expect(getBrainExtraSkills()).toHaveLength(0);
  });

  it('appends without dropping previously-registered skills', () => {
    setBrainExtraSkills([
      {
        name: 'pre-existing-skill',
        description: 'fixture',
        parameters: { type: 'object' },
        async execute() {
          return { ok: true };
        },
      },
    ]);
    const handlers = registerPersonaToolHandlers({
      gate: gate('T2_admin_strategist'),
      mode: 'append',
    });
    const extras = getBrainExtraSkills();
    expect(extras.length).toBe(handlers.length + 1);
    expect(extras[0].name).toBe('pre-existing-skill');
  });

  it('catalog includes the admin.kill-switch.status descriptor by id', () => {
    const handlers = registerPersonaToolHandlers({
      gate: gate('T2_admin_strategist'),
    });
    expect(handlers.map((h) => h.name)).toContain('admin.kill-switch.status');
  });
});
