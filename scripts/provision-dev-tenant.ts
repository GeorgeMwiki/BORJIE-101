#!/usr/bin/env node
/**
 * provision-dev-tenant.ts — single-command dev tenant + owner creation.
 *
 * Posts to the running api-gateway's public `/api/v1/orgs/signup` so the
 * dev path exercises the exact same composition as production. After
 * a successful signup the script (in non-dry-run mode) flips
 * `tenants.kyc_status = 'verified'` directly against Postgres so the
 * dev owner doesn't get stuck behind KYC blockers.
 *
 * Idempotency: keyed by phone + email. A second run against the same
 * phone returns the existing tenant id without re-creating the user.
 *
 * Usage:
 *   tsx scripts/provision-dev-tenant.ts \
 *     --name "Acme Mining" \
 *     --email owner@acme.test \
 *     --phone +255700000000 \
 *     [--kind business|individual] [--country TZ|KE|UG|NG|OTHER] \
 *     [--currency TZS|USD|KES|UGX|NGN] [--language sw|en] \
 *     [--business-reg <reg>] [--tax-id <tin>] [--mining-licence <lic>] \
 *     [--dry-run] [--json]
 *
 * Required env (loaded from .env.local by dotenv):
 *   BORJIE_API_GATEWAY_URL          → http://localhost:4000 by default
 *   DATABASE_URL                    → Postgres connection string
 *
 * Exit codes:
 *   0 — tenant ready (newly created OR already existed and converged)
 *   1 — fatal error (network / SQL / unexpected signup error)
 *   2 — validation error (bad CLI input)
 *
 * Security: refuses to run when DATABASE_URL or BORJIE_API_GATEWAY_URL
 * look like production.
 */

import pino from 'pino';
import postgres from 'postgres';
import {
  parseProvisionDevArgs,
  buildSignupBody,
  ProvisionDevValidationError,
  type ProvisionDevArgs,
  type SignupBody,
} from './lib/provision-dev-helpers.js';

const logger = pino({
  name: 'provision-dev-tenant',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['DATABASE_URL', 'password'],
});

const DEFAULT_GATEWAY_URL = 'http://localhost:4000';

// ─── Result types ────────────────────────────────────────────────────

export interface ProvisionDevResult {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly email: string;
  readonly phone: string;
  readonly kind: 'individual' | 'business';
  readonly alreadyExisted: boolean;
  readonly kycMarkedVerified: boolean;
}

// ─── Env / safety guards ─────────────────────────────────────────────

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function readEnvOneOf(names: ReadonlyArray<string>): string | undefined {
  for (const n of names) {
    const v = readEnv(n);
    if (v) return v;
  }
  return undefined;
}

function assertNotProduction(databaseUrl: string, gatewayUrl: string): void {
  if (/prod|production|live/i.test(databaseUrl)) {
    throw new ProvisionDevValidationError(
      `DATABASE_URL looks like production — refusing to run`,
    );
  }
  if (/prod|production|live/i.test(gatewayUrl)) {
    throw new ProvisionDevValidationError(
      `BORJIE_API_GATEWAY_URL looks like production — refusing to run`,
    );
  }
}

// ─── HTTP client (gateway is the source of truth) ────────────────────

export interface SignupHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpClient {
  post(
    url: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<SignupHttpResponse>;
}

const fetchHttpClient: HttpClient = {
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed };
  },
};

// ─── Postgres helpers ────────────────────────────────────────────────

export interface DbClient {
  findTenantByOwnerPhone(phone: string): Promise<{
    readonly tenantId: string;
    readonly ownerUserId: string;
  } | null>;
  markKycVerified(tenantId: string): Promise<boolean>;
}

