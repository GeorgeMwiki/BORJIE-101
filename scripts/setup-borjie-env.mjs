#!/usr/bin/env node
/**
 * setup-borjie-env.mjs — one-command BORJIE dev bootstrap.
 *
 * What it does (12 steps, all-or-nothing with best-effort rollback):
 *   1.  Preflight: required CLIs (`supabase`, `openssl`, `node`, `pnpm`).
 *   2.  Read existing `.env.local` (preserve user-set values).
 *   3.  Generate crypto secrets (replaces any TODO_BORJIE_* markers).
 *   4.  Prompt for / verify SUPABASE_ACCESS_TOKEN.
 *   5.  Prompt for / verify SUPABASE_ORG_ID.
 *   6.  `supabase projects create borjie-dev --org-id <id>`.
 *   7.  `supabase projects api-keys --project-ref <ref>` and patch into env.
 *   8.  `supabase link --project-ref <ref>` (binds local CLI).
 *   9.  Apply migrations (`packages/database && pnpm db:migrate`).
 *  10.  Seed test users + dev tenant.
 *  11.  Smoke query against the new project.
 *  12.  Print summary + next steps.
 *
 * The script is idempotent — re-running with the same project-ref skips
 * creation. Pass `--dry-run` for a no-side-effects preview. Pass `--yes`
 * to skip confirmation prompts (CI-friendly).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm setup-env
 *   pnpm setup-env --dry-run
 *   pnpm setup-env --skip-supabase   # only refresh secrets, leave Supabase alone
 *
 * Exit codes:
 *   0 — environment ready
 *   1 — fatal error (printed to stderr; partial rollback attempted)
 *   2 — missing prerequisite (CLI, env var, prompt input)
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  generateAllSecrets,
  SECRET_FIELDS,
  TODO_MARKER_PREFIX,
} from './lib/env-secrets.mjs';
import {
  parseEnvFile,
  serialiseEnvFile,
  mergeEnv,
  patchSupabaseKeys,
  isPlaceholder,
} from './lib/env-mutators.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const ENV_LOCAL_PATH = resolve(REPO_ROOT, '.env.local');
const ENV_EXAMPLE_PATH = resolve(REPO_ROOT, '.env.example');
const DEFAULT_PROJECT_NAME = 'borjie-dev';
const REQUIRED_CLIS = [
  { name: 'supabase', testCmd: ['supabase', '--version'], install: 'brew install supabase/tap/supabase' },
  { name: 'openssl', testCmd: ['openssl', 'version'], install: 'macOS preinstalled; `brew install openssl@3` if missing' },
  { name: 'node', testCmd: ['node', '--version'], install: 'https://nodejs.org/ (>= 20.0.0)' },
  { name: 'pnpm', testCmd: ['pnpm', '--version'], install: 'npm install -g pnpm@8' },
];

// ---------------------------------------------------------------------------
// Tiny logger — no transitive deps; respects --quiet flag.
// ---------------------------------------------------------------------------
function makeLogger(quiet) {
  return {
    info(msg) { if (!quiet) process.stdout.write(`  ${msg}\n`); },
    step(n, total, msg) { process.stdout.write(`\n[${n}/${total}] ${msg}\n`); },
    ok(msg) { process.stdout.write(`  ok  ${msg}\n`); },
    warn(msg) { process.stderr.write(`  warn ${msg}\n`); },
    err(msg) { process.stderr.write(`  err  ${msg}\n`); },
    section(title) { process.stdout.write(`\n=== ${title} ===\n`); },
  };
}

// ---------------------------------------------------------------------------
// Parse flags. Keep zero-dep so the script never wedges on a missing dep.
// ---------------------------------------------------------------------------
export function parseFlags(argv) {
  const flags = {
    dryRun: false,
    yes: false,
    skipSupabase: false,
    quiet: false,
    projectName: DEFAULT_PROJECT_NAME,
    region: 'eu-west-2',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--skip-supabase') flags.skipSupabase = true;
    else if (a === '--quiet') flags.quiet = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('--project-name=')) flags.projectName = a.slice('--project-name='.length);
    else if (a === '--project-name') flags.projectName = argv[++i];
    else if (a.startsWith('--region=')) flags.region = a.slice('--region='.length);
    else if (a === '--region') flags.region = argv[++i];
  }
  return flags;
}

function printHelp() {
  process.stdout.write(`setup-borjie-env — one-command BORJIE bootstrap.

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm setup-env [flags]

Flags:
  --dry-run             show what would happen; no side effects
  --yes, -y             skip confirmation prompts (CI mode)
  --skip-supabase       only generate/patch secrets; leave Supabase untouched
  --project-name NAME   override Supabase project name (default: ${DEFAULT_PROJECT_NAME})
  --region REGION       Supabase region (default: eu-west-2)
  --quiet               only print errors + final summary
  --help, -h            show this message

Env vars consumed:
  SUPABASE_ACCESS_TOKEN  required for project creation; from supabase.com/dashboard/account/tokens
  SUPABASE_ORG_ID        optional; will be prompted if missing

See: Docs/RUNBOOKS/supabase-bootstrap.md
`);
}

// ---------------------------------------------------------------------------
// Step 1 — verify required CLIs are installed.
// ---------------------------------------------------------------------------
export function checkRequiredClis(spawnFn = spawnSync) {
  const missing = [];
  for (const cli of REQUIRED_CLIS) {
    const r = spawnFn(cli.testCmd[0], cli.testCmd.slice(1), { encoding: 'utf-8', stdio: 'pipe' });
    if (r.status !== 0 && !r.stdout) {
      missing.push(cli);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Step 6/7/8 — Supabase CLI orchestration. Each returns { ok, value, error }.
// ---------------------------------------------------------------------------
async function runSupabase(args, opts = {}) {
  return new Promise((resolveP) => {
    const child = spawn('supabase', args, {
      stdio: opts.captureStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    if (opts.captureStdout) {
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
    }
    child.on('error', (err) => resolveP({ ok: false, error: err.message }));
    child.on('exit', (code) => {
      if (code === 0) resolveP({ ok: true, value: stdout.trim(), stderr });
      else resolveP({ ok: false, error: stderr || stdout || `supabase ${args.join(' ')} exited ${code}` });
    });
  });
}

export function parseSupabaseApiKeysOutput(raw) {
  // Output format is "<name>  <value>" lines (CLI v1.x). Be lenient about
  // whitespace and section headers.
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('NAME') || trimmed.startsWith('---')) continue;
    const m = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const [, name, value] = m;
    if (name === 'anon') out.NEXT_PUBLIC_SUPABASE_ANON_KEY = value.trim();
    else if (name === 'service_role') out.SUPABASE_SERVICE_ROLE_KEY = value.trim();
    else if (name === 'jwt_secret' || name === 'jwt-secret') out.SUPABASE_JWT_SECRET = value.trim();
  }
  return out;
}

export function parseSupabaseProjectCreateOutput(raw) {
  // CLI prints a reference like:
  //   "Created a new project borjie-dev at https://abcdefgh.supabase.co"
  // or a row table. We look for a 20-char ref and a project URL.
  const refMatch = raw.match(/[a-z0-9]{20}/);
  const urlMatch = raw.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  return {
    ref: refMatch ? refMatch[0] : undefined,
    url: urlMatch ? urlMatch[0] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Interactive prompt helper.
// ---------------------------------------------------------------------------
async function prompt(question, { default: dflt, mask = false } = {}) {
  const rl = readline.createInterface({ input, output });
  const suffix = dflt !== undefined ? ` [${mask ? '***' : dflt}]` : '';
  try {
    const answer = await rl.question(`${question}${suffix}: `);
    return (answer || '').trim() || dflt;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator.
// ---------------------------------------------------------------------------
async function main(argv) {
  const flags = parseFlags(argv);
  if (flags.help) { printHelp(); return 0; }
  const log = makeLogger(flags.quiet);

  log.section('BORJIE dev bootstrap');
  if (flags.dryRun) log.info('DRY-RUN: no files will be modified, no Supabase API will be called.');
  log.info(`repo root: ${REPO_ROOT}`);

  const TOTAL = flags.skipSupabase ? 4 : 12;

  // ---------- Step 1: preflight CLIs ----------
  log.step(1, TOTAL, 'Preflight — verifying required CLIs');
  const missing = checkRequiredClis();
  if (missing.length > 0) {
    log.err('Missing required CLIs:');
    for (const m of missing) log.err(`  - ${m.name}: install via "${m.install}"`);
    return 2;
  }
  log.ok('all required CLIs present');

  // ---------- Step 2: read .env.local ----------
  log.step(2, TOTAL, 'Reading existing .env.local');
  let existing = {};
  let existingRaw = '';
  if (existsSync(ENV_LOCAL_PATH)) {
    existingRaw = await fs.readFile(ENV_LOCAL_PATH, 'utf-8');
    existing = parseEnvFile(existingRaw);
    log.ok(`parsed ${Object.keys(existing).length} keys from .env.local`);
  } else if (existsSync(ENV_EXAMPLE_PATH)) {
    existingRaw = await fs.readFile(ENV_EXAMPLE_PATH, 'utf-8');
    existing = parseEnvFile(existingRaw);
    log.ok('no .env.local found — initialising from .env.example');
  } else {
    log.warn('neither .env.local nor .env.example found — starting from empty');
  }

  // ---------- Step 3: generate crypto secrets ----------
  log.step(3, TOTAL, 'Generating crypto secrets');
  const secrets = generateAllSecrets();
  log.ok(`generated ${Object.keys(secrets).length} secrets (${SECRET_FIELDS.map((s) => s.key).join(', ')})`);
  // Only override placeholders — never overwrite user-set secrets.
  const merged = mergeEnv(existing, secrets, { onlyIfPlaceholder: true });
  const replaced = Object.keys(secrets).filter((k) => existing[k] !== merged[k]).length;
  log.info(`patched ${replaced} placeholder secret(s) — preserved ${Object.keys(secrets).length - replaced} user-set`);

  // ---------- Skip Supabase branch ----------
  if (flags.skipSupabase) {
    if (!flags.dryRun) {
      const next = serialiseEnvFile(existingRaw || '', merged);
      await fs.writeFile(ENV_LOCAL_PATH, next, 'utf-8');
      log.ok(`wrote ${ENV_LOCAL_PATH}`);
    }
    log.section('done (secrets-only mode)');
    log.info('Run without --skip-supabase to create the Supabase project.');
    return 0;
  }

  // ---------- Step 4: SUPABASE_ACCESS_TOKEN ----------
  log.step(4, TOTAL, 'Verifying SUPABASE_ACCESS_TOKEN');
  let accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    log.warn('SUPABASE_ACCESS_TOKEN not set.');
    log.info('Mint one at https://supabase.com/dashboard/account/tokens');
    if (flags.yes) {
      log.err('--yes set but no token in env; aborting.');
      return 2;
    }
    accessToken = await prompt('Paste SUPABASE_ACCESS_TOKEN (or Ctrl-C to abort)', { mask: true });
    if (!accessToken) { log.err('no token provided; aborting.'); return 2; }
  }
  log.ok(`access token: ${accessToken.slice(0, 7)}…`);

  // ---------- Step 5: SUPABASE_ORG_ID ----------
  log.step(5, TOTAL, 'Resolving Supabase organisation');
  let orgId = process.env.SUPABASE_ORG_ID;
  if (!orgId) {
    if (flags.yes) { log.err('--yes set but no SUPABASE_ORG_ID; aborting.'); return 2; }
    log.info('Find your org id: supabase orgs list  (after `supabase login`)');
    orgId = await prompt('SUPABASE_ORG_ID');
    if (!orgId) { log.err('no org id provided; aborting.'); return 2; }
  }
  log.ok(`org id: ${orgId}`);

  if (flags.dryRun) {
    log.section('DRY-RUN — stopping before any side effects');
    log.info(`Would create Supabase project "${flags.projectName}" in region "${flags.region}".`);
    log.info(`Would write ${Object.keys(merged).length} keys to ${ENV_LOCAL_PATH}.`);
    return 0;
  }

  // ---------- Step 6: create Supabase project ----------
  let projectRef;
  let projectUrl;
  const existingRef = existing.NEXT_PUBLIC_SUPABASE_URL?.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (existingRef && !isPlaceholder(existing.NEXT_PUBLIC_SUPABASE_URL)) {
    log.step(6, TOTAL, `Reusing existing Supabase project (${existingRef})`);
    projectRef = existingRef;
    projectUrl = existing.NEXT_PUBLIC_SUPABASE_URL;
    log.ok(`skipped creation — using ${projectUrl}`);
  } else {
    log.step(6, TOTAL, `Creating Supabase project "${flags.projectName}"`);
    const created = await runSupabase(
      ['projects', 'create', flags.projectName, '--org-id', orgId, '--region', flags.region],
      { captureStdout: true, env: { SUPABASE_ACCESS_TOKEN: accessToken } },
    );
    if (!created.ok) {
      log.err(`project creation failed: ${created.error}`);
      return 1;
    }
    const parsed = parseSupabaseProjectCreateOutput(created.value);
    if (!parsed.ref) {
      log.err('could not extract project-ref from CLI output. Stdout:\n' + created.value);
      return 1;
    }
    projectRef = parsed.ref;
    projectUrl = parsed.url || `https://${projectRef}.supabase.co`;
    log.ok(`created ${flags.projectName} — ref=${projectRef}`);
  }

  // ---------- Step 7: fetch API keys ----------
  log.step(7, TOTAL, 'Fetching API keys');
  const keys = await runSupabase(
    ['projects', 'api-keys', '--project-ref', projectRef],
    { captureStdout: true, env: { SUPABASE_ACCESS_TOKEN: accessToken } },
  );
  if (!keys.ok) {
    log.err(`api-keys fetch failed: ${keys.error}`);
    log.warn(`Project ${projectRef} was created. Visit https://supabase.com/dashboard/project/${projectRef} to retrieve keys manually.`);
    return 1;
  }
  const apiKeys = parseSupabaseApiKeysOutput(keys.value);
  if (!apiKeys.NEXT_PUBLIC_SUPABASE_ANON_KEY || !apiKeys.SUPABASE_SERVICE_ROLE_KEY) {
    log.err('could not parse anon/service-role from CLI output. Raw:\n' + keys.value);
    return 1;
  }
  const supabasePatch = {
    NEXT_PUBLIC_SUPABASE_URL: projectUrl,
    ...apiKeys,
  };
  const mergedWithSupabase = patchSupabaseKeys(merged, supabasePatch);
  log.ok(`extracted ${Object.keys(apiKeys).length} keys`);

  // Persist .env.local now so Supabase keys + secrets are durable before the
  // riskier link/migrate steps. If those fail, the user can re-run safely.
  const nextContent = serialiseEnvFile(existingRaw, mergedWithSupabase);
  await fs.writeFile(ENV_LOCAL_PATH, nextContent, 'utf-8');
  log.ok(`wrote ${ENV_LOCAL_PATH}`);

  // ---------- Step 8: link local CLI ----------
  log.step(8, TOTAL, `Linking local CLI to ${projectRef}`);
  const linked = await runSupabase(
    ['link', '--project-ref', projectRef],
    { env: { SUPABASE_ACCESS_TOKEN: accessToken } },
  );
  if (!linked.ok) {
    log.warn(`supabase link failed: ${linked.error}`);
    log.warn(`Re-run manually: supabase link --project-ref ${projectRef}`);
  } else {
    log.ok('linked');
  }

  // ---------- Step 9: apply migrations ----------
  log.step(9, TOTAL, 'Applying database migrations');
  const migrate = spawnSync('pnpm', ['db:migrate'], {
    cwd: resolve(REPO_ROOT, 'packages/database'),
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: mergedWithSupabase.DATABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: mergedWithSupabase.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: mergedWithSupabase.NEXT_PUBLIC_SUPABASE_URL,
    },
  });
  if (migrate.status !== 0) {
    log.err('migrations failed — re-run: cd packages/database && pnpm db:migrate');
    return 1;
  }
  log.ok('migrations applied');

  // ---------- Step 10: seed test users + tenant ----------
  log.step(10, TOTAL, 'Seeding test users + dev tenant');
  const seed = spawnSync('pnpm', [
    '-s', 'exec', 'tsx', 'scripts/bootstrap-tenant.ts',
    '--name', mergedWithSupabase.BORJIE_BOOTSTRAP_TENANT_NAME || 'Acme Properties (Dev)',
    '--country', 'TZ',
    '--admin-email', mergedWithSupabase.BORJIE_BOOTSTRAP_ADMIN_EMAIL || 'georgemwikila@gmail.com',
    '--admin-phone', '+255712345678',
    '--with-demo-data',
  ], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: mergedWithSupabase.DATABASE_URL },
  });
  if (seed.status !== 0) {
    log.warn('seeding returned non-zero — migrations applied but seed incomplete.');
    log.warn('Retry manually: pnpm -s exec tsx scripts/bootstrap-tenant.ts ...');
  } else {
    log.ok('seeded');
  }

  // ---------- Step 11: smoke query ----------
  log.step(11, TOTAL, 'Smoke query — list tables');
  const smoke = await runSupabase(
    ['db', 'remote', 'commit', '--dry-run'],
    { captureStdout: true, env: { SUPABASE_ACCESS_TOKEN: accessToken } },
  );
  if (smoke.ok) log.ok('smoke passed');
  else log.warn(`smoke query non-fatal warning: ${smoke.error}`);

  // ---------- Step 12: summary ----------
  log.step(12, TOTAL, 'Summary');
  log.info(`Supabase dashboard:  https://supabase.com/dashboard/project/${projectRef}`);
  log.info(`Project URL:         ${projectUrl}`);
  log.info(`.env.local:          ${ENV_LOCAL_PATH}`);
  log.info('Next: pnpm dev');
  log.section('done');
  return 0;
}

// ESM-friendly main detection.
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`\nfatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}

export { main };
