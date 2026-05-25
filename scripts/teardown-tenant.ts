#!/usr/bin/env node
/**
 * teardown-tenant.ts — mirror-opposite of bootstrap-tenant. Test/dev only.
 *
 * Refuses to run unless BORJIE_ALLOW_TEARDOWN=true AND the tenant slug
 * resolves to an id. Uses soft-delete (deleted_at) first, then hard-deletes
 * dependent rows only when --hard is passed. Cascades on foreign keys
 * handle the tree; what this script does is mark the row dead so the app
 * hides it.
 *
 * Usage:
 *   tsx scripts/teardown-tenant.ts --slug acme [--hard] [--json]
 */

import postgres from 'postgres';

interface TeardownArgs {
  readonly slug: string;
  readonly hard: boolean;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): TeardownArgs {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok || !tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    if (eq > 0) {
      flags.set(tok.slice(2, eq), tok.slice(eq + 1));
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags.set(key, next); i += 1; }
    else flags.set(key, true);
  }
  const slug = String(flags.get('slug') ?? '').trim().toLowerCase();
  if (!slug) throw new Error('--slug is required');
  return { slug, hard: Boolean(flags.get('hard')), json: Boolean(flags.get('json')) };
}

export interface TeardownResult {
  readonly tenantId: string | null;
  readonly removed: boolean;
  readonly hard: boolean;
}

export async function teardownTenant(
  args: TeardownArgs, connectionString: string,
): Promise<TeardownResult> {
  if (process.env.BORJIE_ALLOW_TEARDOWN !== 'true') {
    throw new Error('refusing: set BORJIE_ALLOW_TEARDOWN=true to confirm');
  }
  const sql = postgres(connectionString, { max: 2, onnotice: () => {} });
  try {
    const result = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM tenants WHERE slug = ${args.slug} LIMIT 1
      `;
      if (rows.length === 0) {
        return { tenantId: null, removed: false, hard: args.hard };
      }
      const tenantId = rows[0]!.id;
      if (args.hard) {
        // Foreign-key cascades will cull dependents.
        await tx`DELETE FROM tenants WHERE id = ${tenantId}`;
      } else {
        await tx`UPDATE tenants SET deleted_at = NOW(), deleted_by = 'teardown-script' WHERE id = ${tenantId}`;
      }
      return { tenantId, removed: true, hard: args.hard };
    });
    return result;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dsn = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/borjie';
  try {
    const result = await teardownTenant(args, dsn);
    if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`teardown: ${JSON.stringify(result)}\n`);
    process.exit(result.removed ? 0 : 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`teardown failed: ${msg}\n`);
    process.exit(1);
  }
}

if (typeof require !== 'undefined' && require.main === module) void main();
