/**
 * SqlRunner — narrow query-execution port for the SQL repository
 * adapters in this package.
 *
 * The adapters do not import drizzle directly. Production wires a
 * thin adapter on the `@borjie/database` package that exposes the
 * one method below; tests can use the in-memory variants instead.
 *
 * Keeping the surface to a single method (`execute(sql, params)`)
 * means the SQL adapters here can be exercised against any backend
 * (pg, sqlite-with-postgis-shim, mock) without changing the package.
 */

export interface SqlRunner {
  /**
   * Execute a parameterised SQL statement. Returns the row set as a
   * frozen array of plain objects, matching the column names as
   * declared by the statement.
   */
  execute<TRow extends Readonly<Record<string, unknown>>>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<TRow>>;
}
