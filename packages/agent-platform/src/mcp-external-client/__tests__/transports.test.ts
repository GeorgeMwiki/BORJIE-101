/**
 * Transport-builder unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStdioConnectionParams,
  envKeyForServer,
} from '../client/transport-stdio.js';
import {
  buildSseConnectionParams,
  isSafeUrl,
} from '../client/transport-sse.js';
import { buildHttpConnectionParams } from '../client/transport-http.js';
import { findCatalogEntry } from '../catalog/public-servers.js';
import type { McpAuthContext, McpCatalogEntry } from '../types.js';

const slack = findCatalogEntry('slack') as McpCatalogEntry;
const cloudflare = findCatalogEntry('cloudflare') as McpCatalogEntry;
const memory = findCatalogEntry('memory') as McpCatalogEntry;

describe('transport-stdio', () => {
  it('builds params with the SDK package name as npx target', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'slack',
      mode: 'oauth_token' as const,
      accessToken: 'xoxb-abc',
    });
    const params = buildStdioConnectionParams(slack, auth);
    expect(params.command).toBe('npx');
    expect(params.args).toContain('@modelcontextprotocol/server-slack');
    expect(params.env['SLACK_BOT_TOKEN']).toBe('xoxb-abc');
  });

  it('omits env entries when auth mode is none', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'memory',
      mode: 'none' as const,
    });
    const params = buildStdioConnectionParams(memory, auth);
    expect(Object.keys(params.env)).toHaveLength(0);
  });

  it('refuses entries that do not declare stdio transport', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'cloudflare',
      mode: 'api_key' as const,
      apiKey: 'k',
    });
    expect(() => buildStdioConnectionParams(cloudflare, auth)).toThrow(
      /declares http/,
    );
  });

  it('falls back to a generic env key for unknown ids', () => {
    expect(envKeyForServer('not-in-catalog', 'TOKEN')).toBe(
      'BORJIE_MCP_NOT_IN_CATALOG_TOKEN',
    );
  });
});

describe('transport-sse', () => {
  it('rejects unsafe urls', () => {
    expect(isSafeUrl('http://example.com')).toBe(false);
    expect(isSafeUrl('https://127.0.0.1/x')).toBe(false);
    expect(isSafeUrl('https://10.0.0.1/x')).toBe(false);
    expect(isSafeUrl('https://192.168.1.1/x')).toBe(false);
    expect(isSafeUrl('https://172.20.0.1/x')).toBe(false);
    expect(isSafeUrl('https://example.com/x')).toBe(true);
    expect(isSafeUrl('not a url')).toBe(false);
  });

  it('refuses non-sse entries', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'slack',
      mode: 'oauth_token' as const,
      accessToken: 'a',
    });
    expect(() =>
      buildSseConnectionParams(slack, auth, 'https://example.com'),
    ).toThrow(/declares stdio/);
  });
});

describe('transport-http', () => {
  it('attaches an Authorization header for api_key auth', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'cloudflare',
      mode: 'api_key' as const,
      apiKey: 'cf-key',
    });
    const params = buildHttpConnectionParams(
      cloudflare,
      auth,
      'https://api.cloudflare.com/client/v4/mcp',
    );
    expect(params.headers['Authorization']).toBe('Bearer cf-key');
  });

  it('refuses unsafe urls', () => {
    const auth: McpAuthContext = Object.freeze({
      tenantId: 't1',
      serverId: 'cloudflare',
      mode: 'api_key' as const,
      apiKey: 'cf-key',
    });
    expect(() =>
      buildHttpConnectionParams(
        cloudflare,
        auth,
        'http://internal-host/mcp',
      ),
    ).toThrow(/unsafe url/);
  });
});
