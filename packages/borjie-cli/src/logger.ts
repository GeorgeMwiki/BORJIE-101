/**
 * CLI logger — respects --json (machine output), --no-color, --quiet,
 * --verbose, and the standard `NO_COLOR` env var.
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
  readonly quiet: boolean;
}

export interface BorjieLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  success(...args: unknown[]): void;
  raw(message: string): void;
  json(payload: unknown): void;
  /** Print `{ok: true, data}` (or `{ok: false, error}`) in JSON mode, raw text otherwise. */
  envelope(args: { ok: boolean; data?: unknown; error?: unknown; text?: string }): void;
  readonly opts: LoggerOptions;
}

export function createLogger(opts: Partial<LoggerOptions> = {}): BorjieLogger {
  const noColorEnv = process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '';
  const resolved: LoggerOptions = {
    json: Boolean(opts.json),
    noColor: Boolean(opts.noColor) || noColorEnv,
    verbose: Boolean(opts.verbose),
    quiet: Boolean(opts.quiet),
  };
  if (resolved.noColor) kleur.enabled = false;
  const stdout = (msg: string): void => {
    process.stdout.write(`${msg}\n`);
  };
  const stderr = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };

  const fmt = (parts: unknown[]): string =>
    parts
      .map((p) =>
        typeof p === 'string'
          ? p
          : (() => {
              try {
                return JSON.stringify(p);
              } catch {
                return String(p);
              }
            })(),
      )
      .join(' ');

  return {
    opts: resolved,
    info(...args) {
      if (resolved.json || resolved.quiet) return;
      stdout(fmt(args));
    },
    warn(...args) {
      if (resolved.json) return;
      stderr(resolved.noColor ? `warn: ${fmt(args)}` : kleur.yellow(`warn: ${fmt(args)}`));
    },
    error(...args) {
      stderr(resolved.noColor ? `error: ${fmt(args)}` : kleur.red(`error: ${fmt(args)}`));
    },
    debug(...args) {
      if (resolved.json) return;
      if (!resolved.verbose) return;
      stderr(resolved.noColor ? `debug: ${fmt(args)}` : kleur.gray(`debug: ${fmt(args)}`));
    },
    success(...args) {
      if (resolved.json || resolved.quiet) return;
      stdout(resolved.noColor ? fmt(args) : kleur.green(fmt(args)));
    },
    raw(message) {
      if (resolved.quiet && !resolved.json) {
        stdout(message);
        return;
      }
      stdout(message);
    },
    json(payload) {
      stdout(JSON.stringify(payload, null, resolved.json ? 0 : 2));
    },
    envelope({ ok, data, error, text }) {
      if (resolved.json) {
        const payload: Record<string, unknown> = { ok };
        if (data !== undefined) payload['data'] = data;
        if (error !== undefined) payload['error'] = error;
        stdout(JSON.stringify(payload));
        return;
      }
      if (resolved.quiet) {
        if (text) stdout(text);
        return;
      }
      if (text) stdout(text);
      else if (data !== undefined) stdout(JSON.stringify(data, null, 2));
    },
  };
}
