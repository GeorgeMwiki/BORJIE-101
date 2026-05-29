/**
 * Stdin reader for `borjie <verb> [args] -` style commands.
 *
 * Conventions:
 *   - If an argument is literally `-`, the command should call
 *     `await readStdin()` and substitute the result.
 *   - For interactive TTYs we DO NOT block — we return an empty string
 *     so commands can short-circuit with a helpful error.
 *   - We respect `BORJIE_STDIN_TIMEOUT_MS` (default 30s) so a hung pipe
 *     doesn't freeze the CLI forever.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export function isStdinSentinel(value: unknown): boolean {
  return value === '-';
}

export async function readStdin(opts: { timeoutMs?: number } = {}): Promise<string> {
  if (process.stdin.isTTY) return '';
  const timeoutMs = opts.timeoutMs ?? envTimeoutMs() ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`Timed out reading stdin after ${timeoutMs}ms (set BORJIE_STDIN_TIMEOUT_MS to extend)`)),
      );
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => settle(() => resolve(buffer)));
    process.stdin.on('error', (err: Error) => settle(() => reject(err)));
  });
}

/** Resolve a value that might be `-` (stdin) or a literal string. */
export async function resolveStdinArg(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (!isStdinSentinel(value)) return value;
  const piped = await readStdin();
  return piped.length > 0 ? piped : undefined;
}

function envTimeoutMs(): number | undefined {
  const raw = process.env['BORJIE_STDIN_TIMEOUT_MS'];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
