/**
 * MCP server host (consumer side).
 *
 * Reads `.mcp.json` from the project root, spawns each configured
 * server (we currently support stdio + streamable-http URL handles),
 * and exposes a thin tools-API over JSON-RPC 2.0.
 *
 * Spec sources cited in the parity doc:
 *   - modelcontextprotocol.io/specification/2025-03-26/basic/transports
 *   - HTTP+SSE deprecated March 2025; Streamable HTTP is the modern remote.
 *
 * We deliberately keep this small and dependency-free — the broader
 * `@modelcontextprotocol/sdk` lives in `@borjie/mcp-server` (the
 * server side). Pulling it into a consumer-side runtime would bring
 * an SDK that prefers being instantiated server-side.
 *
 * Production callers that need the official SDK adapter can wrap this
 * with their own `MCPClient` — every public method here is a thin
 * `record` + `replace` boundary so swap-in is trivial.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { assertUrlSafe } from '@borjie/enterprise-hardening';

import type {
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPTransport,
  RuntimeLogger,
} from '../types.js';
import { noopLogger } from '../types.js';

export interface MCPHostOptions {
  readonly projectPath: string;
  readonly logger?: RuntimeLogger;
}

// ─────────────────────────────────────────────────────────────────
// Inline transport — narrow JSON-RPC 2.0 over stdio
// ─────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

interface MCPClientTransport {
  start(): Promise<void>;
  call(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
  stop(): Promise<void>;
  readonly name: string;
  readonly transport: MCPTransport;
}

class StdioTransport implements MCPClientTransport {
  readonly name: string;
  readonly transport: MCPTransport = 'stdio';
  readonly #config: MCPServerConfig;
  readonly #logger: RuntimeLogger;
  #child: ChildProcessWithoutNullStreams | undefined;
  #nextId = 0;
  #buffer = '';
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(config: MCPServerConfig, logger: RuntimeLogger) {
    this.name = config.name;
    this.#config = config;
    this.#logger = logger;
  }

  async start(): Promise<void> {
    if (this.#config.command === undefined) {
      throw new Error(`stdio MCP server ${this.name} missing 'command'`);
    }
    this.#child = spawn(this.#config.command, [...(this.#config.args ?? [])], {
      env: {
        ...process.env,
        ...(this.#config.env as Record<string, string> | undefined),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stderr.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => this.#onStdout(chunk));
    this.#child.stderr.on('data', (chunk: string) => {
      this.#logger.log('debug', `mcp[${this.name}] stderr: ${chunk.trim()}`);
    });
    this.#child.on('close', (code) => {
      this.#logger.log('info', `mcp[${this.name}] closed`, { code });
      for (const [, p] of this.#pending) {
        p.reject(new Error(`mcp server ${this.name} closed`));
      }
      this.#pending.clear();
    });

    // MCP initialize handshake — clients send `initialize` first.
    await this.call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      clientInfo: { name: 'borjie-agent-runtime', version: '0.1.0' },
    });
  }

  async call(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const child = this.#child;
    if (child === undefined) {
      throw new Error(`mcp transport ${this.name} not started`);
    }
    const id = ++this.#nextId;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`mcp ${this.name}.${method} timed out`));
      }, this.#config.initTimeoutMs ?? 10_000);
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      try {
        child.stdin.write(`${JSON.stringify(req)}\n`);
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        reject(err as Error);
      }
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child === undefined) return;
    child.stdin.end();
    child.kill('SIGTERM');
    this.#child = undefined;
  }

  #onStdout(chunk: string): void {
    this.#buffer += chunk;
    let nl = this.#buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.#buffer.slice(0, nl).trim();
      this.#buffer = this.#buffer.slice(nl + 1);
      nl = this.#buffer.indexOf('\n');
      if (line.length === 0) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch (err) {
        this.#logger.log('warn', `mcp[${this.name}] bad JSON line`, {
          error: (err as Error).message,
          line,
        });
        continue;
      }
      const handler = this.#pending.get(msg.id);
      if (handler === undefined) {
        this.#logger.log('debug', `mcp[${this.name}] orphan response id=${msg.id}`);
        continue;
      }
      this.#pending.delete(msg.id);
      if (msg.error !== undefined) {
        handler.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      } else {
        handler.resolve(msg.result);
      }
    }
  }
}

class HttpTransport implements MCPClientTransport {
  readonly name: string;
  readonly transport: MCPTransport;
  readonly #config: MCPServerConfig;
  readonly #logger: RuntimeLogger;
  #nextId = 0;

  constructor(config: MCPServerConfig, logger: RuntimeLogger) {
    this.name = config.name;
    this.transport = config.transport;
    this.#config = config;
    this.#logger = logger;
  }

  async start(): Promise<void> {
    if (this.#config.url === undefined) {
      throw new Error(`http MCP server ${this.name} missing 'url'`);
    }
    // Probe — initialize handshake.
    await this.call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      clientInfo: { name: 'borjie-agent-runtime', version: '0.1.0' },
    });
  }

  async call(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const id = ++this.#nextId;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    // SSRF guard — MCP server URLs come from `.mcp.json` on the
    // project root, which is operator-controlled but still
    // user-influenceable in multi-tenant deployments. Run the
    // central assertUrlSafe() check (private-IP denylist + DNS
    // rebinding guard) before opening the socket.
    const targetUrl = this.#config.url ?? '';
    await assertUrlSafe(targetUrl);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.#config.initTimeoutMs ?? 10_000),
    });
    if (!response.ok) {
      this.#logger.log('warn', `mcp[${this.name}] http ${response.status}`);
      throw new Error(`mcp ${this.name}.${method} HTTP ${response.status}`);
    }
    const json = (await response.json()) as JsonRpcResponse;
    if (json.error !== undefined) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return json.result;
  }

  async stop(): Promise<void> {
    // Stateless — nothing to clean up.
  }
}

// ─────────────────────────────────────────────────────────────────
// Public MCP host
// ─────────────────────────────────────────────────────────────────

export class MCPHost {
  readonly #projectPath: string;
  readonly #logger: RuntimeLogger;
  readonly #servers = new Map<string, MCPClientTransport>();
  /** Optional test seam — when supplied, used instead of spawning subprocesses. */
  #transportFactory: ((c: MCPServerConfig, l: RuntimeLogger) => MCPClientTransport) | undefined;

  constructor(opts: MCPHostOptions) {
    this.#projectPath = opts.projectPath;
    this.#logger = opts.logger ?? noopLogger;
  }

  /** Test seam — inject a fake transport factory. */
  useTransportFactory(
    factory: (c: MCPServerConfig, l: RuntimeLogger) => MCPClientTransport,
  ): void {
    this.#transportFactory = factory;
  }

  async loadMCPConfig(): Promise<ReadonlyArray<MCPServerConfig>> {
    const path = join(this.#projectPath, '.mcp.json');
    if (!existsSync(path)) return [];
    const raw = await readFile(path, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.#logger.log('error', `agent-runtime: invalid .mcp.json`, {
        error: (err as Error).message,
      });
      return [];
    }
    return normaliseMCPConfig(parsed);
  }

  async startMCPServer(config: MCPServerConfig): Promise<void> {
    if (this.#servers.has(config.name)) {
      this.#logger.log('warn', `mcp[${config.name}] already started — replacing`);
      await this.#servers.get(config.name)?.stop();
    }
    const transport = this.#createTransport(config);
    await transport.start();
    this.#servers.set(config.name, transport);
  }

  async stopMCPServer(name: string): Promise<void> {
    const t = this.#servers.get(name);
    if (t === undefined) return;
    await t.stop();
    this.#servers.delete(name);
  }

  async stopAll(): Promise<void> {
    for (const [, t] of this.#servers) {
      try {
        await t.stop();
      } catch (err) {
        this.#logger.log('warn', `mcp stop error`, { error: (err as Error).message });
      }
    }
    this.#servers.clear();
  }

  hasServer(name: string): boolean {
    return this.#servers.has(name);
  }

  async discoverTools(serverName: string): Promise<ReadonlyArray<MCPTool>> {
    const transport = this.#mustGetServer(serverName);
    const result = (await transport.call('tools/list', {})) as
      | { tools: ReadonlyArray<MCPTool> }
      | undefined;
    if (result === undefined || !Array.isArray(result.tools)) return [];
    return Object.freeze(
      result.tools.map((t) => ({
        name: String(t.name),
        ...(t.description !== undefined ? { description: String(t.description) } : {}),
        ...(t.inputSchema !== undefined
          ? { inputSchema: t.inputSchema as Readonly<Record<string, unknown>> }
          : {}),
      })),
    );
  }

  async callTool(args: {
    readonly server: string;
    readonly tool: string;
    readonly args?: Readonly<Record<string, unknown>>;
  }): Promise<MCPToolResult> {
    const transport = this.#mustGetServer(args.server);
    try {
      const result = (await transport.call('tools/call', {
        name: args.tool,
        arguments: args.args ?? {},
      })) as
        | { content?: ReadonlyArray<{ type: string; text?: string }>; isError?: boolean }
        | undefined;
      const content = (result?.content ?? []).map((c) => ({
        type: (c.type as MCPToolResult['content'][number]['type']) ?? 'text',
        ...(c.text !== undefined ? { text: String(c.text) } : {}),
      }));
      return Object.freeze({
        ok: result?.isError !== true,
        content: Object.freeze(content),
      });
    } catch (err) {
      return Object.freeze({
        ok: false,
        content: Object.freeze([]),
        errorMessage: (err as Error).message,
      });
    }
  }

  #mustGetServer(name: string): MCPClientTransport {
    const t = this.#servers.get(name);
    if (t === undefined) throw new Error(`mcp server not started: ${name}`);
    return t;
  }

  #createTransport(config: MCPServerConfig): MCPClientTransport {
    if (this.#transportFactory !== undefined) {
      return this.#transportFactory(config, this.#logger);
    }
    if (config.transport === 'stdio') {
      return new StdioTransport(config, this.#logger);
    }
    if (config.transport === 'streamable-http' || config.transport === 'sse') {
      return new HttpTransport(config, this.#logger);
    }
    throw new Error(`unsupported MCP transport: ${String(config.transport)}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Config normalisation
// ─────────────────────────────────────────────────────────────────

/**
 * `.mcp.json` accepts the Claude Code shape:
 *
 *   { "mcpServers": { "<name>": { "command": "node", "args": […] } } }
 *
 * …or the simpler shape:
 *
 *   { "servers": [{ "name": "foo", "transport": "stdio", … }] }
 *
 * We normalise both into our internal `MCPServerConfig[]`.
 */
export function normaliseMCPConfig(raw: unknown): ReadonlyArray<MCPServerConfig> {
  if (typeof raw !== 'object' || raw === null) return [];
  const obj = raw as Record<string, unknown>;
  const out: MCPServerConfig[] = [];

  // Claude Code shape.
  const mcpServers = obj['mcpServers'];
  if (typeof mcpServers === 'object' && mcpServers !== null) {
    for (const [name, value] of Object.entries(mcpServers)) {
      if (typeof value !== 'object' || value === null) continue;
      const v = value as Record<string, unknown>;
      const transport: MCPTransport =
        typeof v['url'] === 'string' ? 'streamable-http' : 'stdio';
      out.push(buildConfig(name, transport, v));
    }
  }

  // Internal-array shape.
  const servers = obj['servers'];
  if (Array.isArray(servers)) {
    for (const v of servers) {
      if (typeof v !== 'object' || v === null) continue;
      const name = String((v as Record<string, unknown>)['name'] ?? '');
      if (name.length === 0) continue;
      const transport =
        ((v as Record<string, unknown>)['transport'] as MCPTransport | undefined) ??
        (typeof (v as Record<string, unknown>)['url'] === 'string'
          ? 'streamable-http'
          : 'stdio');
      out.push(buildConfig(name, transport, v as Record<string, unknown>));
    }
  }

  return Object.freeze(out);
}

function buildConfig(
  name: string,
  transport: MCPTransport,
  src: Record<string, unknown>,
): MCPServerConfig {
  const env = typeof src['env'] === 'object' && src['env'] !== null
    ? (src['env'] as Record<string, string>)
    : undefined;
  return {
    name,
    transport,
    ...(typeof src['command'] === 'string' ? { command: src['command'] as string } : {}),
    ...(Array.isArray(src['args'])
      ? { args: (src['args'] as ReadonlyArray<unknown>).map(String) }
      : {}),
    ...(typeof src['url'] === 'string' ? { url: src['url'] as string } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(typeof src['initTimeoutMs'] === 'number'
      ? { initTimeoutMs: src['initTimeoutMs'] as number }
      : {}),
  };
}

// Re-export internal transports for test fixtures (does not affect public surface).
export { StdioTransport, HttpTransport };
export type { MCPClientTransport };
