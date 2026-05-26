/**
 * Seed runner CLI.
 *
 * Usage:
 *   pnpm db:seed --org=demo
 *   pnpm db:seed --org=all
 *
 * Each org seed is invoked inside its own transaction (managed by the seed
 * itself). The runner simply wires up the database client and dispatches
 * based on the --org flag.
 *
 * Requires DATABASE_URL. Refuses to run without an explicit SEED_ORG_SEEDS=true
 * acknowledgement so org seeds cannot accidentally execute in production.
 */

import { createDatabaseClient } from '../client.js';
import { seedDemoOrg } from './demo-org-seed.js';
import { seedTrcTestOrg } from './trc-test-org-seed.js';

interface ParsedArgs {
  readonly org: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let org = '';
  for (const arg of argv) {
    const match = arg.match(/^--org=(.+)$/);
    if (match && match[1]) {
      org = match[1].trim().toLowerCase();
    }
  }
  if (!org) {
    throw new Error(
      'Missing --org=<name> flag. Try --org=demo or --org=all.',
    );
  }
  return { org };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Seed: required env var ${name} is not set.`,
    );
  }
  return v;
}

type OrgSeedRunner = (db: ReturnType<typeof createDatabaseClient>) => Promise<void>;

const ORG_SEEDS: Record<string, OrgSeedRunner> = {
  demo: seedDemoOrg,
  // TRC (Test Reference Corporation) — minimal canonical test org. Tenant +
  // org + 5 users only. NO operational data; first MD conversation
  // bootstraps everything else. See trc-test-org-seed.ts.
  trc: seedTrcTestOrg,
  // future: additional per-org fixture bundles.
};

// Platform-default seeds — cross-tenant catalogs (no tenant data). Safe to
// run in every environment. Invoked via --org=platform-defaults (no
// SEED_ORG_SEEDS gate).
const PLATFORM_SEEDS: Record<string, OrgSeedRunner> = {
  'platform-defaults': async (_db) => {
    // See gh-issue #29: maintenance-taxonomy was property-domain and
    // shipped with BossNyumba. Rebuild a mining-equivalent (drilling-
    // incident-taxonomy, equipment-failure-taxonomy, etc.) and re-wire
    // here.
    console.log('[run-seed]   platform-defaults: no-op (mining taxonomies pending)');
  },
  // Knowledge-base RAG corpus. The runner logs guidance for wiring the
  // Drizzle knowledge store — the authoritative seed function lives in the
  // ai-copilot package (`seedPlatformKnowledge`). Keep this entry so
  // operators discover the workflow.
  'knowledge-base': async () => {
    console.log(
      '[run-seed]   knowledge-base: invoke seedPlatformKnowledge from',
    );
    console.log(
      '[run-seed]   @borjie/ai-copilot with a DrizzleKnowledgeStore',
    );
    console.log(
      '[run-seed]   bound to this database. See packages/ai-copilot/src/knowledge/platform-seed.ts.',
    );
  },
};

async function main(): Promise<void> {
  const { org } = parseArgs(process.argv.slice(2));

  const isPlatformSeed = PLATFORM_SEEDS[org] !== undefined;

  // Hard gate — ORG seeds must be opted into explicitly so a dev running
  // `pnpm db:seed` against a prod URL does not inadvertently write fake
  // data. PLATFORM-level seeds (cross-tenant catalogs) are always safe.
  if (!isPlatformSeed && process.env.SEED_ORG_SEEDS !== 'true') {
    throw new Error(
      'Refusing to run org seeds: set SEED_ORG_SEEDS=true to acknowledge ' +
        'this will write sample data for the requested organization(s).',
    );
  }

  const databaseUrl = requireEnv('DATABASE_URL');
  const db = createDatabaseClient(databaseUrl);

  const runners = isPlatformSeed ? PLATFORM_SEEDS : ORG_SEEDS;
  const targets = org === 'all' ? Object.keys(ORG_SEEDS) : [org];

  for (const target of targets) {
    const runner = runners[target];
    if (!runner) {
      throw new Error(
        `Unknown seed "${target}". Known org: ${Object.keys(ORG_SEEDS).join(', ')}. Known platform: ${Object.keys(PLATFORM_SEEDS).join(', ')}.`,
      );
    }
    console.log(`[run-seed] running seed for ${target}`);
    try {
      await runner(db);
    } catch (err) {
      console.error(`[run-seed] seed failed for ${target}:`, err);
      throw err;
    }
  }

  console.log('[run-seed] all seeds complete');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[run-seed] fatal:', err);
    process.exit(1);
  });
