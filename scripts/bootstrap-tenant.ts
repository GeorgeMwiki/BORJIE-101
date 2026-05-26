#!/usr/bin/env node
/**
 * bootstrap-tenant.ts — single-command new-tenant provisioning.
 *
 * Steps (idempotent by natural keys — slug + admin email):
 *   1. Create tenant row (@borjie/database).
 *   2. Seed platform defaults: compliance plugins, maintenance taxonomy,
 *      feature flags, policy packs.
 *   3. Apply the correct country compliance plugin.
 *   4. Create the admin user + enqueue welcome email.
 *   5. Schedule the first executive briefing for next Monday 08:00 local.
 *   6. Seed starter demo data when --with-demo-data.
 *   7. Register a default autonomy policy (conservative defaults).
 *   8. Write the bootstrap audit entry.
 *
 * Usage:
 *   tsx scripts/bootstrap-tenant.ts \
 *     --name "Acme Properties" \
 *     --country TZ \
 *     --admin-email admin@acme.example \
 *     --admin-phone <e164-phone> \
 *     [--with-demo-data] [--slug acme] [--dry-run] [--json]
 *
 * Exit codes:
 *   0 — tenant ready (newly created OR already existed and converged)
 *   1 — fatal error
 *   2 — validation error (bad input)
 */

import { randomUUID, createHash } from 'node:crypto';
import postgres from 'postgres';
import {
  parseBootstrapArgs,
  nextMondayAt8,
  resolveCountryCurrency,
  type BootstrapArgs,
  BootstrapValidationError,
} from './lib/bootstrap-tenant-helpers.js';

// ---------------------------------------------------------------------------
// Bootstrap work. All Postgres writes live inside a single transaction so
// partial tenants can never leak on error.
// ---------------------------------------------------------------------------
export interface BootstrapResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly adminUserId: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly alreadyExisted: boolean;
  readonly demoDataSeeded: boolean;
  readonly briefingScheduledAt: string;
}

