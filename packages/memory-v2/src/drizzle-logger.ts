/**
 * Narrow structural logger contract shared by every Drizzle store adapter.
 *
 * Keeps the memory-v2 package free of any logging library: the host injects a
 * Pino-backed adapter at the composition root; when omitted the default is a
 * silent no-op so the package stays usable in tests / workers without logging.
 * Mirrors the `DrizzleCellRepositoryLogger` shape in `@borjie/cognitive-memory`.
 */

export interface DrizzleStoreLogger {
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

export const NOOP_STORE_LOGGER: DrizzleStoreLogger = Object.freeze({
  warn: (): void => {
    // intentional no-op default logger
  },
});

/** Coerce an unknown thrown value into a stable message string. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Postgres returns timestamptz as Date; normalise to an ISO string. */
export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Nullable timestamptz → ISO string or null. */
export function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Postgres returns numeric as a string; coerce to a finite number. */
export function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
