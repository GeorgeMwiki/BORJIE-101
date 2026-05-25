import { describe, expect, it } from 'vitest';

import {
  createDockerSandbox,
  createE2BSandbox,
  createLocalSubprocessSandbox,
  runTests,
} from './index.js';
import type { E2BFetchInit, E2BHttpResponse } from './index.js';

describe('sandbox-execution :: createLocalSubprocessSandbox', () => {
  it('rejects commands not on the allowlist', async () => {
    const sandbox = createLocalSubprocessSandbox({ allowedCommands: ['echo'] });
    const res = await sandbox.exec({ cmd: 'rm -rf /' });
    expect(res.exitCode).toBe(127);
    expect(res.stderr).toContain('not in allowlist');
  });

  it('runs allowlisted commands', async () => {
    const sandbox = createLocalSubprocessSandbox({ allowedCommands: ['printf'] });
    const res = await sandbox.exec({ cmd: 'printf hello' });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello');
    expect(res.timedOut).toBe(false);
  });

  it('reports exit codes from failing commands', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: ['false'],
    });
    const res = await sandbox.exec({ cmd: 'false' });
    expect(res.exitCode).not.toBe(0);
  });

  it('enforces a timeout', async () => {
    const sandbox = createLocalSubprocessSandbox({ allowedCommands: ['sleep'] });
    const res = await sandbox.exec({ cmd: 'sleep 5', timeoutMs: 200 });
    expect(res.timedOut).toBe(true);
  });

  it('truncates stdout that exceeds outputCapBytes', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: ['printf'],
    });
    const res = await sandbox.exec({
      cmd: 'printf "%s" "$(printf %.s. {1..200})"',
      outputCapBytes: 50,
    });
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBeLessThanOrEqual(50);
  });

  it('skipAllowlistCheck bypasses the allowlist', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: [],
      skipAllowlistCheck: true,
    });
    const res = await sandbox.exec({ cmd: 'printf ok' });
    expect(res.stdout).toContain('ok');
  });
});

describe('sandbox-execution :: createDockerSandbox', () => {
  it('builds a docker run command with the expected flags', async () => {
    // We swap the docker binary for `echo` so the assembled command
    // is echoed verbatim and we can inspect the flags via stdout.
    const sandbox = createDockerSandbox({
      image: 'alpine:3.20',
      memoryMb: 64,
      network: 'none',
      dockerBinary: 'echo',
    });
    const res = await sandbox.exec({ cmd: 'echo hi', cwd: '/work' });
    expect(res.stdout).toContain('run');
    expect(res.stdout).toContain('--rm');
    expect(res.stdout).toContain('--network=none');
    expect(res.stdout).toContain('--memory=64m');
    expect(res.stdout).toContain('alpine:3.20');
    expect(res.stdout).toContain('/work');
  });

  it('omits the memory + cpu flags when not set', async () => {
    const sandbox = createDockerSandbox({
      image: 'alpine:3.20',
      dockerBinary: 'echo',
    });
    const res = await sandbox.exec({ cmd: 'ls' });
    expect(res.stdout).not.toContain('--memory');
    expect(res.stdout).not.toContain('--cpu-quota');
  });
});

describe('sandbox-execution :: createE2BSandbox', () => {
  it('POSTs to the e2b endpoint with the api key and command', async () => {
    const calls: Array<{ url: string; init: E2BFetchInit }> = [];
    const fakeFetcher = async (url: string, init: E2BFetchInit): Promise<E2BHttpResponse> => {
      calls.push({ url, init });
      return {
        status: 200,
        body: { stdout: 'ok', stderr: '', exitCode: 0 },
      };
    };
    const sandbox = createE2BSandbox({
      apiKey: 'sk-test',
      fetcher: fakeFetcher,
    });
    const res = await sandbox.exec({ cmd: 'echo ok' });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.headers['authorization']).toBe('Bearer sk-test');
    expect(calls[0]?.init.body).toContain('echo ok');
  });

  it('handles fetcher errors by returning exitCode 127', async () => {
    const sandbox = createE2BSandbox({
      apiKey: 'sk-test',
      fetcher: async () => {
        throw new Error('network down');
      },
    });
    const res = await sandbox.exec({ cmd: 'echo ok' });
    expect(res.exitCode).toBe(127);
    expect(res.stderr).toContain('network down');
  });

  it('truncates oversize stdout from the remote sandbox', async () => {
    const big = 'x'.repeat(2048);
    const sandbox = createE2BSandbox({
      apiKey: 'sk-test',
      fetcher: async () => ({
        status: 200,
        body: { stdout: big, stderr: '', exitCode: 0 },
      }),
    });
    const res = await sandbox.exec({ cmd: 'cat huge', outputCapBytes: 64 });
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBe(64);
  });
});

describe('sandbox-execution :: runTests', () => {
  it('wraps the pnpm runner', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: ['printf'],
      // We swap the runner cmd by hand-rolling a custom runner.
      skipAllowlistCheck: true,
    });
    const result = await runTests({
      sandbox,
      cwd: '/tmp',
      testRunner: 'custom',
      testCommand: 'printf "tests passed"',
    });
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('tests passed');
    expect(result.testRunner).toBe('custom');
  });

  it('reports failure when test command exits non-zero', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: [],
      skipAllowlistCheck: true,
    });
    const result = await runTests({
      sandbox,
      cwd: '/tmp',
      testRunner: 'custom',
      testCommand: 'false',
    });
    expect(result.passed).toBe(false);
  });

  it('returns 127 for empty custom command', async () => {
    const sandbox = createLocalSubprocessSandbox({
      allowedCommands: [],
      skipAllowlistCheck: true,
    });
    const result = await runTests({
      sandbox,
      cwd: '/tmp',
      testRunner: 'custom',
    });
    expect(result.exitCode).toBe(127);
  });
});
