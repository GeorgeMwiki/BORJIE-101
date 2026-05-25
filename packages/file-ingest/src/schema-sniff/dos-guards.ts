/**
 * Shared denial-of-service ceilings for the schema-sniff layer.
 *
 * The ingest pipeline accepts arbitrary CSV / Excel / PDF / image uploads
 * dropped into chat. Without explicit caps a malicious (or careless) user
 * could submit a multi-gigabyte file or a "billion laughs" sheet that
 * pegs the CPU and exhausts memory. We enforce three ceilings:
 *
 *   - MAX_FILE_BYTES: 25 MiB per upload. Chosen empirically; 100k-row
 *     CSVs typically sit under 12 MiB.
 *   - MAX_ROWS:      100,000 logical data rows.
 *   - MAX_COLUMNS:   200 columns.
 *
 * A breach raises {@link DosGuardError} eagerly (before any heavy parsing
 * work) so the caller can return a clear refusal to the chat UI rather
 * than hanging the worker.
 */

/** Maximum upload size in bytes (25 MiB). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Maximum logical rows accepted by any adapter. */
export const MAX_ROWS = 100_000;

/** Maximum columns accepted by any adapter. */
export const MAX_COLUMNS = 200;

export type DosGuardDimension = 'file_bytes' | 'rows' | 'columns';

/**
 * Thrown when the parsed payload exceeds a DoS ceiling. The error carries
 * machine-readable `dimension`, `actual`, and `limit` fields so the
 * orchestration layer can log + surface a structured refusal.
 */
export class DosGuardError extends Error {
  public readonly dimension: DosGuardDimension;
  public readonly actual: number;
  public readonly limit: number;

  constructor(
    message: string,
    dimension: DosGuardDimension,
    actual: number,
    limit: number
  ) {
    super(message);
    this.name = 'DosGuardError';
    this.dimension = dimension;
    this.actual = actual;
    this.limit = limit;
  }
}
