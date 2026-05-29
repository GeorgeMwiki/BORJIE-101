/**
 * scripts/live-test/seed-demo.ts
 *
 * One-shot wrapper that prepares the dev database for live user testing.
 * Runs the two seeders in the right order, announces what was created,
 * and exits non-zero on any failure.
 *
 *   1. borjie-test-users.seed.ts       — Supabase Auth + public.users mirror
 *      for the 5 canonical test accounts (owner/admin/manager/worker/buyer).
 *   2. borjie-mining-demo.seed.ts      — Tanzanian mining-domain operational
 *      data (3 sites, 3 licences, 12 employees, 4 tasks, 2 reminders, 1
 *      buyer, 1 ore parcel, 1 sale, 1 chain-of-custody step, 1 cooperative
 *      settlement, 1 in-progress LOI draft, 1 risk, 1 follow-up task).
 *
 * Idempotent — re-running upserts rather than duplicating.
 *
 * REFUSES to run with NODE_ENV=production. The downstream seeders enforce
 * the same hard rule.
 *
 * Invocation:
 *   pnpm tsx scripts/live-test/seed-demo.ts
 *
 * Required env (already in .env / .env.local):
 *   DATABASE_URL
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SEED_TEST_* (tenant ID, names, user emails, passwords)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface Step {
  readonly name: string;
  readonly script: string;
}

const STEPS: readonly Step[] = [
  {
    name: 'Borjie test users (Supabase Auth + public.users)',
    script: 'packages/database/src/seeds/borjie-test-users.seed.ts',
  },
  {
    name: 'Borjie mining demo data (Tanzanian operational shape)',
    script: 'packages/database/src/seeds/borjie-mining-demo.seed.ts',
  },
];

function announce(line: string): void {
  // eslint-disable-next-line no-console -- CLI script, structured logger is overkill
  console.log(line);
}

async function runStep(step: Step): Promise<number> {
  const fullPath = path.join(REPO_ROOT, step.script);
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['tsx', fullPath], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', reject);
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo.ts refuses to run with NODE_ENV=production');
  }

  const started = Date.now();
  announce('');
  announce('========================================================');
  announce('  Borjie live-test demo seed');
  announce('========================================================');
  announce(`  Tenant ID    : ${process.env.SEED_TEST_TENANT_ID ?? '(default)'}`);
  announce(`  Tenant Name  : ${process.env.SEED_TEST_TENANT_NAME ?? '(default)'}`);
  announce(`  Owner email  : ${process.env.SEED_TEST_OWNER_EMAIL ?? '(default)'}`);
  announce(`  Database URL : ${(process.env.DATABASE_URL ?? '').slice(0, 40)}...`);
  announce('');
  announce('Steps to run:');
  STEPS.forEach((s, i) => announce(`  ${i + 1}. ${s.name}`));
  announce('');

  for (const [i, step] of STEPS.entries()) {
    announce(`---- Step ${i + 1}/${STEPS.length}: ${step.name} ----`);
    const code = await runStep(step);
    if (code !== 0) {
      announce(`!! Step failed with exit code ${code}`);
      announce(`!! See logs above. Halting seed run.`);
      process.exit(code);
    }
  }

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  announce('');
  announce('========================================================');
  announce(`  Seed complete in ${elapsedSec}s.`);
  announce('  Demo tenant is ready for the live-test runbook.');
  announce('  Next: pnpm tsx scripts/live-test/happy-path.ts');
  announce('========================================================');
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI script, structured logger is overkill
  console.error('seed-demo: FAILED', err);
  process.exit(1);
});
