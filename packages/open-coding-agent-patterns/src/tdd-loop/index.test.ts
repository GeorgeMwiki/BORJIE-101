import { describe, expect, it } from 'vitest';

import { runTDDLoop } from './index.js';
import { createMockBrain } from '../__tests__/fixtures/setup.js';
import type { SandboxCommand, SandboxExecutionResult, SandboxPort } from '../types.js';

/**
 * Build a stubbed sandbox that returns a sequence of test results
 * (one per invocation). Useful for simulating red→green cycles.
 */
function stubSandbox(results: ReadonlyArray<SandboxExecutionResult>): SandboxPort {
  let i = 0;
  return {
    kind: 'local-subprocess',
    exec: async (_cmd: SandboxCommand): Promise<SandboxExecutionResult> => {
      const r = results[i] ?? results[results.length - 1] ?? {
        stdout: '',
        stderr: '',
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
        truncated: false,
      };
      i++;
      return r;
    },
  };
}

const TEST_PATCH = `<<<<<<< SEARCH
// existing
=======
// test added
test('it works', () => expect(1+1).toBe(2));
>>>>>>> REPLACE`;

const IMPL_PATCH = `<<<<<<< SEARCH
// impl
=======
// impl-pass
export const f = () => 2;
>>>>>>> REPLACE`;

describe('tdd-loop :: runTDDLoop', () => {
  it('runs a full red→green cycle and returns final=green', async () => {
    const writes: Record<string, string> = {};
    const brain = createMockBrain({
      responses: [TEST_PATCH, IMPL_PATCH],
    });
    const sandbox = stubSandbox([
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 5, timedOut: false, truncated: false },
      { stdout: 'PASS', stderr: '', exitCode: 0, durationMs: 5, timedOut: false, truncated: false },
    ]);

    const loop = await runTDDLoop({
      intent: 'f returns 2',
      testFilePath: '/tmp/t.ts',
      implFilePath: '/tmp/i.ts',
      testFileBefore: '// existing\n',
      implFileBefore: '// impl\n',
      brain,
      sandbox,
      tests: { cwd: '/tmp', testRunner: 'custom', testCommand: 'fake-runner' },
      writeFile: async (path: string, bytes: string): Promise<string> => {
        writes[path] = bytes;
        return bytes;
      },
    });

    expect(loop.result.final).toBe('green');
    expect(loop.result.iterations).toBe(1);
    expect(writes['/tmp/t.ts']).toContain('test added');
    expect(writes['/tmp/i.ts']).toContain('impl-pass');

    // Trajectory shape: 4 steps (write-test, expect-fail, write-code, expect-pass).
    const phases = loop.result.history.map((s) => s.phase);
    expect(phases).toContain('write-test');
    expect(phases).toContain('expect-fail');
    expect(phases).toContain('write-code');
    expect(phases).toContain('expect-pass');
  });

  it('returns final=red when test passes immediately (intent mis-read)', async () => {
    const brain = createMockBrain({ responses: [TEST_PATCH] });
    const sandbox = stubSandbox([
      { stdout: 'PASS', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
    ]);
    const loop = await runTDDLoop({
      intent: 'something',
      testFilePath: '/tmp/t.ts',
      implFilePath: '/tmp/i.ts',
      testFileBefore: '// existing\n',
      implFileBefore: '// impl\n',
      brain,
      sandbox,
      tests: { cwd: '/tmp', testRunner: 'custom', testCommand: 'fake' },
      writeFile: async (_p, b) => b,
    });
    expect(loop.result.final).toBe('red');
  });

  it('returns final=max-iterations when impl never makes tests pass', async () => {
    const brain = createMockBrain({
      responses: [TEST_PATCH, IMPL_PATCH, IMPL_PATCH, IMPL_PATCH],
    });
    const sandbox = stubSandbox([
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
    ]);
    const loop = await runTDDLoop({
      intent: 'never green',
      testFilePath: '/tmp/t.ts',
      implFilePath: '/tmp/i.ts',
      testFileBefore: '// existing\n',
      implFileBefore: '// impl\n',
      brain,
      sandbox,
      tests: { cwd: '/tmp', testRunner: 'custom', testCommand: 'fake' },
      writeFile: async (_p, b) => b,
      maxIterations: 2,
    });
    expect(loop.result.final).toBe('max-iterations');
    expect(loop.result.iterations).toBeGreaterThanOrEqual(2);
  });

  it('runs the refactor step when supplied (and tests still green)', async () => {
    const REFACTOR_PATCH = `<<<<<<< SEARCH\n// impl-pass\n=======\n// refactored\n>>>>>>> REPLACE`;
    const brain = createMockBrain({
      responses: [TEST_PATCH, IMPL_PATCH, REFACTOR_PATCH],
    });
    const sandbox = stubSandbox([
      { stdout: 'FAIL', stderr: '', exitCode: 1, durationMs: 1, timedOut: false, truncated: false },
      { stdout: 'PASS', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
      { stdout: 'PASS', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false },
    ]);
    let writes = 0;
    const loop = await runTDDLoop({
      intent: 'green with refactor',
      testFilePath: '/tmp/t.ts',
      implFilePath: '/tmp/i.ts',
      testFileBefore: '// existing\n',
      implFileBefore: '// impl\n',
      brain,
      sandbox,
      tests: { cwd: '/tmp', testRunner: 'custom', testCommand: 'fake' },
      writeFile: async (_p, b) => {
        writes++;
        return b;
      },
      refactorPromptBuilder: ({ impl }) => `refactor: ${impl}`,
    });
    expect(loop.result.final).toBe('green');
    expect(writes).toBeGreaterThanOrEqual(3); // test, impl, refactor
    const phases = loop.result.history.map((s) => s.phase);
    expect(phases).toContain('refactor');
  });
});
