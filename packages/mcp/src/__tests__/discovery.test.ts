/**
 * Discovery + namespacing + router.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  discoverFromConfig,
  namespace,
  unnamespace,
  createToolRouter,
} from '../discovery/discovery.js';
import type { MCPClient } from '../client/client.js';
import type { Tool, ToolCallResponse } from '../types.js';

describe('discoverFromConfig', () => {
  it('parses a Claude-Desktop-style config', () => {
    const raw = {
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: '...' },
        },
        api: {
          url: 'https://api.example.com/mcp',
          transport: 'streamable-http',
        },
      },
    };
    const servers = discoverFromConfig(raw);
    expect(servers.length).toBe(2);
    const gh = servers.find((s) => s.serverId === 'github');
    expect(gh?.transportKind).toBe('stdio');
    expect(gh?.config.command).toBe('npx');
    const api = servers.find((s) => s.serverId === 'api');
    expect(api?.transportKind).toBe('streamable-http');
  });

  it('rejects entries with both command and url', () => {
    expect(() =>
      discoverFromConfig({
        mcpServers: {
          bad: { command: 'x', url: 'https://y' },
        },
      }),
    ).toThrow();
  });

  it('defaults http entries without transport to streamable-http', () => {
    const servers = discoverFromConfig({
      mcpServers: { x: { url: 'https://x.example/mcp' } },
    });
    expect(servers[0]?.transportKind).toBe('streamable-http');
  });
});

describe('namespace / unnamespace', () => {
  it('round-trips a name', () => {
    const n = namespace('github', 'search');
    expect(n).toBe('github.search');
    expect(unnamespace(n)).toEqual({ serverId: 'github', toolName: 'search' });
  });

  it('rejects server ids with separator-violating characters', () => {
    expect(() => namespace('bad.id', 'x')).toThrow();
  });

  it('unnamespace returns null for malformed input', () => {
    expect(unnamespace('noseparator')).toBeNull();
    expect(unnamespace('.startswithseparator')).toBeNull();
    expect(unnamespace('endsep.')).toBeNull();
  });
});

describe('createToolRouter', () => {
  function fakeClient(tools: Array<Tool>, response: ToolCallResponse): MCPClient {
    return {
      initialize: vi.fn(),
      listTools: vi.fn(async () => tools),
      callTool: vi.fn(async () => response),
      listResources: vi.fn(),
      readResource: vi.fn(),
      listPrompts: vi.fn(),
      getPrompt: vi.fn(),
      onNotification: vi.fn(),
      capabilities: () => null,
      serverInfo: () => null,
      protocolVersion: () => null,
      close: vi.fn(),
    } as unknown as MCPClient;
  }

  it('routes a namespaced call to the right client', async () => {
    const ghClient = fakeClient(
      [{ name: 'search', description: 'github search', inputSchema: {} }],
      { content: [{ type: 'text', text: 'gh-result' }] },
    );
    const slackClient = fakeClient(
      [{ name: 'search', description: 'slack search', inputSchema: {} }],
      { content: [{ type: 'text', text: 'slack-result' }] },
    );
    const router = createToolRouter(
      new Map([['github', ghClient], ['slack', slackClient]]),
    );
    const r1 = await router.routeCall('github.search', { q: 'mcp' });
    const r2 = await router.routeCall('slack.search', { q: 'mcp' });
    expect((r1.content[0] as { text: string }).text).toBe('gh-result');
    expect((r2.content[0] as { text: string }).text).toBe('slack-result');
    expect(ghClient.callTool).toHaveBeenCalledWith('search', { q: 'mcp' });
    expect(slackClient.callTool).toHaveBeenCalledWith('search', { q: 'mcp' });
  });

  it('listAllTools collects from every registered client', async () => {
    const a = fakeClient(
      [
        { name: 'one', description: 'a-one', inputSchema: {} },
        { name: 'two', description: 'a-two', inputSchema: {} },
      ],
      { content: [] },
    );
    const b = fakeClient(
      [{ name: 'three', description: 'b-three', inputSchema: {} }],
      { content: [] },
    );
    const router = createToolRouter(new Map([['a', a], ['b', b]]));
    const tools = await router.listAllTools();
    const names = tools.map((t) => t.namespacedName).sort();
    expect(names).toEqual(['a.one', 'a.two', 'b.three']);
  });

  it('routeCall throws for unknown server prefix', async () => {
    const router = createToolRouter(new Map());
    await expect(router.routeCall('nope.thing', {})).rejects.toThrow(
      /No MCP client/,
    );
  });
});
