#!/usr/bin/env node
/**
 * pilot-provision.ts — single-command pilot-user provisioning.
 *
 * Creates one Supabase Auth user for a pilot tenant and tags them with a
 * cohort label so the kill-switch + observability stack can scope
 * behaviour to the pilot cohort.
 *
 * Steps (idempotent — re-runs safely converge):
 *   1. Find-or-create the Supabase Auth user by phone.
 *   2. Set `app_metadata.tenant_id`, `app_metadata.cohort`, and
 *      `app_metadata.roles = ['pilot']` (server-managed metadata — the
 *      gateway's JWT verifier trusts only this surface).
 *   3. Upsert a matching row into the app-level `users` table inside the
 *      pilot tenant so app code that joins on user_id resolves correctly.
 *   4. Print a summary table with the user id + tenant id.
 *
 * Usage:
 *   tsx scripts/pilot-provision.ts \
 *     --phone +255712345678 \
 *     --tenant tnt_pilot_001 \
 *     --cohort pilot-tz-may-2026 \
 *     [--email pilot+1@borjie.dev] \
 *     [--password '...'] \
 *     [--dry-run] [--json]
 *
 * Required env (read from .env.local):
 *   SUPABASE_URL                  → https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     → server-only key
 *   DATABASE_URL                  → Postgres (session-mode pooler)
 *
 * Exit codes:
 *   0 — pilot user provisioned (newly created OR already existed)
 *   1 — fatal error (network / auth / SQL)
 *   2 — validation error (bad CLI input)
 *
 * Security: refuses to run when SUPABASE_URL looks like production.
 */

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  parsePilotProvisionArgs,
  PilotProvisionValidationError,
  type PilotProvisionArgs,
} from './lib/pilot-provision-helpers.js';

interface AdminApiResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

interface SupabaseUser {
  readonly id: string;
  readonly email?: string;
  readonly phone?: string;
}

interface PilotProvisionResult {
  readonly userId: string;
  readonly tenantId: string;
  readonly cohort: string;
  readonly phone: string;
  readonly email: string;
  readonly alreadyExisted: boolean;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function required(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new PilotProvisionValidationError(
      `missing required env var ${name}`,
    );
  }
  return value;
}

function requiredOneOf(names: ReadonlyArray<string>): string {
  for (const n of names) {
    const v = readEnv(n);
    if (v) return v;
  }
  throw new PilotProvisionValidationError(
    `missing required env (one of): ${names.join(', ')}`,
  );
}

function assertNotProduction(supabaseUrl: string): void {
  if (/prod|production|live/i.test(supabaseUrl)) {
    throw new PilotProvisionValidationError(
      `SUPABASE_URL looks like production: ${supabaseUrl}`,
    );
  }
}

