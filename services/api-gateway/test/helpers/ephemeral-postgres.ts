/**
 * Ephemeral Postgres test harness.
 *
 * Spins up a throwaway Postgres cluster with `initdb` + `pg_ctl` (no
 * external server required) so security-critical RLS tests can run against
 * a REAL Postgres with FORCE row-level security — the only place the
 * cross-connection GUC-leak this suite guards against can actually be
 * reproduced.
 *
 * Gotchas baked in (each one is load-bearing — see the validation in the
 * RLS-pinning test):
 *   - `LC_ALL=C` + `initdb --locale=C` so the cluster is locale-stable and
 *     fast to init regardless of the host's locale env.
 *   - `--auth=trust` so the test connects with no password.
 *   - A dedicated **non-superuser, NOBYPASSRLS** application role
 *     (`appUrl`). This is CRITICAL: Postgres bypasses RLS entirely for
 *     superusers and `BYPASSRLS` roles, and FORCE only binds the table
 *     *owner* — so a test that connects as the `postgres` superuser would
 *     see ALL rows regardless of the GUC and silently false-pass. Every
 *     RLS-enforced query MUST go through `appUrl`; use `adminUrl` only for
 *     DDL / role grants / seeding.
 *   - TCP on an OS-assigned free port (not a unix socket) — postgres.js's
 *     URL parser rejects the empty-authority socket form, and a random
 *     ephemeral port avoids races across parallel vitest forks.
 *   - `fsync=off` / `synchronous_commit=off` / `full_page_writes=off` —
 *     disposable cluster; durability is irrelevant, speed isn't.
 *
 * Dependency-free: shells out to the Postgres binaries already on PATH.
 * `postgresToolingAvailable()` lets a test `describe.skipIf(...)` cleanly
 * when the binaries are absent (e.g. a CI image without Postgres), so the
 * wider `vitest run` stays green there.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Login role used for every RLS-enforced query. Non-superuser by design. */
export const APP_ROLE = 'borjie_app';

export interface EphemeralPostgres {
  /** Superuser connection string — DDL / role grants / seeding ONLY. */
  readonly adminUrl: string;
  /**
   * Non-superuser (NOBYPASSRLS) connection string. Use this for any query
   * whose tenant isolation you are asserting — RLS is bypassed for the
   * superuser, so `adminUrl` would silently defeat the test.
   */
  readonly appUrl: string;
  /** TCP port the cluster listens on (127.0.0.1). */
  readonly port: number;
  /** Stop the server and delete the data directory. Idempotent. */
  readonly stop: () => void;
}

/**
 * True when `initdb` + `pg_ctl` are resolvable on PATH. Tests gate on this
 * so the suite degrades to a skip (not a failure) where Postgres tooling
 * is unavailable.
 */
export function postgresToolingAvailable(): boolean {
  for (const bin of ['initdb', 'pg_ctl']) {
    const res = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    if (res.status !== 0) return false;
  }
  return true;
}

/** Ask the OS for a free TCP port on the loopback interface. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/**
 * Spawn an ephemeral Postgres cluster and return its connection details.
 * Throws if the tooling is missing — call `postgresToolingAvailable()`
 * first and skip when false.
 */
export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const base = mkdtempSync(join(tmpdir(), 'bpg-'));
  const dataDir = join(base, 'd');
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PGTZ: 'UTC' };

  // 1 — init the cluster (trust auth + C locale).
  execFileSync(
    'initdb',
    ['-D', dataDir, '--auth=trust', '--locale=C', '--username=postgres'],
    { env, stdio: 'pipe' },
  );

  // 2 — start on a free TCP port. Retry on the rare free-port race.
  let port = 0;
  let started = false;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3 && !started; attempt++) {
    port = await freePort();
    const serverOpts = [
      `-c listen_addresses=127.0.0.1`,
      `-c port=${port}`,
      `-c fsync=off`,
      `-c synchronous_commit=off`,
      `-c full_page_writes=off`,
      `-c unix_socket_directories=${base}`,
    ].join(' ');
    try {
      execFileSync(
        'pg_ctl',
        ['-D', dataDir, '-o', serverOpts, '-l', join(base, 'pg.log'), '-w', 'start'],
        { env, stdio: 'pipe' },
      );
      started = true;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!started) {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    throw new Error(
      `ephemeral-postgres: pg_ctl start failed: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  // 3 — create the non-superuser application role (idempotent within this
  // fresh cluster). trust auth means no password is needed.
  execFileSync(
    'psql',
    [
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', 'postgres',
      '-d', 'postgres',
      '-c', `CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`,
    ],
    { env, stdio: 'pipe' },
  );

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      execFileSync('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], {
        env,
        stdio: 'pipe',
      });
    } catch {
      /* best-effort: cluster may already be down */
    }
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  return {
    adminUrl: `postgres://postgres@127.0.0.1:${port}/postgres`,
    appUrl: `postgres://${APP_ROLE}@127.0.0.1:${port}/postgres`,
    port,
    stop,
  };
}
