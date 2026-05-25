/**
 * Sandbox execution — OpenHands-style adapters.
 *
 * Three adapters are shipped:
 *
 *   1. local-subprocess — `node:child_process.spawn` with an
 *                          explicit allowlist of commands. Best for
 *                          tests and trusted local automation.
 *   2. docker           — runs every command inside `docker run`
 *                          with `--rm`, `--network none` (opt-in
 *                          override), and a CPU/memory cap.
 *   3. e2b              — calls the E2B remote sandbox API over
 *                          HTTPS. We do NOT pull the e2b SDK as a
 *                          dependency — the adapter takes a `fetcher`
 *                          callback so callers can wire any client.
 *
 * Every adapter enforces:
 *
 *   - `timeoutMs` (default 60s)
 *   - `outputCapBytes` (default 1 MiB) on combined stdout+stderr
 *   - Environment isolation: only the explicit `env` map is forwarded
 */

import { spawn } from 'node:child_process';

import { assertUrlSafe } from '@borjie/enterprise-hardening';

import type {
  SandboxCommand,
  SandboxExecutionResult,
  SandboxPort,
  TestResult,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_CAP = 1 * 1024 * 1024; // 1 MiB

// ─────────────────────────────────────────────────────────────────
// Local subprocess
// ─────────────────────────────────────────────────────────────────

export interface LocalSubprocessOptions {
  /**
   * Allowlist of command basenames (e.g. `['pnpm', 'pytest']`).
   * If empty, all commands are denied — caller must opt in.
   */
  readonly allowedCommands: ReadonlyArray<string>;
  /** If true, ignore the basename allowlist (use only in trusted code). */
  readonly skipAllowlistCheck?: boolean;
}

export function createLocalSubprocessSandbox(
  options: LocalSubprocessOptions,
): SandboxPort {
  const allowed = new Set(options.allowedCommands);
  return Object.freeze({
    kind: 'local-subprocess' as const,
    exec: async (command: SandboxCommand): Promise<SandboxExecutionResult> => {
      const basename = extractBasename(command.cmd);
      if (!options.skipAllowlistCheck && !allowed.has(basename)) {
        return {
          stdout: '',
          stderr: `command '${basename}' not in allowlist`,
          exitCode: 127,
          durationMs: 0,
          timedOut: false,
          truncated: false,
        };
      }
      return runSubprocess(command);
    },
  });
}

function extractBasename(cmd: string): string {
  const trimmed = cmd.trim();
  const first = trimmed.split(/\s+/)[0] ?? '';
  return first.split('/').pop() ?? first;
}

async function runSubprocess(command: SandboxCommand): Promise<SandboxExecutionResult> {
  const timeoutMs = command.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cap = command.outputCapBytes ?? DEFAULT_OUTPUT_CAP;
  const start = Date.now();
  return new Promise<SandboxExecutionResult>((resolve) => {
    let timedOut = false;
    let truncated = false;
    let stdoutLen = 0;
    let stderrLen = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command.cmd, {
      cwd: command.cwd,
      env: command.env ? { ...command.env } : { PATH: process.env['PATH'] ?? '' },
      shell: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutLen + chunk.length > cap) {
        const room = Math.max(0, cap - stdoutLen);
        if (room > 0) stdoutChunks.push(chunk.subarray(0, room));
        stdoutLen = cap;
        truncated = true;
      } else {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrLen + chunk.length > cap) {
        const room = Math.max(0, cap - stderrLen);
        if (room > 0) stderrChunks.push(chunk.subarray(0, room));
        stderrLen = cap;
        truncated = true;
      } else {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    const settle = (exitCode: number) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        durationMs: Date.now() - start,
        timedOut,
        truncated,
      });
    };

    child.on('close', (code) => settle(code ?? 0));
    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(`spawn error: ${String(err)}`));
      settle(127);
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Docker
// ─────────────────────────────────────────────────────────────────

export interface DockerSandboxOptions {
  readonly image: string;
  readonly network?: 'none' | 'host' | string;
  readonly memoryMb?: number;
  readonly cpuQuota?: number;
  /**
   * Optional override of the docker binary path. Defaults to `docker`.
   */
  readonly dockerBinary?: string;
}

export function createDockerSandbox(options: DockerSandboxOptions): SandboxPort {
  const network = options.network ?? 'none';
  const docker = options.dockerBinary ?? 'docker';
  return Object.freeze({
    kind: 'docker' as const,
    exec: async (command: SandboxCommand): Promise<SandboxExecutionResult> => {
      const envFlags = command.env
        ? Object.entries(command.env)
            .map(([k, v]) => `-e ${shellEscape(k)}=${shellEscape(v)}`)
            .join(' ')
        : '';
      const memFlag = options.memoryMb ? `--memory=${options.memoryMb}m` : '';
      const cpuFlag = options.cpuQuota ? `--cpu-quota=${options.cpuQuota}` : '';
      const cwdFlag = command.cwd ? `-w ${shellEscape(command.cwd)}` : '';
      const fullCmd = [
        docker,
        'run',
        '--rm',
        `--network=${network}`,
        memFlag,
        cpuFlag,
        envFlags,
        cwdFlag,
        shellEscape(options.image),
        'sh',
        '-c',
        shellEscape(command.cmd),
      ]
        .filter(Boolean)
        .join(' ');
      // We strip the original `cwd` because that path is meant for
      // *inside* the container (already conveyed via `-w`). The
      // `docker` binary itself runs in the host's current directory.
      const { cwd: _unused, ...rest } = command;
      void _unused;
      return runSubprocess({ ...rest, cmd: fullCmd });
    },
  });
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_\-./:=]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ─────────────────────────────────────────────────────────────────
// E2B
// ─────────────────────────────────────────────────────────────────

export interface E2BSandboxOptions {
  readonly apiKey: string;
  readonly templateId?: string;
  /**
   * Pluggable fetcher. Returns the parsed JSON body. Caller-supplied
   * so we don't bake in an HTTP client. Defaults to global `fetch`.
   */
  readonly fetcher?: (url: string, init: E2BFetchInit) => Promise<E2BHttpResponse>;
  readonly baseUrl?: string;
}

export interface E2BFetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface E2BHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export function createE2BSandbox(options: E2BSandboxOptions): SandboxPort {
  const fetcher = options.fetcher ?? defaultFetcher;
  const base = options.baseUrl ?? 'https://api.e2b.dev';
  return Object.freeze({
    kind: 'e2b' as const,
    exec: async (command: SandboxCommand): Promise<SandboxExecutionResult> => {
      const start = Date.now();
      const timeoutMs = command.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      try {
        const url = `${base}/sandboxes/exec`;
        const init: E2BFetchInit = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            templateId: options.templateId,
            cmd: command.cmd,
            cwd: command.cwd ?? null,
            env: command.env ?? {},
            timeoutMs,
          }),
        };
        const res = await fetcher(url, init);
        const body = (res.body ?? {}) as {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          timedOut?: boolean;
        };
        const stdout = body.stdout ?? '';
        const stderr = body.stderr ?? '';
        const cap = command.outputCapBytes ?? DEFAULT_OUTPUT_CAP;
        const truncated = stdout.length > cap || stderr.length > cap;
        return {
          stdout: stdout.slice(0, cap),
          stderr: stderr.slice(0, cap),
          exitCode: body.exitCode ?? (res.status >= 400 ? 1 : 0),
          durationMs: Date.now() - start,
          timedOut: body.timedOut ?? false,
          truncated,
        };
      } catch (err) {
        return {
          stdout: '',
          stderr: `e2b request failed: ${String(err)}`,
          exitCode: 127,
          durationMs: Date.now() - start,
          timedOut: false,
          truncated: false,
        };
      }
    },
  });
}

