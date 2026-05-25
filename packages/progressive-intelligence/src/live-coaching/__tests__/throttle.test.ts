import { describe, expect, it } from 'vitest';
import { createThrottledCoach } from '../throttle.js';

function makeScheduler() {
  type Task = { cb: () => void; at: number };
  const queue: Task[] = [];
  let nowMs = 0;
  function advance(ms: number): void {
    nowMs += ms;
    const ready = queue.filter((t) => t.at <= nowMs);
    for (const r of ready) {
      const idx = queue.indexOf(r);
      if (idx >= 0) queue.splice(idx, 1);
      r.cb();
    }
  }
  return {
    now: () => nowMs,
    schedule: (cb: () => void, ms: number) => {
      queue.push({ cb, at: nowMs + ms });
    },
    advance,
  };
}

describe('createThrottledCoach', () => {
  it('debounces multiple invocations into one', async () => {
    let calls = 0;
    const sched = makeScheduler();
    const t = createThrottledCoach<string, string>({
      fn: async (args) => {
        calls += 1;
        return `result:${args}`;
      },
      intervalMs: 500,
      now: sched.now,
      schedule: sched.schedule,
    });
    const p1 = t.invoke('a');
    const p2 = t.invoke('b');
    const p3 = t.invoke('c');
    sched.advance(500);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    // All three callers see the final (last-wins) result.
    expect(r1).toBe('result:c');
    expect(r2).toBe('result:c');
    expect(r3).toBe('result:c');
    expect(calls).toBe(1);
  });

  it('starts a new debounce window after the previous run completes', async () => {
    let calls = 0;
    const sched = makeScheduler();
    const t = createThrottledCoach<string, number>({
      fn: async () => {
        calls += 1;
        return calls;
      },
      intervalMs: 500,
      now: sched.now,
      schedule: sched.schedule,
    });
    const first = t.invoke('x');
    sched.advance(500);
    await first;
    expect(calls).toBe(1);
    const second = t.invoke('y');
    sched.advance(500);
    await second;
    expect(calls).toBe(2);
  });

  it('flush runs immediately', async () => {
    let calls = 0;
    const sched = makeScheduler();
    const t = createThrottledCoach<string, string>({
      fn: async (args) => {
        calls += 1;
        return args;
      },
      intervalMs: 5_000,
      now: sched.now,
      schedule: sched.schedule,
    });
    t.invoke('z');
    const flushed = await t.flush();
    expect(flushed).toBe('z');
    expect(calls).toBe(1);
  });

  it('cancel rejects the pending promise', async () => {
    const sched = makeScheduler();
    const t = createThrottledCoach<string, string>({
      fn: async (s) => s,
      intervalMs: 500,
      now: sched.now,
      schedule: sched.schedule,
    });
    const p = t.invoke('a');
    t.cancel();
    await expect(p).rejects.toThrow(/cancelled/);
  });
});
