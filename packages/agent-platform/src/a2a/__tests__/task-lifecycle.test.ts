/**
 * Tests for A2A task lifecycle: submit → get → cancel,
 * plus the working/completed/failed state machine.
 */
import { describe, expect, it } from 'vitest';
import {
  cancelTask,
  completeTask,
  createInMemoryTaskStore,
  failTask,
  getTask,
  markTaskWorking,
  submitTask,
  type A2ATaskMessage,
  type LifecycleDeps,
} from '../task-lifecycle.js';

function deps(): LifecycleDeps {
  let counter = 0;
  return {
    store: createInMemoryTaskStore(),
    now: () => new Date('2026-05-23T12:00:00Z'),
    newId: () => `task-${++counter}`,
  };
}

function msg(content: string): A2ATaskMessage {
  return {
    role: 'user',
    parts: [{ type: 'text', content }],
  };
}

describe('submitTask', () => {
  it('creates a task in submitted status', async () => {
    const d = deps();
    const task = await submitTask(
      { sessionId: 'sess-1', message: msg('hello') },
      d,
    );
    expect(task.id).toBe('task-1');
    expect(task.sessionId).toBe('sess-1');
    expect(task.status).toBe('submitted');
    expect(task.message.parts[0]?.content).toBe('hello');
    expect(task.artifacts).toEqual([]);
  });

  it('is idempotent on supplied taskId', async () => {
    const d = deps();
    const a = await submitTask(
      { sessionId: 's', message: msg('a'), taskId: 'fixed-id' },
      d,
    );
    const b = await submitTask(
      { sessionId: 's', message: msg('b'), taskId: 'fixed-id' },
      d,
    );
    expect(a).toEqual(b);
    expect(b.message.parts[0]?.content).toBe('a');
  });
});

describe('getTask', () => {
  it('returns null for unknown ids', async () => {
    const d = deps();
    expect(await getTask('nope', d)).toBeNull();
  });

  it('returns the task after submit', async () => {
    const d = deps();
    const submitted = await submitTask(
      { sessionId: 's', message: msg('hi') },
      d,
    );
    const fetched = await getTask(submitted.id, d);
    expect(fetched).toEqual(submitted);
  });
});

describe('cancelTask', () => {
  it('returns null for unknown ids', async () => {
    const d = deps();
    expect(await cancelTask('nope', d)).toBeNull();
  });

  it('transitions submitted -> canceled', async () => {
    const d = deps();
    const t = await submitTask({ sessionId: 's', message: msg('x') }, d);
    const canceled = await cancelTask(t.id, d);
    expect(canceled?.status).toBe('canceled');
  });

  it('is a no-op on already-completed tasks', async () => {
    const d = deps();
    const t = await submitTask({ sessionId: 's', message: msg('x') }, d);
    await completeTask(t.id, null, d);
    const after = await cancelTask(t.id, d);
    expect(after?.status).toBe('completed');
  });
});

describe('state machine', () => {
  it('submitted -> working -> completed with artifact', async () => {
    const d = deps();
    const t = await submitTask({ sessionId: 's', message: msg('do it') }, d);
    const working = await markTaskWorking(t.id, d);
    expect(working?.status).toBe('working');
    const artifact: A2ATaskMessage = {
      role: 'agent',
      parts: [{ type: 'text', content: 'done' }],
    };
    const done = await completeTask(t.id, artifact, d);
    expect(done?.status).toBe('completed');
    expect(done?.artifacts).toHaveLength(1);
    expect(done?.artifacts[0]?.parts[0]?.content).toBe('done');
  });

  it('submitted -> failed records the error', async () => {
    const d = deps();
    const t = await submitTask({ sessionId: 's', message: msg('x') }, d);
    const failed = await failTask(t.id, 'upstream timeout', d);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('upstream timeout');
  });

  it('canceled tasks cannot be re-failed', async () => {
    const d = deps();
    const t = await submitTask({ sessionId: 's', message: msg('x') }, d);
    await cancelTask(t.id, d);
    const after = await failTask(t.id, 'oops', d);
    expect(after?.status).toBe('canceled');
  });
});

describe('TaskStore list', () => {
  it('lists tasks for a session', async () => {
    const d = deps();
    await submitTask({ sessionId: 's1', message: msg('a') }, d);
    await submitTask({ sessionId: 's1', message: msg('b') }, d);
    await submitTask({ sessionId: 's2', message: msg('c') }, d);
    const list = await d.store.list('s1');
    expect(list).toHaveLength(2);
  });
});