async function adminApi(
  supabaseUrl: string,
  serviceRole: string,
  pathSuffix: string,
  init: RequestInit = {},
): Promise<AdminApiResponse> {
  const url = `${supabaseUrl}${pathSuffix}`;
  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function findUserByPhone(
  supabaseUrl: string,
  serviceRole: string,
  phone: string,
): Promise<SupabaseUser | null> {
  const result = await adminApi(
    supabaseUrl,
    serviceRole,
    '/auth/v1/admin/users?page=1&per_page=200',
  );
  if (!result.ok) {
    throw new Error(
      `list users failed (${result.status}): ${JSON.stringify(result.body)}`,
    );
  }
  const body = result.body as { users?: ReadonlyArray<SupabaseUser> } | null;
  const users = Array.isArray(body?.users) ? body!.users : [];
  return (
    users.find(
      (u) => typeof u.phone === 'string' && u.phone === phone,
    ) ?? null
  );
}

async function provisionPilotUser(
  args: PilotProvisionArgs,
): Promise<PilotProvisionResult> {
  const supabaseUrl = requiredOneOf([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]).replace(/\/+$/, '');
  const serviceRole = required('SUPABASE_SERVICE_ROLE_KEY');
  const databaseUrl = required('DATABASE_URL');

  assertNotProduction(supabaseUrl);

  const email = args.email ?? `pilot+${args.phone.replace(/\D/g, '')}@borjie.dev`;
  const password = args.password ?? `PilotPass!${randomUUID().slice(0, 12)}`;

  if (args.dryRun) {
    return Object.freeze({
      userId: 'dry-run-user',
      tenantId: args.tenantId,
      cohort: args.cohort,
      phone: args.phone,
      email,
      alreadyExisted: false,
    });
  }

  // ── 1+2. Supabase Auth user ────────────────────────────────────────────
  const existing = await findUserByPhone(supabaseUrl, serviceRole, args.phone);
  const payload = {
    phone: args.phone,
    email,
    password,
    phone_confirm: true,
    email_confirm: true,
    app_metadata: {
      tenant_id: args.tenantId,
      cohort: args.cohort,
      roles: ['pilot'],
      environment: 'pilot',
    },
    user_metadata: {
      cohort: args.cohort,
    },
  };

  let userId: string;
  let alreadyExisted = false;
  if (existing) {
    alreadyExisted = true;
    userId = existing.id;
    const patch = await adminApi(
      supabaseUrl,
      serviceRole,
      `/auth/v1/admin/users/${encodeURIComponent(existing.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          app_metadata: payload.app_metadata,
          user_metadata: payload.user_metadata,
        }),
      },
    );
    if (!patch.ok) {
      throw new Error(
        `patch supabase user failed (${patch.status}): ${JSON.stringify(patch.body)}`,
      );
    }
  } else {
    const created = await adminApi(
      supabaseUrl,
      serviceRole,
      '/auth/v1/admin/users',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (!created.ok) {
      throw new Error(
        `create supabase user failed (${created.status}): ${JSON.stringify(created.body)}`,
      );
    }
    const newUser = created.body as { id?: string } | null;
    if (!newUser?.id) {
      throw new Error('supabase create response missing user id');
    }
    userId = newUser.id;
  }

  // ── 3. App-level users row (idempotent) ───────────────────────────────
  const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      // Tenant must exist before we attach a user to it.
      const tenant = await tx<{ id: string }[]>`
        SELECT id FROM tenants WHERE id = ${args.tenantId} AND deleted_at IS NULL LIMIT 1
      `;
      if (tenant.length === 0) {
        throw new Error(
          `pilot tenant ${args.tenantId} does not exist — run bootstrap-tenant first`,
        );
      }

      const existingUser = await tx<{ id: string }[]>`
        SELECT id FROM users
         WHERE tenant_id = ${args.tenantId} AND id = ${userId}
           AND deleted_at IS NULL LIMIT 1
      `;
      if (existingUser.length === 0) {
        await tx`
          INSERT INTO users (
            id, tenant_id, email, phone, status,
            is_owner, settings, created_at, updated_at, created_by
          ) VALUES (
            ${userId}, ${args.tenantId}, ${email}, ${args.phone}, 'active',
            false,
            ${tx.json({ cohort: args.cohort, persona: 'pilot' })},
            NOW(), NOW(), 'pilot-provision-script'
          )
        `;
      } else {
        // Converge cohort label so re-runs reset it.
        await tx`
          UPDATE users
             SET settings = settings || ${tx.json({ cohort: args.cohort, persona: 'pilot' })}::jsonb,
                 updated_at = NOW()
           WHERE id = ${userId} AND tenant_id = ${args.tenantId}
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 2 });
  }

  return Object.freeze({
    userId,
    tenantId: args.tenantId,
    cohort: args.cohort,
    phone: args.phone,
    email,
    alreadyExisted,
  });
}

function printSummary(result: PilotProvisionResult, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      '─── Borjie pilot user provisioned ─────────────────────────────',
      `  tenant   : ${result.tenantId}`,
      `  cohort   : ${result.cohort}`,
      `  user id  : ${result.userId}`,
      `  phone    : ${result.phone}`,
      `  email    : ${result.email}`,
      `  status   : ${result.alreadyExisted ? 'already existed (converged)' : 'newly created'}`,
      '───────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  let args: PilotProvisionArgs;
  try {
    args = parsePilotProvisionArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof PilotProvisionValidationError) {
      process.stderr.write(`[pilot-provision] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  try {
    const result = await provisionPilotUser(args);
    printSummary(result, args.json);
    process.exit(0);
  } catch (err) {
    if (err instanceof PilotProvisionValidationError) {
      process.stderr.write(`[pilot-provision] ${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(
      `[pilot-provision] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// Direct invocation: `tsx scripts/pilot-provision.ts ...`
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('pilot-provision.ts');

if (invokedDirectly) {
  void main();
}

export { provisionPilotUser };
export type { PilotProvisionResult };