function createPostgresClient(databaseUrl: string): {
  readonly client: DbClient;
  readonly close: () => Promise<void>;
} {
  const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
  const client: DbClient = {
    async findTenantByOwnerPhone(phone) {
      const rows = await sql<
        { tenant_id: string; id: string }[]
      >`SELECT tenant_id, id FROM users
          WHERE phone = ${phone} AND is_owner = true AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`;
      const row = rows[0];
      if (!row) return null;
      return Object.freeze({
        tenantId: row.tenant_id,
        ownerUserId: row.id,
      });
    },
    async markKycVerified(tenantId) {
      // Forward-only: only touches the column if it exists. Stripped
      // test schemas don't carry kyc_status so we tolerate absence.
      const colExists = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'tenants'
              AND column_name = 'kyc_status'
        ) AS exists`;
      if (!colExists[0]?.exists) return false;
      const affected = await sql`
        UPDATE tenants
           SET kyc_status = 'verified', updated_at = NOW()
         WHERE id = ${tenantId} AND deleted_at IS NULL
      `;
      return Array.isArray(affected) && affected.count > 0;
    },
  };
  return Object.freeze({
    client,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  });
}

// ─── Core orchestration (pure args + deps) ───────────────────────────

export interface ProvisionDevDeps {
  readonly http: HttpClient;
  readonly db: DbClient;
  readonly gatewayUrl: string;
}

export async function provisionDevTenant(
  args: ProvisionDevArgs,
  deps: ProvisionDevDeps,
): Promise<ProvisionDevResult> {
  if (args.dryRun) {
    return Object.freeze({
      tenantId: 'dry-run-tenant',
      ownerUserId: 'dry-run-owner',
      email: args.email,
      phone: args.phone,
      kind: args.kind,
      alreadyExisted: false,
      kycMarkedVerified: false,
    });
  }

  // 1. Idempotency check — if an owner with this phone exists, return.
  const existing = await deps.db.findTenantByOwnerPhone(args.phone);
  if (existing) {
    logger.info({
      tenantId: existing.tenantId,
      phone: args.phone,
      msg: 'tenant already exists for phone — converging',
    });
    const verified = await deps.db.markKycVerified(existing.tenantId);
    return Object.freeze({
      tenantId: existing.tenantId,
      ownerUserId: existing.ownerUserId,
      email: args.email,
      phone: args.phone,
      kind: args.kind,
      alreadyExisted: true,
      kycMarkedVerified: verified,
    });
  }

  // 2. Signup via the public gateway endpoint.
  const body: SignupBody = buildSignupBody(args);
  const url = `${deps.gatewayUrl.replace(/\/+$/, '')}/api/v1/orgs/signup`;
  const res = await deps.http.post(url, body as unknown as Record<string, unknown>);
  if (res.status !== 201) {
    throw new Error(
      `signup failed (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  const payload = res.body as
    | { tenantId?: string; ownerUserId?: string }
    | null;
  const tenantId = payload?.tenantId;
  const ownerUserId = payload?.ownerUserId;
  if (!tenantId || !ownerUserId) {
    throw new Error(
      `signup response missing tenantId/ownerUserId: ${JSON.stringify(payload)}`,
    );
  }

  // 3. Flip KYC to verified for dev convenience.
  const verified = await deps.db.markKycVerified(tenantId);

  return Object.freeze({
    tenantId,
    ownerUserId,
    email: args.email,
    phone: args.phone,
    kind: args.kind,
    alreadyExisted: false,
    kycMarkedVerified: verified,
  });
}

// ─── Summary printer ─────────────────────────────────────────────────

function printSummary(result: ProvisionDevResult, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = [
    '─── Borjie dev tenant provisioned ─────────────────────────────',
    `  tenant id  : ${result.tenantId}`,
    `  owner id   : ${result.ownerUserId}`,
    `  phone      : ${result.phone}`,
    `  email      : ${result.email}`,
    `  kind       : ${result.kind}`,
    `  status     : ${result.alreadyExisted ? 'already existed (converged)' : 'newly created'}`,
    `  kyc        : ${result.kycMarkedVerified ? 'marked verified' : 'unchanged'}`,
    '───────────────────────────────────────────────────────────────',
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

// ─── CLI entry ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: ProvisionDevArgs;
  try {
    args = parseProvisionDevArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ProvisionDevValidationError) {
      process.stderr.write(`[provision-dev-tenant] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const databaseUrl =
    readEnv('DATABASE_URL') ?? 'postgresql://borjie:borjie@localhost:5432/borjie';
  const gatewayUrl =
    readEnvOneOf(['BORJIE_API_GATEWAY_URL', 'API_GATEWAY_URL', 'GATEWAY_URL']) ??
    DEFAULT_GATEWAY_URL;

  try {
    assertNotProduction(databaseUrl, gatewayUrl);
  } catch (err) {
    if (err instanceof ProvisionDevValidationError) {
      process.stderr.write(`[provision-dev-tenant] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const pg = createPostgresClient(databaseUrl);
  try {
    const result = await provisionDevTenant(args, {
      http: fetchHttpClient,
      db: pg.client,
      gatewayUrl,
    });
    printSummary(result, args.json);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, 'provision-dev-tenant failed');
    process.stderr.write(`[provision-dev-tenant] ${message}\n`);
    process.exit(1);
  } finally {
    await pg.close();
  }
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('provision-dev-tenant.ts');

if (invokedDirectly) {
  void main();
}
