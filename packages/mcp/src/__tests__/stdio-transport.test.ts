/**
 * Stdio transport — driven by a mock ChildProcess so the test doesn't spawn
 * a real subprocess (which would be brittle across CI environments).
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createStdioTransportFromProcess } from '../transport/stdio.js';
import type { MCPMessage } from '../types.js';
import { MCPClosedError, MCPBackpressureError } from '../types.js';

interface MockChild extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  kill: (signal?: string) => boolean;
  push(line: string): void;
  writes: Array<string>;
}

function makeMockChild(): MockChild {
  const emitter = new EventEmitter();
  const writes: Array<string> = [];
  const stdin = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      writes.push(chunk.toString());
      cb();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  let killed = false;
  const child = emitter as MockChild;
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = killed;
  child.writes = writes;
  child.kill = (_signal?: string): boolean => {
    killed = true;
    child.killed = true;
    setImmediate(() => emitter.emit('exit', 0, null));
    return true;
  };
  child.push = (line: string): void => stdout.push(line);
  return child;
}

describe('stdio transport', () => {
  it('parses newline-delimited frames from stdout', async () => {
    const child = makeMockChild();
    const t = createStdioTransportFromProcess(child, 100);
    const received: Array<MCPMessage> = [];
    t.onMessage((m) => received.push(m));

    child.push('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBe(1);

    // Split across two chunks — still parsed once newline arrives.
    child.push('{"jsonrpc":"2.0","id":2,');
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBe(1);
    child.push('"method":"ping"}\n');
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBe(2);
  });

  it('serialises send() as newline-terminated JSON', async () => {
    const child = makeMockChild();
    const t = createStdioTransportFromProcess(child, 100);
    await t.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(child.writes.length).toBe(1);
    expect(child.writes[0]).toBe(
      '{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n',
    );
  });

  it('emits onError on malformed JSON', async () => {
    const child = makeMockChild();
    const t = createStdioTransportFromProcess(child, 100);
    const errs: Array<Error> = [];
    t.onError((e) => errs.push(e));
    child.push('not-json\n');
    await new Promise((r) => setImmediate(r));
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toMatch(/failed to parse/);
  });

  it('fires onClose when subprocess exits', async () => {
    const child = makeMockChild();
    const t = createStdioTransportFromProcess(child, 100);
    let closed = 0;
    t.onClose(() => closed++);
    expect(t.isOpen).toBe(true);
    child.emit('exit', 0, null);
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(1);
    expect(t.isOpen).toBe(false);
  });

  it('send after close rejects with MCPClosedError', async () => {
    const child = makeMockChild();
    const t = createStdioTransportFromProcess(child, 100);
    await t.close();
    await expect(
      t.send({ jsonrpc: '2.0', id: 1, method: 'x' }),
    ).rejects.toBeInstanceOf(MCPClosedError);
  });

  it('enforces backpressure when send queue saturates', async () => {
    const child = makeMockChild();
    // Wrap stdin so writes never call back — first N sends fill the queue,
    // subsequent sends must immediately reject with MCPBackpressureError
    // rather than block waiting for room.
    const blockingStdin = new Writable({ write() {} });
    Object.defineProperty(child, 'stdin', { value: blockingStdin });
    const t = createStdioTransportFromProcess(child, 3);

    // First three fill the queue — they hang (don't await them).
    const hung = [0, 1, 2].map((i) =>
      t.send({ jsonrpc: '2.0', id: i, method: 'x' }),
    );
    // Give the event loop a tick so the hung sends each increment the
    // queue counter before we attempt the overflow send.
    await new Promise((r) => setImmediate(r));

    // The fourth and fifth should reject synchronously (well, with the
    // rejected promise) without ever invoking the stdin write callback.
    await expect(
      t.send({ jsonrpc: '2.0', id: 3, method: 'x' }),
    ).rejects.toBeInstanceOf(MCPBackpressureError);
    await expect(
      t.send({ jsonrpc: '2.0', id: 4, method: 'x' }),
    ).rejects.toBeInstanceOf(MCPBackpressureError);

    // Detach the hung promise rejections so they don't surface as
    // unhandled-rejection warnings when the test exits.
    hung.forEach((p) => {
      p.catch(() => undefined);
    });
  });
});
