/**
 * Stdio transport for the public MCP server.
 *
 * Newline-delimited JSON-RPC over stdin / stdout. Used when a local
 * MCP client (Claude Code, Cursor) spawns the server as a subprocess.
 *
 * Exits cleanly on stdin close. Logs to stderr only (stdout is reserved
 * for JSON-RPC frames).
 */

import type { Readable, Writable } from 'node:stream';
import { createDispatcher, type DispatcherDeps } from '../dispatcher.js';
import {
  buildError,
  parseJsonRpcLine,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
} from '../jsonrpc.js';

export interface StdioOptions {
  readonly bearerToken?: string;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
}

export async function runStdio(
  deps: DispatcherDeps,
  options: StdioOptions = {},
): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const bearerToken = options.bearerToken ?? process.env['BORJIE_MCP_TOKEN'] ?? null;

  const dispatcher = createDispatcher(deps);

  stderr.write('borjie-mcp-server: stdio transport ready\n');

  let buffer = '';
  stdin.setEncoding('utf8');

  stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) {
        void handleLine(line);
      }
      idx = buffer.indexOf('\n');
    }
  });

  return new Promise<void>((resolve) => {
    stdin.on('end', () => resolve());
    stdin.on('close', () => resolve());
  });

  async function handleLine(line: string): Promise<void> {
    const parsed = parseJsonRpcLine(line);
    if (!parsed) {
      writeResponse(buildError(null, JSON_RPC_PARSE_ERROR, 'invalid JSON-RPC line'));
      return;
    }
    if (typeof parsed.method !== 'string') {
      writeResponse(buildError(parsed.id, JSON_RPC_INVALID_REQUEST, 'missing method'));
      return;
    }
    try {
      const response = await dispatcher.dispatch({
        request: parsed,
        bearerToken,
      });
      writeResponse(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      writeResponse(buildError(parsed.id, -32603, message));
    }
  }

  function writeResponse(response: unknown): void {
    stdout.write(`${JSON.stringify(response)}\n`);
  }
}
