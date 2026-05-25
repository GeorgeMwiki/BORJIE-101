/**
 * Test helpers — build a `Pm4pyClient` that talks to a mocked child
 * process instead of the real Python interpreter. Lets us assert the
 * JSON-line transport works end-to-end without requiring pm4py to be
 * installed in CI.
 *
 * The mock child process is a `Readable`/`Writable` pair that captures
 * commands written to stdin and emits canned responses on stdout.
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Pm4pyClient, type SpawnFn } from '../src/pm4py-client.js';
import type { Pm4pyResponse } from '../src/types.js';

export interface MockCommand {
  readonly id: string;
  readonly kind: string;
  readonly args: Record<string, unknown>;
}

export interface MockSidecar {
  readonly client: Pm4pyClient;
  readonly commandsSeen: MockCommand[];
  setResponder(
    fn: (cmd: MockCommand) => Pm4pyResponse | Promise<Pm4pyResponse>,
  ): void;
  killChild(code?: number): void;
}

interface MockChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals) => boolean;
}

export function createMockSidecar(): MockSidecar {
  const commandsSeen: MockCommand[] = [];
  let responder: (cmd: MockCommand) => Pm4pyResponse | Promise<Pm4pyResponse> = (
    cmd,
  ) => ({ id: cmd.id, ok: true, data: { echo: cmd.kind } });

  let activeChild: MockChild | null = null;

  const spawnFn: SpawnFn = () => {
    const child = new EventEmitter() as MockChild;
    const stdoutPush: (chunk: string) => void = (chunk) => {
      stdout.push(chunk);
    };

    const stdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          let parsed: MockCommand;
          try {
            parsed = JSON.parse(line) as MockCommand;
          } catch {
            cb();
            return;
          }
          commandsSeen.push(parsed);
          Promise.resolve(responder(parsed)).then(
            (resp) => {
              stdoutPush(JSON.stringify(resp) + '\n');
            },
            (err) => {
              stdoutPush(
                JSON.stringify({
                  id: parsed.id,
                  ok: false,
                  error: err instanceof Error ? err.message : 'mock failed',
                  errorCode: 'MOCK_ERROR',
                }) + '\n',
              );
            },
          );
        }
        cb();
      },
    });

    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });

    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    activeChild = child;

    return child as unknown as ChildProcessWithoutNullStreams;
  };

  const client = new Pm4pyClient({
    pythonBin: 'mock-python',
    serverScript: '/mock/server.py',
    requestTimeoutMs: 2000,
    spawnFn,
  });

  return {
    client,
    commandsSeen,
    setResponder(fn) {
      responder = fn;
    },
    killChild(code = 0) {
      const c = activeChild;
      if (!c) return;
      c.emit('exit', code, null);
    },
  };
}
