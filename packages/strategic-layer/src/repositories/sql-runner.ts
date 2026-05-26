/**
 * Minimal SQL runner port. The SQL repository factories accept any
 * client that exposes a parameterised `query(sql, params)` that
 * returns `{ rows }`. Production wires `pg.Pool`, `Drizzle`, or a
 * Cloudflare D1 adapter; tests can wire an in-memory fake.
 *
 * Keeping the port narrow lets `@borjie/strategic-layer` stay
 * driver-agnostic while still shipping a working SQL implementation.
 */

export interface SqlRunner {
  query<TRow = unknown>(
    text: string,
    params: ReadonlyArray<unknown>,
  ): Promise<{ readonly rows: ReadonlyArray<TRow> }>;
}
