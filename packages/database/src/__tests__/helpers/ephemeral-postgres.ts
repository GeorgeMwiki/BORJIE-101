/**
 * Ephemeral Postgres test harness (database package copy).
 *
 * Spins up a throwaway Postgres cluster with `initdb` + `pg_ctl` (no external
 * server required) so migration + FORCE-RLS tests can run against a REAL
 * Postgres. Mirrors services/api-gateway/test/helpers/ephemeral-postgres.ts;
 * the two must stay behaviourally in sync.
 *
 * The application role is NON-superuser, NOBYPASSRLS by design: Postgres
 * bypasses RLS for superusers and BYPASSRLS roles, and FORCE only binds the
 * table owner — so an RLS isolation test connecting as `postgres` would see
 * ALL rows regardless of the GUC and silently false-pass. Every RLS-enforced
 * query MUST go through `appUrl`; use `adminUrl` only for DDL / migrations /
 * role grants / seeding.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Login role used for every RLS-enforced query. Non-superuser by design. */
export const APP_ROLE = 'borjie_app';

export interface EphemeralPostgres {
  /** Superuser connection string — DDL / migrations / role grants / seeding. */
  readonly adminUrl: string;
  /** Non-superuser (NOBYPASSRLS) connection string for RLS-asserting reads. */
  readonly appUrl: string;
  readonly port: number;
  /** Stop the server and delete the data directory. Idempotent. */
  readonly stop: () => void;
}

export function postgresToolingAvailable(): boolean {
  for (const bin of ['initdb', 'pg_ctl']) {
    const res = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    if (res.status !== 0) return false;
  }
  return true;
}

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

export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const base = mkdtempSync(join(tmpdir(), 'bpgdb-'));
  const dataDir = join(base, 'd');
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PGTZ: 'UTC' };

  execFileSync(
    'initdb',
    ['-D', dataDir, '--auth=trust', '--locale=C', '--username=postgres'],
    { env, stdio: 'pipe' },
  );

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
      /* best-effort */
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