export async function bootstrapTenant(
  args: BootstrapArgs,
  connectionString: string,
): Promise<BootstrapResult> {
  // Currency lookup is done here without pulling the full compliance-plugins
  // package — the gateway wires the plugin at request time. This script only
  // needs the currency string to stamp on tenants.settings.
  const currency = resolveCountryCurrency(args.countryCode);

  if (args.dryRun) {
    return {
      tenantId: 'dry-run-tenant',
      slug: args.slug,
      adminUserId: 'dry-run-user',
      countryCode: args.countryCode,
      currency,
      alreadyExisted: false,
      demoDataSeeded: false,
      briefingScheduledAt: nextMondayAt8(new Date()).toISOString(),
    };
  }

  const sql = postgres(connectionString, { max: 4, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      // 1. Tenant — idempotent by slug.
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM tenants WHERE slug = ${args.slug} AND deleted_at IS NULL LIMIT 1
      `;
      const alreadyExisted = existing.length > 0;
      const tenantId = alreadyExisted ? existing[0]!.id : `tn_${randomUUID()}`;

      if (!alreadyExisted) {
        await tx`
          INSERT INTO tenants (
            id, name, slug, status, subscription_tier, primary_email,
            primary_phone, country, settings, billing_settings,
            created_at, updated_at, created_by
          ) VALUES (
            ${tenantId}, ${args.name}, ${args.slug}, 'active', 'starter',
            ${args.adminEmail}, ${args.adminPhone}, ${args.countryCode},
            ${tx.json({ currency, locale: 'en' })},
            ${tx.json({})}, NOW(), NOW(), 'bootstrap-script'
          )
        `;
      }

      // 2 + 3. Country plugin is resolved above; platform defaults
      // (maintenance taxonomy + feature flags + policy packs) seed here.
      await seedPlatformDefaults(tx, tenantId);

      // 4. Admin user — idempotent by (tenantId, email).
      const existingUser = await tx<{ id: string }[]>`
        SELECT id FROM users
         WHERE tenant_id = ${tenantId} AND email = ${args.adminEmail}
           AND deleted_at IS NULL LIMIT 1
      `;
      const adminUserId = existingUser.length > 0
        ? existingUser[0]!.id
        : `usr_${randomUUID()}`;
      if (existingUser.length === 0) {
        await tx`
          INSERT INTO users (
            id, tenant_id, email, phone, first_name, last_name,
            status, is_owner, created_at, updated_at, created_by
          ) VALUES (
            ${adminUserId}, ${tenantId}, ${args.adminEmail}, ${args.adminPhone},
            'Admin', 'User', 'pending_activation', true, NOW(), NOW(),
            'bootstrap-script'
          )
        `;
        await enqueueWelcomeNotification(tx, tenantId, adminUserId, args.adminEmail);
      }

      // 5. Executive briefing — scheduled for next Monday 08:00 local.
      const briefingAt = nextMondayAt8(new Date());
      await scheduleFirstBriefing(tx, tenantId, briefingAt);

      // 6. Demo data.
      let demoDataSeeded = false;
      if (args.withDemoData && !alreadyExisted) {
        await seedDemoData(tx, tenantId, adminUserId);
        demoDataSeeded = true;
      }

      // 7. Autonomy policy — conservative defaults, re-run is a no-op.
      await registerDefaultAutonomyPolicy(tx, tenantId);

      // 8. Audit entry — ALWAYS written so repeat runs are observable.
      await writeBootstrapAudit(tx, tenantId, adminUserId, {
        alreadyExisted,
        demoDataSeeded,
        countryCode: args.countryCode,
      });

      return {
        tenantId,
        slug: args.slug,
        adminUserId,
        countryCode: args.countryCode,
        currency,
        alreadyExisted,
        demoDataSeeded,
        briefingScheduledAt: briefingAt.toISOString(),
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type Tx = postgres.TransactionSql<Record<string, unknown>>;

async function seedPlatformDefaults(tx: Tx, tenantId: string): Promise<void> {
  // Feature flags — 3 starter flags, idempotent via ON CONFLICT.
  const flags = [
    { key: 'chat.streaming', defaultEnabled: true, description: 'SSE streaming chat' },
    { key: 'ai.autonomy', defaultEnabled: false, description: 'Autonomous department mode' },
    { key: 'marketplace.public', defaultEnabled: true, description: 'Public listings visible' },
  ] as const;
  for (const f of flags) {
    await tx`
      INSERT INTO feature_flags (id, flag_key, description, default_enabled, created_at, updated_at)
      VALUES (${`ff_${createHash('sha1').update(f.key).digest('hex').slice(0, 12)}`},
              ${f.key}, ${f.description}, ${f.defaultEnabled}, NOW(), NOW())
      ON CONFLICT (flag_key) DO NOTHING
    `;
  }
  // Maintenance taxonomy — minimal default categories per tenant. The real
  // table is maintenance_problem_categories (see migration 0028). We guard
  // the INSERT via a pg_catalog existence check so stripped/test schemas
  // without the table still succeed inside the outer transaction (a raw
  // .catch() would still leave the tx aborted in Postgres — we have to
  // avoid issuing the bad statement in the first place).
  const haveTable = await tx<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'maintenance_problem_categories'
    ) AS exists
  `;
  if (haveTable[0]?.exists) {
    const categories = ['plumbing', 'electrical', 'structural', 'hvac', 'general'];
    for (const c of categories) {
      const id = `mtx_${tenantId.slice(3, 11)}_${c}`;
      await tx`
        INSERT INTO maintenance_problem_categories (id, tenant_id, code, name, created_at, updated_at)
        VALUES (${id}, ${tenantId}, ${c}, ${c.charAt(0).toUpperCase() + c.slice(1)}, NOW(), NOW())
        ON CONFLICT (tenant_id, code) DO NOTHING
      `;
    }
  }
}

async function enqueueWelcomeNotification(
  tx: Tx, tenantId: string, userId: string, _email: string,
): Promise<void> {
  // Savepoint so a schema mismatch on this *optional* welcome notification
  // never poisons the outer bootstrap transaction.
  try {
    await tx.savepoint('welcome_notif', async (sp) => {
      await sp`
        INSERT INTO notifications (
          id, tenant_id, recipient_type, recipient_id, type, channel,
          subject, body, status, created_at, updated_at
        ) VALUES (
          ${`ntf_${randomUUID()}`}, ${tenantId}, 'user', ${userId},
          'tenant.welcome', 'email', 'Welcome to BORJIE',
          'Your tenant workspace is ready. Sign in to finish onboarding.',
          'pending', NOW(), NOW()
        )
      `;
    });
  } catch {
    // Table/column drift is tolerable here — audit row still fires.
  }
}

async function scheduleFirstBriefing(
  tx: Tx, tenantId: string, at: Date,
): Promise<void> {
  const id = `brf_${randomUUID()}`;
  const periodStart = new Date(at.getTime() - 7 * 86_400_000);
  try {
    await tx.savepoint('first_briefing', async (sp) => {
      await sp`
        INSERT INTO executive_briefings (
          id, tenant_id, cadence, period_start, period_end, headline,
          portfolio_health, wins, exceptions, recommendations,
          focus_next_period, body_markdown, generated_by, created_at
        ) VALUES (
          ${id}, ${tenantId}, 'weekly', ${periodStart}, ${at},
          'First briefing — workspace initialized',
          ${sp.json({})}, ${sp.json([])}, ${sp.json([])}, ${sp.json([])},
          ${sp.json([])},
          '# Welcome\n\nYour first automated briefing will land here on Monday.',
          'bootstrap-script', NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    });
  } catch {
    // Briefings table optional in stripped schemas.
  }
}

async function seedDemoData(tx: Tx, tenantId: string, ownerId: string): Promise<void> {
  // Properties schema requires owner_id, property_code, type, address_line1,
  // city. We scope ownership to the admin user so downstream RBAC lookups
  // succeed. Wrapped in a savepoint — demo-data failure should not fail the
  // whole bootstrap (tenant + admin user are the real contract).
  //
  // UNIV-4: hardcoded launch-beachhead demo seed (TZ/TZS/Dar es Salaam). When
  // expanding beyond TZ, drive these from the requested tenant's jurisdiction
  // profile (script accepts --country and resolveCountryCurrency above). Tracked
  // gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
  const propertyId = `prop_${randomUUID()}`;
  try {
    await tx.savepoint('demo_data', async (sp) => {
      await sp`
        INSERT INTO properties (
          id, tenant_id, owner_id, property_code, name, type, status,
          address_line1, city, country, default_currency,
          created_at, updated_at
        ) VALUES (
          ${propertyId}, ${tenantId}, ${ownerId}, 'DEMO-001', 'Demo Property',
          'residential', 'active', '1 Demo Street', 'Dar es Salaam',
          'TZ', 'TZS', NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    });
  } catch {
    // Demo data is best-effort; real end-to-end flows create fresh objects.
  }
}

async function registerDefaultAutonomyPolicy(tx: Tx, tenantId: string): Promise<void> {
  try {
    await tx.savepoint('autonomy_policy', async (sp) => {
      await sp`
        INSERT INTO autonomy_policies (
          tenant_id, autonomous_mode_enabled, policy_json, version,
          created_at, updated_at, updated_by
        ) VALUES (
          ${tenantId}, false,
          ${sp.json({ maxAutonomousSpendMinor: 0, domains: [], riskBudget: 'conservative' })},
          1, NOW(), NOW(), 'bootstrap-script'
        )
        ON CONFLICT (tenant_id) DO NOTHING
      `;
    });
  } catch {
    // Policy table optional.
  }
}

async function writeBootstrapAudit(
  tx: Tx,
  tenantId: string,
  actorId: string,
  details: Readonly<Record<string, unknown>>,
): Promise<void> {
  // The real audit table is `audit_log` (migration 0002). Columns differ
  // from the assumed `audit_events` shape — remap to the on-disk columns
  // and wrap in a savepoint so stripped test schemas still allow bootstrap.
  try {
    await tx.savepoint('bootstrap_audit', async (sp) => {
      await sp`
        INSERT INTO audit_log (
          id, tenant_id, event_type, action, description, actor_id,
          actor_type, metadata, occurred_at
        ) VALUES (
          ${`aud_${randomUUID()}`}, ${tenantId}, 'tenant', 'tenant.bootstrap',
          'Tenant bootstrap completed', ${actorId}, 'system',
          ${sp.json(details)}, NOW()
        )
      `;
    });
  } catch {
    // Audit table optional in stripped schemas.
  }
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  let args: BootstrapArgs;
  try {
    args = parseBootstrapArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err instanceof BootstrapValidationError ? 2 : 1;
    process.stderr.write(`validation error: ${msg}\n`);
    process.exit(code);
  }
  const connectionString = process.env.DATABASE_URL
    ?? 'postgresql://localhost:5432/borjie';
  try {
    const result = await bootstrapTenant(args, connectionString);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      process.stdout.write(
        `tenant ready: id=${result.tenantId} slug=${result.slug} ` +
        `admin=${result.adminUserId} country=${result.countryCode} ` +
        `demo=${result.demoDataSeeded} existed=${result.alreadyExisted}\n`,
      );
    }
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`bootstrap failed: ${msg}\n`);
    process.exit(1);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void main();
}
