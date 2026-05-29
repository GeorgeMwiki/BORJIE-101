/**
 * CLI logger — respects --json (machine output) and --no-color.
 *
 * In JSON mode every informational message is suppressed; only the
 * final result payload is printed to stdout (the calling command is
 * responsible for emitting it). Errors still go to stderr so a wrapper
 * script can detect them via exit code + stderr.
 *
 * The CLI is the ONLY part of Borjie permitted to use `console.*`
 * directly (services use Pino — see CLAUDE.md). We funnel through this
 * tiny wrapper so flag handling stays consistent across every command.
 */

import kleur from 'kleur';

export interface LoggerOptions {
  readonly json: boolean;
  readonly noColor: boolean;
  readonly verbose: boolean;
}

export interface BorjieLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  success(...args: unknown[]): void;
  raw(message: string): void;
  json(payload: unknown): void;
  readonly opts: LoggerOptions;
}

export function createLogger(opts: LoggerOptions): BorjieLogger {
  if (opts.noColor) kleur.enabled = false;
  const stdout = (msg: string): void => {
    process.stdout.write(`${msg}\n`);
  };
  const stderr = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };

  const fmt = (parts: unknown[]): string =>
    parts
      .map((p) =>
        typeof p === 'string' ? p : (() => {
          try {
            return JSON.stringify(p);
          } catch {
            return String(p);
          }
        })(),
      )
      .join(' ');

  return {
    opts,
    info(...args) {
      if (opts.json) return;
      stdout(fmt(args));
    },
    warn(...args) {
      if (opts.json) return;
      stderr(opts.noColor ? `warn: ${fmt(args)}` : kleur.yellow(`warn: ${fmt(args)}`));
    },
    error(...args) {
      stderr(opts.noColor ? `error: ${fmt(args)}` : kleur.red(`error: ${fmt(args)}`));
    },
    debug(...args) {
      if (opts.json) return;
      if (!opts.verbose) return;
      stderr(opts.noColor ? `debug: ${fmt(args)}` : kleur.gray(`debug: ${fmt(args)}`));
    },
    success(...args) {
      if (opts.json) return;
      stdout(opts.noColor ? fmt(args) : kleur.green(fmt(args)));
    },
    raw(message) {
      stdout(message);
    },
    json(payload) {
      stdout(JSON.stringify(payload, null, opts.json ? 0 : 2));
    },
  };
}
