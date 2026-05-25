import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MCPHost, normaliseMCPConfig } from '../mcp/index.js';
import type { MCPServerConfig, MCPTool, RuntimeLogger } from '../types.js';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('normaliseMCPConfig', () => {
  it('handles the Claude Code mcpServers shape (stdio + http auto-detect)', () => {
    const out = normaliseMCPConfig({
      mcpServers: {
        local: { command: 'node', args: ['srv.js'], env: { K: 'V' } },
        remote: { url: 'https://example.com/mcp' },
      },
    });
    expect(out).toHaveLength(2);
    const local = out.find((s) => s.name === 'local');
    const remote = out.find((s) => s.name === 'remote');
    expect(local?.transport).toBe('stdio');
    expect(local?.command).toBe('node');
    expect(local?.args).toEqual(['srv.js']);
    expect(local?.env).toEqual({ K: 'V' });
    expect(remote?.transport).toBe('streamable-http');
    expect(remote?.url).toBe('https://example.com/mcp');
  });

  it('handles the internal array shape', () => {
    const out = normaliseMCPConfig({
      servers: [{ name: 'foo', transport: 'stdio', command: 'node' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('foo');
  });

  it('returns [] for malformed input', () => {
    expect(normaliseMCPConfig(null)).toEqual([]);
    expect(normaliseMCPConfig('not an object')).toEqual([]);
  });
});

describe('MCPHost', () => {
  it('loadMCPConfig reads .mcp.json fixture', async () => {
    const host = new MCPHost({ projectPath: fixturesRoot });
    const cfg = await host.loadMCPConfig();
    const names = cfg.map((c) => c.name).sort();
    expect(names).toEqual(['filesystem', 'remote-analytics']);
  });

  it('startMCPServer + discoverTools + callTool round-trip with a fake transport', async () => {
    const host = new MCPHost({ projectPath: fixturesRoot });
    host.useTransportFactory((cfg) => new FakeTransport(cfg));
    const config: MCPServerConfig = {
      name: 'fake',
      transport: 'stdio',
      command: 'node',
    };
    await host.startMCPServer(config);
    expect(host.hasServer('fake')).toBe(true);
    const tools = await host.discoverTools('fake');
    expect(tools.map((t) => t.name)).toEqual(['hello', 'echo']);
    const result = await host.callTool({
      server: 'fake',
      tool: 'echo',
      args: { message: 'hi' },
    });
    expect(result.ok).toBe(true);
    expect(result.content[0]?.text).toBe('hi');
  });

  it('callTool returns ok=false when the underlying transport rejects', async () => {
    const host = new MCPHost({ projectPath: fixturesRoot });
    host.useTransportFactory((cfg) => new FailingTransport(cfg));
    await host.startMCPServer({ name: 'bad', transport: 'stdio', command: 'node' });
    const result = await host.callTool({ server: 'bad', tool: 'whatever' });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('boom');
  });

  it('stopAll cleans up registered servers', async () => {
    const host = new MCPHost({ projectPath: fixturesRoot });
    host.useTransportFactory((cfg) => new FakeTransport(cfg));
    await host.startMCPServer({ name: 'a', transport: 'stdio', command: 'node' });
    await host.startMCPServer({ name: 'b', transport: 'stdio', command: 'node' });
    expect(host.hasServer('a')).toBe(true);
    await host.stopAll();
    expect(host.hasServer('a')).toBe(false);
    expect(host.hasServer('b')).toBe(false);
  });

  it('mustGetServer throws for unregistered server', async () => {
    const host = new MCPHost({ projectPath: fixturesRoot });
    await expect(host.discoverTools('never-started')).rejects.toThrow(/not started/);
  });
});

// ─────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────

class FakeTransport {
  readonly name: string;
  readonly transport = 'stdio' as const;
  constructor(config: MCPServerConfig) {
    this.name = config.name;
  }
  async start(): Promise<void> {
    /* noop */
  }
  async call(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (method === 'initialize') return { capabilities: {} };
    if (method === 'tools/list') {
      const tools: ReadonlyArray<MCPTool> = [
        { name: 'hello', description: 'greet' },
        { name: 'echo', description: 'echo input' },
      ];
      return { tools };
    }
    if (method === 'tools/call') {
      const args = (params?.['arguments'] ?? {}) as { message?: string };
      return { content: [{ type: 'text', text: args.message ?? 'hello' }] };
    }
    throw new Error(`unknown method: ${method}`);
  }
  async stop(): Promise<void> {
    /* noop */
  }
}

class FailingTransport {
  readonly name: string;
  readonly transport = 'stdio' as const;
  constructor(config: MCPServerConfig) {
    this.name = config.name;
  }
  async start(): Promise<void> {
    /* noop */
  }
  async call(method: string): Promise<unknown> {
    if (method === 'initialize') return {};
    throw new Error('boom');
  }
  async stop(): Promise<void> {
    /* noop */
  }
}

// Silence unused-var TS noise.
void ({} as RuntimeLogger | undefined);
