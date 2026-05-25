/**
 * Stdio transport — spawn a subprocess and exchange JSON-RPC frames over
 * its stdin/stdout (one JSON object per newline).
 *
 * Used for locally-installed servers (the most common deployment shape for
 * filesystem/github/postgres reference servers).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  type MCPMessage,
  type TransportPort,
  MCPClosedError,
  MCPBackpressureError,
} from '../types.js';

export interface StdioTransportOptions {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  /** Max queued outbound messages before send() rejects. Default 1000. */
  readonly maxSendQueue?: number;
}

export function createStdioTransport(opts: StdioTransportOptions): TransportPort {
  return createStdioTransportFromProcess(
    spawn(opts.command, [...(opts.args ?? [])], {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    opts.maxSendQueue ?? 1000,
  );
}

/**
 * Internal helper — also used by tests with an in-memory mock process.
 */
export function createStdioTransportFromProcess(
  child: ChildProcess,
  maxSendQueue: number,
): TransportPort {
  const messageHandlers = new Set<(m: MCPMessage) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  const closeHandlers = new Set<() => void>();
  let open = true;
  let sendQueueDepth = 0;
  let buffer = '';

  function fireError(err: Error): void {
    for (const h of errorHandlers) h(err);
  }

  function fireClose(): void {
    if (!open) return;
    open = false;
    for (const h of closeHandlers) h();
  }

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as MCPMessage;
        for (const h of messageHandlers) h(parsed);
      } catch (e) {
        fireError(
          new Error(`stdio: failed to parse JSON-RPC frame: ${String(e)}`),
        );
      }
    }
  });

  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (_chunk: string) => {
    // Most reference servers log to stderr — surface as debug-level error
    // only when caller has subscribed. Otherwise swallow to avoid noise.
    // Intentionally no-op; consumers can wrap the child if they want logs.
  });

  child.on('error', (e) => fireError(e));
  child.on('exit', () => fireClose());

  return {
    get isOpen() {
      return open && !child.killed;
    },
    async send(message: MCPMessage): Promise<void> {
      if (!open) throw new MCPClosedError();
      if (sendQueueDepth >= maxSendQueue) {
        throw new MCPBackpressureError(
          `stdio: send queue depth ${sendQueueDepth} >= max ${maxSendQueue}`,
        );
      }
      const line = `${JSON.stringify(message)}\n`;
      sendQueueDepth++;
      try {
        await new Promise<void>((resolve, reject) => {
          const ok = child.stdin?.write(line, (err) => {
            if (err) reject(err);
            else resolve();
          });
          if (ok === false) {
            // Backpressure: drain event will resolve via the callback above.
          } else if (ok === undefined) {
            reject(new MCPClosedError('stdio: stdin not available'));
          }
        });
      } finally {
        sendQueueDepth--;
      }
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    async close(): Promise<void> {
      if (!open) return;
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      // Try graceful first; SIGKILL after 1s if still alive.
      child.kill('SIGTERM');
      const killed = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve(true);
        }, 1000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve(true);
        });
      });
      void killed;
      fireClose();
    },
  };
}
