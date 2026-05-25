/**
 * Pm4pyClient — Node-side transport that owns the pm4py Python sidecar.
 *
 * Responsibilities:
 *  - Spawn the Python interpreter pointed at `python/server.py`
 *  - Multiplex JSON-line requests / responses over the sidecar's
 *    stdin / stdout streams using monotonic ids (each request awaits its
 *    matching response)
 *  - Health-check the sidecar and gracefully restart if it dies
 *  - Apply per-request timeouts (large event logs can stall replay)
 *
 * License-segregation note:
 *  The pm4py Python package is licensed AGPL-3.0. By calling it over a
 *  process boundary (stdin/stdout JSON lines) we keep the AGPL'd code
 *  segregated from this MIT TypeScript codebase. We never import pm4py
 *  symbols into Node and we never link pm4py into our compiled bundle.
 *
 * Testability:
 *  The client accepts a `spawnFn` override so unit tests can inject a
 *  mock child process that replays canned JSON responses without
 *  requiring pm4py to be installed locally.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Pm4pyCommand,
  Pm4pyCommandKind,
  Pm4pyResponse,
} from './types.js';
import { Pm4pySidecarError } from './types.js';

// ---------------------------------------------------------------------------
// Configuration + injection points
// ---------------------------------------------------------------------------

export interface Pm4pyClientConfig {
  readonly pythonBin?: string;
  readonly serverScript?: string;
  readonly requestTimeoutMs?: number;
  readonly maxRestarts?: number;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Override for `child_process.spawn` — tests inject this to swap the
   * real Python interpreter for a mock JSON-line replayer.
   */
  readonly spawnFn?: SpawnFn;
}

export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

interface PendingRequest {
  readonly resolve: (value: Pm4pyResponse) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESTARTS = 3;

// ---------------------------------------------------------------------------
// Pm4pyClient
// ---------------------------------------------------------------------------

export class Pm4pyClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private stdoutBuffer = '';
  private restartCount = 0;
  private closed = false;

  private readonly pythonBin: string;
  private readonly serverScript: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRestarts: number;
  private readonly cwd: string | undefined;
  private readonly env: Readonly<Record<string, string>> | undefined;
  private readonly spawnFn: SpawnFn;

  constructor(config: Pm4pyClientConfig = {}) {
    super();
    this.pythonBin = config.pythonBin ?? process.env.PYTHON_BIN ?? 'python3';
    this.serverScript = config.serverScript ?? defaultServerScript();
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRestarts = config.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.cwd = config.cwd;
    this.env = config.env;
    this.spawnFn = config.spawnFn ?? defaultSpawn;
  }

  /** Lazily spawn the sidecar on first call. Safe to call repeatedly. */
  start(): void {
    if (this.child || this.closed) return;
    const envBase: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    };
    const env: NodeJS.ProcessEnv = this.env
      ? { ...envBase, ...this.env }
      : envBase;
    const child = this.spawnFn(
      this.pythonBin,
      [this.serverScript],
      { cwd: this.cwd, env },
    );
    this.child = child;
    this.stdoutBuffer = '';

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      this.emit('stderr', chunk);
    });
    child.on('exit', (code, signal) => this.onExit(code, signal));
    child.on('error', (err) => this.emit('error', err));
  }

  /** Send a JSON command and await its matching response. */
  async send<K extends Pm4pyCommandKind>(
    kind: K,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Pm4pyResponse> {
    if (this.closed) {
      throw new Pm4pySidecarError(
        'sidecar client has been closed',
        'CLIENT_CLOSED',
      );
    }
    this.start();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new Pm4pySidecarError(
        'sidecar stdin is not writable',
        'STDIN_CLOSED',
      );
    }
    const cmd: Pm4pyCommand = { id: randomUUID(), kind, args };
    const promise = new Promise<Pm4pyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd.id);
        reject(
          new Pm4pySidecarError(
            `pm4py command ${kind} timed out after ${this.requestTimeoutMs}ms`,
            'TIMEOUT',
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(cmd.id, { resolve, reject, timer });
    });
    child.stdin.write(JSON.stringify(cmd) + '\n');
    return promise;
  }

  /** Terminate the sidecar process. Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new Pm4pySidecarError(
          'sidecar closed before response',
          'CLIENT_CLOSED',
        ),
      );
    }
    this.pending.clear();
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child.kill('SIGTERM');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIdx = this.stdoutBuffer.indexOf('\n');
    while (newlineIdx >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      newlineIdx = this.stdoutBuffer.indexOf('\n');
      if (!line) continue;
      this.dispatchResponseLine(line);
    }
  }

  private dispatchResponseLine(line: string): void {
    let parsed: Pm4pyResponse | null = null;
    try {
      parsed = JSON.parse(line) as Pm4pyResponse;
    } catch {
      this.emit(
        'error',
        new Pm4pySidecarError(
          `sidecar emitted non-JSON line: ${line.slice(0, 200)}`,
          'BAD_FRAME',
        ),
      );
      return;
    }
    if (!parsed || typeof parsed.id !== 'string') {
      this.emit(
        'error',
        new Pm4pySidecarError(
          'sidecar response missing id field',
          'BAD_FRAME',
        ),
      );
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      // Unknown id — sidecar replied to a request that already timed out
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    const reason = `pm4py sidecar exited (code=${code}, signal=${signal})`;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Pm4pySidecarError(reason, 'SIDECAR_EXIT'));
    }
    this.pending.clear();
    this.emit('exit', { code, signal });
    if (this.closed) return;
    if (this.restartCount >= this.maxRestarts) {
      this.emit(
        'error',
        new Pm4pySidecarError(
          `pm4py sidecar exceeded max restart attempts (${this.maxRestarts})`,
          'MAX_RESTARTS',
        ),
      );
      return;
    }
    this.restartCount += 1;
    this.start();
  }
}

function defaultSpawn(
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  return spawn(command, args as string[], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
}

function defaultServerScript(): string {
  // Resolved relative to the compiled `dist/` directory at runtime so
  // `node dist/index.js` can find `python/server.py` next to it.
  const url = new URL('../python/server.py', import.meta.url);
  return url.pathname;
}
