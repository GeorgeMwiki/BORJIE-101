/**
 * Narrow SQL execution port for the swahili-linguistics SQL
 * repositories. Production wires a thin adapter on @borjie/database;
 * tests use the in-memory implementations.
 */

export interface SqlRunner {
  execute<TRow extends Readonly<Record<string, unknown>>>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<TRow>>;
}