async function defaultFetcher(url: string, init: E2BFetchInit): Promise<E2BHttpResponse> {
  // SSRF guard — the E2B baseUrl is operator-configurable. Even with
  // the api.e2b.dev default, screen every outbound request through
  // assertUrlSafe() so a misconfigured deployment can't accidentally
  // dial a private-RFC1918 / link-local host.
  await assertUrlSafe(url);
  // Use the global `fetch` (Node 18+).
  const res = await fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

// ─────────────────────────────────────────────────────────────────
// runTests — pre-canned wrappers
// ─────────────────────────────────────────────────────────────────

export type TestRunner = TestResult['testRunner'];

export interface RunTestsOptions {
  readonly sandbox: SandboxPort;
  readonly cwd: string;
  readonly testRunner: TestRunner;
  /** Override the auto-built command for `custom`. */
  readonly testCommand?: string;
  readonly timeoutMs?: number;
}

const RUNNER_CMDS: Readonly<Record<Exclude<TestRunner, 'custom'>, string>> = Object.freeze({
  pnpm: 'pnpm test',
  pytest: 'pytest -q',
  cargo: 'cargo test',
  go: 'go test ./...',
});

export async function runTests(options: RunTestsOptions): Promise<TestResult> {
  const cmd =
    options.testRunner === 'custom'
      ? options.testCommand ?? ''
      : RUNNER_CMDS[options.testRunner];
  if (!cmd) {
    return {
      passed: false,
      stdout: '',
      stderr: 'no test command resolved',
      exitCode: 127,
      durationMs: 0,
      testRunner: options.testRunner,
    };
  }
  const res = await options.sandbox.exec({
    cmd,
    cwd: options.cwd,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  return {
    passed: res.exitCode === 0,
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    testRunner: options.testRunner,
  };
}
