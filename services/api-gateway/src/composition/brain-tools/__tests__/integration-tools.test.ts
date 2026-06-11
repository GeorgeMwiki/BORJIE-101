/**
 * Integration-fabric brain tools tests.
 *
 * Verifies:
 *   - descriptor shapes: list = LOW/read, invoke = HIGH/write +
 *     requiresPolicyRuleLiteral (egress write hard rule)
 *   - EXACTLY two tools (the generative law — never 21 per-connector tools)
 *   - both registered in the merged persona-aware catalog (index.ts)
 *   - handlers defer to ctx.httpClient against /integrations/connectors
 *   - fail-closed without an httpClient
 */

import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_TOOLS,
  integrationConnectorInvokeTool,
  integrationConnectorListTool,
} from '../integration-tools.js';
import { listPersonaToolDescriptors } from '../index.js';
import type { PersonaToolHttpClient } from '../types.js';

const ctxWith = (
  httpClient?: PersonaToolHttpClient,
): {
  tenantId: string;
  actorId: string;
  personaSlug: string;
  httpClient?: PersonaToolHttpClient;
} => ({
  tenantId: 't-1',
  actorId: 'u-1',
  personaSlug: 'T1_owner_strategist',
  ...(httpClient !== undefined && { httpClient }),
});

describe('integration-fabric tool family (generative law)', () => {
  it('exports EXACTLY two tools — one list, one invoke', () => {
    expect(INTEGRATION_TOOLS).toHaveLength(2);
    expect(INTEGRATION_TOOLS.map((t) => t.id)).toEqual([
      'integration.connector.list',
      'integration.connector.invoke',
    ]);
  });

  it('both are persona-gated to owner + admin', () => {
    for (const tool of INTEGRATION_TOOLS) {
      expect(tool.personaSlugs).toEqual([
        'T1_owner_strategist',
        'T2_admin_strategist',
      ]);
    }
  });
});

describe('integration.connector.list descriptor', () => {
  it('is LOW stakes, read-only, no policy-literal flag', () => {
    expect(integrationConnectorListTool.stakes).toBe('LOW');
    expect(integrationConnectorListTool.isWrite).toBe(false);
    expect(integrationConnectorListTool.requiresPolicyRuleLiteral).toBe(false);
  });

  it('defers to GET /integrations/connectors via the loopback client', async () => {
    const calls: string[] = [];
    const client: PersonaToolHttpClient = {
      async get<T>(path: string): Promise<T> {
        calls.push(path);
        return { connectors: [], total: 0 } as T;
      },
      async post<T>(): Promise<T> {
        throw new Error('unexpected POST');
      },
    };
    const result = await integrationConnectorListTool.handler(
      {},
      ctxWith(client),
    );
    expect(calls).toEqual(['/integrations/connectors']);
    expect(result.total).toBe(0);
  });

  it('fails closed without an httpClient', async () => {
    await expect(
      integrationConnectorListTool.handler({}, ctxWith()),
    ).rejects.toThrow(/requires httpClient/);
  });
});

describe('integration.connector.invoke descriptor', () => {
  it('is HIGH stakes, isWrite, requiresPolicyRuleLiteral (egress write)', () => {
    expect(integrationConnectorInvokeTool.stakes).toBe('HIGH');
    expect(integrationConnectorInvokeTool.isWrite).toBe(true);
    expect(integrationConnectorInvokeTool.requiresPolicyRuleLiteral).toBe(true);
  });

  it('input schema accepts a well-formed invoke request', () => {
    const parsed = integrationConnectorInvokeTool.inputSchema.safeParse({
      connectorId: 'slack',
      action: 'message.post',
      input: { text: 'hi' },
    });
    expect(parsed.success).toBe(true);
  });

  it('input schema rejects path-unsafe connector ids', () => {
    for (const bad of ['../etc', 'Slack', 'slack/evil', '', 'a b']) {
      const parsed = integrationConnectorInvokeTool.inputSchema.safeParse({
        connectorId: bad,
        action: 'sync.pull',
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('output schema admits the honest not-connected envelope', () => {
    const parsed = integrationConnectorInvokeTool.outputSchema.safeParse({
      ok: false,
      invoked: false,
      connected: false,
      provisioned: false,
      connectorId: 'github',
      reason: 'tenant has not connected GitHub',
    });
    expect(parsed.success).toBe(true);
  });

  it('defers to POST /integrations/connectors/:id/invoke', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client: PersonaToolHttpClient = {
      async get<T>(): Promise<T> {
        throw new Error('unexpected GET');
      },
      async post<T>(path: string, body: unknown): Promise<T> {
        calls.push({ path, body });
        return {
          ok: true,
          invoked: true,
          connected: true,
          provisioned: true,
          connectorId: 'slack',
          action: 'message.post',
          result: { posted: true },
        } as T;
      },
    };
    const result = await integrationConnectorInvokeTool.handler(
      { connectorId: 'slack', action: 'message.post', input: { text: 'hi' } },
      ctxWith(client),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/integrations/connectors/slack/invoke');
    expect(calls[0]?.body).toEqual({
      action: 'message.post',
      input: { text: 'hi' },
    });
    expect(result.ok).toBe(true);
  });

  it('fails closed without an httpClient', async () => {
    await expect(
      integrationConnectorInvokeTool.handler(
        { connectorId: 'slack', action: 'sync.pull' },
        ctxWith(),
      ),
    ).rejects.toThrow(/requires httpClient/);
  });
});

describe('registration in the merged brain-tools catalog', () => {
  it('both tools appear in listPersonaToolDescriptors()', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('integration.connector.list');
    expect(ids).toContain('integration.connector.invoke');
  });

  it('no per-connector tool ids leaked into the catalog (generative law)', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    const perConnector = ids.filter((id) =>
      /^integration\.connector\.(?!list$|invoke$)/.test(id),
    );
    expect(perConnector).toEqual([]);
  });
});
