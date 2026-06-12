#!/usr/bin/env node
/**
 * migration-drift-dryrun — live-DB migration drift dry-run + safe-apply planner.
 *
 * THE FOUNDER TOOL. Run this against the LIVE Supabase URL (or a prod
 * clone) BEFORE applying anything. It tells you EXACTLY what will happen
 * and emits a maintenance-window-ordered apply plan, so the only human
 * steps left are: (1) provide the live URL, (2) choose the window,
 * (3) run the apply command this script prints.
 *
 * It is STRICTLY READ-ONLY against the target database. It issues only
 * SELECTs against the migration-tracking ledger and never opens a write
 * transaction, never CREATEs/ALTERs/DROPs anything. Safe to point at
 * production.
 *
 * WHAT IT DOES
 *
 *   1. CONNECT (read-only) and read the APPLIED set from whichever
 *      migration ledger the target DB uses. Two runners ship in this
 *      repo and both key by the bare filename (minus `.sql`):
 *        - `drizzle.__drizzle_migrations.hash`  (run-migrations.ts — the
 *          baseline-first runner used at boot / container entrypoint)
 *        - `_migrations.version`                (scripts/migrate-prod.ts)
 *      We UNION both so the dry-run is correct no matter which one
 *      provisioned the DB. If neither table exists, every on-disk
 *      migration is reported as PENDING (a fresh DB).
 *
 *   2. DIFF vs the on-disk forward migrations, in the SAME lex order the
 *      runner applies them: baseline (packages/database/drizzle/) first,
 *      then deltas (packages/database/src/migrations/). The delta is the
 *      ordered list of PENDING files.
 *
 *   3. STATICALLY SCAN each pending file's SQL for lock hazards and
 *      classify the migration SAFE / NEEDS-WINDOW / DANGER:
 *        - non-CONCURRENT CREATE INDEX        → NEEDS-WINDOW (counted;
 *          0305 alone carries ~377 of these — an index storm that locks
 *          every target table for writes for the duration)
 *        - ALTER … ADD COLUMN … NOT NULL without DEFAULT → DANGER
 *          (table rewrite + fails outright if the table has rows)
 *        - ALTER … ALTER COLUMN … SET NOT NULL on an existing column
 *          → NEEDS-WINDOW (full table scan under ACCESS EXCLUSIVE)
 *        - ALTER … ALTER COLUMN … TYPE …      → NEEDS-WINDOW (table
 *          rewrite under ACCESS EXCLUSIVE)
 *        - DROP TABLE / DROP COLUMN / DROP INDEX (non-concurrent) /
 *          DROP CONSTRAINT / DROP TYPE        → DANGER (destructive +
 *          ACCESS EXCLUSIVE)
 *        - ALTER TYPE … ADD VALUE             → NEEDS-WINDOW (enum
 *          mutation; cannot run inside a multi-statement txn on older PG)
 *      A migration with no hazard is SAFE (online-applicable).
 *
 *   4. EMIT a maintenance-window APPLY PLAN: the ordered pending list
 *      split into ONLINE-SAFE vs NEEDS-A-WINDOW, an est. risk note per
 *      migration, and the EXACT command to apply (the repo's runner).
 *
 * HONEST DEGRADE: if it cannot connect, it says so clearly and still
 * prints the on-disk static analysis (treating every migration as
 * potentially-pending) so the founder gets the hazard picture even
 * offline — but flags that the applied/pending split is unverified.
 *
 * CLI:
 *   node scripts/migration-drift-dryrun.mjs --db-url=$DATABASE_URL
 *   node scripts/migration-drift-dryrun.mjs            # reads $DATABASE_URL
 *   node scripts/migration-drift-dryrun.mjs --json     # machine-readable
 *   node scripts/migration-drift-dryrun.mjs --report=.audit/migration-dryrun.md
 *
 * Exit codes:
 *   0  dry-run completed (whether or not there are pending migrations)
 *   2  fatal harness error (bad args, unreadable migrations dir)
 *
 * NOTE: a non-zero pending count is NOT an error — pending work is the
 * normal state this tool exists to plan. The exit code reflects only
 * whether the dry-run itself ran.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const DEFAULTS = Object.freeze({
  baselineDir: 'packages/database/drizzle',
  migrationsDir: 'packages/database/src/migrations',
  dbUrl: process.env.DATABASE_URL || '',
  report: '',
  json: false,
});

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? 'true' : raw.slice(eq + 1);
    switch (key) {
      case 'baseline-dir':
        args.baselineDir = value === 'none' ? '' : value;
        break;
      case 'migrations-dir':
        args.migrationsDir = value;
        break;
      case 'db-url':
        args.dbUrl = value;
        break;
      case 'report':
        args.report = value;
        break;
      case 'json':
        args.json = value === 'true' || value === '1' || value === '';
        break;
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(
    [
      'migration-drift-dryrun — live-DB drift dry-run + safe-apply planner (READ-ONLY)',
      '',
      'Usage:',
      '  node scripts/migration-drift-dryrun.mjs [flags]',
      '',
      'Flags:',
      '  --db-url=<url>           target DB (live or clone). Or set $DATABASE_URL.',
      '  --migrations-dir=<path>  default packages/database/src/migrations',
      '  --baseline-dir=<path>    default packages/database/drizzle (or "none")',
      '  --report=<path>          also write the markdown plan to this path',
      '  --json                   emit machine-readable JSON instead of markdown',
      '',
      'Read-only: issues only SELECTs against the migration ledger. Never writes.',
      '',
      'Exit codes:',
      '  0  dry-run completed (pending migrations are normal, not an error)',
      '  2  fatal harness error',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// On-disk migration discovery (baseline-first, lex order — matches the runner)
// ---------------------------------------------------------------------------

function findMigrationFiles(dir, phase) {
  const abs = resolve(ROOT, dir);
  // `abs` is a repo-internal migrations directory (default or --migrations-dir)
  // for this local-only operator CLI; no untrusted-input surface.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(abs)) {
    throw new Error(`Migrations dir not found: ${abs}`);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(abs)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({
      name: f,
      version: f.replace(/\.sql$/, ''),
      path: join(abs, f),
      phase,
    }));
}

function loadOnDiskMigrations(args) {
  const baseline = args.baselineDir
    ? findMigrationFiles(args.baselineDir, 'baseline')
    : [];
  const deltas = findMigrationFiles(args.migrationsDir, 'delta');
  // Baseline first, then deltas — identical to run-migrations.ts MIGRATION_PHASES.
  return [...baseline, ...deltas];
}

// ---------------------------------------------------------------------------
// Static hazard scan
// ---------------------------------------------------------------------------

/**
 * Strip SQL comments so commented-out DDL never trips a hazard flag.
 * Preserves newlines so statement boundaries survive.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/--[^\n]*/g, ''); // line comments
}

/**
 * Classify a single migration's SQL into a list of hazard findings.
 * Each finding: { code, severity, detail }. Severity is one of
 * 'window' | 'danger'. A file with zero findings is SAFE.
 *
 * Pure + regex-only (no DB). The regexes are anchored and bounded;
 * none can catastrophically backtrack on large files.
 */
function scanHazards(rawSql) {
  const sql = stripSqlComments(rawSql);
  const findings = [];

  // --- non-CONCURRENT CREATE INDEX (count them) ---------------------------
  // Every CREATE INDEX, then subtract the CONCURRENTLY ones. A plain
  // CREATE INDEX takes an ACCESS EXCLUSIVE-equivalent (a SHARE lock that
  // blocks writes) on the table for the build duration.
  const allIdx = (sql.match(/\bcreate\s+(?:unique\s+)?index\b/gi) || []).length;
  const concurrentIdx = (
    sql.match(/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/gi) || []
  ).length;
  const nonConcurrentIdx = allIdx - concurrentIdx;
  if (nonConcurrentIdx > 0) {
    findings.push({
      code: 'NON_CONCURRENT_INDEX',
      severity: 'window',
      detail:
        `${nonConcurrentIdx} non-CONCURRENT CREATE INDEX — each blocks writes ` +
        `on its table while building`,
    });
  }

  // --- ALTER … ADD COLUMN … NOT NULL without DEFAULT (DANGER) --------------
  // Match a SINGLE `ADD COLUMN <name> <body>` clause whose body runs only up
  // to the next `;` or `,` (so it never spans into a later statement's CHECK
  // / partial-index predicate). The body must NOT contain another ADD/ALTER
  // keyword. We then strip `IS NOT NULL` / `IS NOT` predicates before testing
  // for a constraint NOT NULL — `... closed_at IS NOT NULL ...` in a CHECK is
  // a predicate, not a column constraint, and must not false-trip.
  const addColRe =
    /\badd\s+column\b(?:\s+if\s+not\s+exists\b)?\s+(?:"[^"]+"|\w+)\s+([^;,]*)/gi;
  let acm;
  let addColNoDefault = 0;
  while ((acm = addColRe.exec(sql)) !== null) {
    const body = (acm[1] || '')
      // Kill predicate forms so only a constraint NOT NULL remains.
      .replace(/\bis\s+not\s+null\b/gi, '')
      .replace(/\bis\s+not\b/gi, '');
    // A second column-defining keyword means we ran past the column body —
    // bail to avoid spanning constraints from a multi-clause ALTER.
    if (/\b(?:add|alter|drop)\s+(?:column|constraint)\b/i.test(body)) continue;
    const hasNotNull = /\bnot\s+null\b/i.test(body);
    const hasDefault = /\bdefault\b/i.test(body);
    if (hasNotNull && !hasDefault) addColNoDefault += 1;
  }
  if (addColNoDefault > 0) {
    findings.push({
      code: 'ADD_COLUMN_NOT_NULL_NO_DEFAULT',
      severity: 'danger',
      detail:
        `${addColNoDefault} ADD COLUMN … NOT NULL without DEFAULT — table ` +
        `rewrite + fails outright if the table already has rows`,
    });
  }

  // --- ALTER … ALTER COLUMN … SET NOT NULL (NEEDS-WINDOW) ------------------
  const setNotNull = (
    sql.match(/\balter\s+column\b[\s\S]{0,80}?\bset\s+not\s+null\b/gi) || []
  ).length;
  if (setNotNull > 0) {
    findings.push({
      code: 'SET_NOT_NULL',
      severity: 'window',
      detail:
        `${setNotNull} SET NOT NULL on an existing column — full table scan ` +
        `under ACCESS EXCLUSIVE`,
    });
  }

  // --- ALTER COLUMN … TYPE … (NEEDS-WINDOW, table rewrite) -----------------
  const alterType = (
    sql.match(/\balter\s+column\b[\s\S]{0,120}?\btype\s+/gi) || []
  ).length;
  if (alterType > 0) {
    findings.push({
      code: 'ALTER_COLUMN_TYPE',
      severity: 'window',
      detail:
        `${alterType} ALTER COLUMN … TYPE — table rewrite under ACCESS ` +
        `EXCLUSIVE`,
    });
  }

  // --- ALTER TYPE … ADD VALUE (enum mutation, NEEDS-WINDOW) ----------------
  const enumAdd = (
    sql.match(/\balter\s+type\b[\s\S]{0,120}?\badd\s+value\b/gi) || []
  ).length;
  if (enumAdd > 0) {
    findings.push({
      code: 'ALTER_TYPE_ADD_VALUE',
      severity: 'window',
      detail:
        `${enumAdd} ALTER TYPE … ADD VALUE — enum mutation; on older PG it ` +
        `cannot run inside a multi-statement transaction`,
    });
  }

  // --- DROP TABLE / COLUMN / INDEX / CONSTRAINT / TYPE (DANGER) ------------
  // DROP INDEX CONCURRENTLY is the online-safe variant — exclude it.
  const dropTable = (sql.match(/\bdrop\s+table\b/gi) || []).length;
  const dropColumn = (sql.match(/\bdrop\s+column\b/gi) || []).length;
  const dropIndexAll = (sql.match(/\bdrop\s+index\b/gi) || []).length;
  const dropIndexConcurrent = (
    sql.match(/\bdrop\s+index\s+concurrently\b/gi) || []
  ).length;
  const dropIndex = dropIndexAll - dropIndexConcurrent;
  const dropConstraint = (sql.match(/\bdrop\s+constraint\b/gi) || []).length;
  const dropType = (sql.match(/\bdrop\s+type\b/gi) || []).length;
  const destructive =
    dropTable + dropColumn + dropIndex + dropConstraint + dropType;
  if (destructive > 0) {
    const parts = [];
    if (dropTable) parts.push(`${dropTable} DROP TABLE`);
    if (dropColumn) parts.push(`${dropColumn} DROP COLUMN`);
    if (dropIndex) parts.push(`${dropIndex} DROP INDEX (non-concurrent)`);
    if (dropConstraint) parts.push(`${dropConstraint} DROP CONSTRAINT`);
    if (dropType) parts.push(`${dropType} DROP TYPE`);
    findings.push({
      code: 'DESTRUCTIVE_DROP',
      severity: 'danger',
      detail:
        `${parts.join(', ')} — destructive + ACCESS EXCLUSIVE; irreversible ` +
        `without a restore`,
    });
  }

  return findings;
}

/**
 * Reduce a finding list to an overall classification.
 *   - any 'danger' finding  → DANGER
 *   - else any 'window'      → NEEDS-WINDOW
 *   - else                   → SAFE
 */
function classify(findings) {
  if (findings.some((f) => f.severity === 'danger')) return 'DANGER';
  if (findings.some((f) => f.severity === 'window')) return 'NEEDS-WINDOW';
  return 'SAFE';
}

// ---------------------------------------------------------------------------
// Live DB probe — READ-ONLY. Union of both ledger tables.
// ---------------------------------------------------------------------------

/**
 * Read the applied-migration set from whichever ledger(s) exist. Both
 * runners key by bare filename. Returns { applied:Set<string>, source }.
 * Throws on connection failure (caller honest-degrades).
 */
async function probeApplied(dbUrl) {
  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 15,
    onnotice: () => {},
  });
  try {
    // Sentinel probe FIRST: prove the connection is genuinely live before we
    // read the ledgers. The per-table reads below swallow "table absent"
    // errors, so without this a real connection failure (wrong host / creds /
    // DB) would masquerade as a reachable fresh DB ("everything pending"),
    // which would mislead the founder. A failing sentinel throws → the caller
    // honest-degrades to OFFLINE and labels the split UNVERIFIED.
    await sql`SELECT 1`;

    const applied = new Set();
    const sources = [];

    // drizzle.__drizzle_migrations.hash (run-migrations.ts).
    try {
      const rows = await sql`
        SELECT hash AS version FROM drizzle.__drizzle_migrations
      `;
      for (const r of rows) if (r.version) applied.add(String(r.version));
      sources.push('drizzle.__drizzle_migrations');
    } catch {
      // table absent — ignore.
    }

    // _migrations.version (scripts/migrate-prod.ts).
    try {
      const rows = await sql`SELECT version FROM _migrations`;
      for (const r of rows) if (r.version) applied.add(String(r.version));
      sources.push('_migrations');
    } catch {
      // table absent — ignore.
    }

    return {
      applied,
      source: sources.length > 0 ? sources.join(' + ') : 'none (fresh DB)',
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

function buildPlan(onDisk, appliedSet, connected) {
  const rows = onDisk.map((m) => {
    // `m.path` is a repo-internal migration file discovered above; no
    // untrusted-input surface for this local-only operator CLI.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sqlText = readFileSync(m.path, 'utf8');
    const findings = scanHazards(sqlText);
    const classification = classify(findings);
    // When connected we KNOW the applied set; offline we cannot, so every
    // file is reported as status 'unknown' (treat as potentially pending).
    const applied = connected ? appliedSet.has(m.version) : false;
    const status = !connected ? 'unknown' : applied ? 'applied' : 'pending';
    return { ...m, findings, classification, status };
  });

  const pending = rows.filter((r) => r.status !== 'applied');
  return { rows, pending };
}

const APPLY_COMMAND =
  'pnpm -C packages/database db:migrate   # forward-only, baseline-first, ledger-tracked';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMarkdown(plan, ctx) {
  const { connected, source, dbHost } = ctx;
  const total = plan.rows.length;
  const appliedCount = plan.rows.filter((r) => r.status === 'applied').length;
  const pending = plan.pending;

  const safe = pending.filter((r) => r.classification === 'SAFE');
  const window = pending.filter((r) => r.classification === 'NEEDS-WINDOW');
  const danger = pending.filter((r) => r.classification === 'DANGER');

  const lines = [];
  lines.push('# Migration Drift Dry-Run + Safe-Apply Plan');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Target DB:** ${dbHost}`);
  if (connected) {
    lines.push(`**Ledger source:** ${source}`);
    lines.push(`**On-disk migrations:** ${total}`);
    lines.push(`**Already applied:** ${appliedCount}`);
    lines.push(`**PENDING (the delta):** ${pending.length}`);
  } else {
    lines.push('**Ledger source:** UNREACHABLE — applied/pending split is UNVERIFIED.');
    lines.push(`**On-disk migrations:** ${total} (all shown as potentially-pending)`);
  }
  lines.push('');
  lines.push(
    '> READ-ONLY dry-run. Nothing was written to the target database. ' +
      'Review the plan, choose a maintenance window, then run the apply command below.',
  );
  lines.push('');

  if (pending.length === 0 && connected) {
    lines.push('## Up to date');
    lines.push('');
    lines.push('No pending migrations. The target DB matches the on-disk chain.');
    lines.push('');
    return lines.join('\n');
  }

  // --- Pending classification summary ---
  lines.push('## Pending migrations by risk');
  lines.push('');
  lines.push(`- ONLINE-SAFE: ${safe.length}`);
  lines.push(`- NEEDS-WINDOW: ${window.length}`);
  lines.push(`- DANGER: ${danger.length}`);
  lines.push('');

  // --- Per-migration table ---
  lines.push('## Per-migration analysis (apply order)');
  lines.push('');
  lines.push('| # | Migration | Phase | Class | Hazards |');
  lines.push('|---|-----------|-------|-------|---------|');
  pending.forEach((r, i) => {
    const haz =
      r.findings.length === 0
        ? '—'
        : r.findings.map((f) => f.code).join(', ');
    lines.push(
      `| ${i + 1} | ${r.name} | ${r.phase} | ${r.classification} | ${haz} |`,
    );
  });
  lines.push('');

  // --- Detailed hazard notes for anything that needs attention ---
  const flagged = pending.filter((r) => r.findings.length > 0);
  if (flagged.length > 0) {
    lines.push('## Hazard detail');
    lines.push('');
    for (const r of flagged) {
      lines.push(`### ${r.name} — ${r.classification}`);
      lines.push('');
      for (const f of r.findings) {
        lines.push(`- **${f.code}** (${f.severity}): ${f.detail}`);
      }
      lines.push('');
    }
  }

  // --- The maintenance-window apply plan ---
  lines.push('## Maintenance-window apply plan');
  lines.push('');
  lines.push(
    'The runner is forward-only and applies in lex (== numeric) order, ' +
      'baseline-first. It is a SINGLE command — it walks the whole pending ' +
      'set in order. The split below tells you WHAT that single run will do, ' +
      'so you can size the window.',
  );
  lines.push('');

  if (safe.length > 0) {
    lines.push('### Phase 1 — ONLINE-SAFE (no table-write blocking expected)');
    lines.push('');
    for (const r of safe) lines.push(`- ${r.name}`);
    lines.push('');
  }
  if (window.length > 0) {
    lines.push('### Phase 2 — NEEDS A WINDOW (write-blocking locks)');
    lines.push('');
    lines.push(
      'Apply these inside the maintenance window. Each takes a lock that ' +
        'blocks writes on its table(s) for the duration:',
    );
    lines.push('');
    for (const r of window) {
      const note = r.findings.map((f) => f.detail).join('; ');
      lines.push(`- **${r.name}** — ${note}`);
    }
    lines.push('');
  }
  if (danger.length > 0) {
    lines.push('### Phase 3 — DANGER (destructive / rewrite — review before applying)');
    lines.push('');
    lines.push(
      'These are destructive or full-rewrite. Confirm a fresh backup exists ' +
        'and review each before the window:',
    );
    lines.push('');
    for (const r of danger) {
      const note = r.findings.map((f) => f.detail).join('; ');
      lines.push(`- **${r.name}** — ${note}`);
    }
    lines.push('');
  }

  // --- Risk estimate / index storm callout ---
  const idxStorm = pending
    .map((r) => ({
      name: r.name,
      f: r.findings.find((x) => x.code === 'NON_CONCURRENT_INDEX'),
    }))
    .filter((x) => x.f);
  if (idxStorm.length > 0) {
    lines.push('## Index-storm risk note');
    lines.push('');
    lines.push(
      'One or more pending migrations build many indexes non-concurrently. ' +
        'Index builds hold a write-blocking lock on each target table; a large ' +
        'batch can extend the window substantially:',
    );
    lines.push('');
    for (const x of idxStorm) lines.push(`- **${x.name}** — ${x.f.detail}`);
    lines.push('');
  }

  // --- The exact apply command ---
  lines.push('## Apply command (run inside the chosen window)');
  lines.push('');
  lines.push('```bash');
  lines.push(`DATABASE_URL=<your-live-url> ${APPLY_COMMAND}`);
  lines.push('```');
  lines.push('');
  lines.push(
    'After applying, re-run this dry-run to confirm PENDING is 0, and run ' +
      '`pnpm verify:migrations` to confirm no ledger/relation drift.',
  );
  lines.push('');

  return lines.join('\n');
}

function renderJson(plan, ctx) {
  const pending = plan.pending.map((r) => ({
    name: r.name,
    version: r.version,
    phase: r.phase,
    status: r.status,
    classification: r.classification,
    findings: r.findings,
  }));
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      connected: ctx.connected,
      ledgerSource: ctx.source,
      target: ctx.dbHost,
      total: plan.rows.length,
      applied: plan.rows.filter((r) => r.status === 'applied').length,
      pendingCount: plan.pending.length,
      summary: {
        safe: plan.pending.filter((r) => r.classification === 'SAFE').length,
        needsWindow: plan.pending.filter(
          (r) => r.classification === 'NEEDS-WINDOW',
        ).length,
        danger: plan.pending.filter((r) => r.classification === 'DANGER')
          .length,
      },
      applyCommand: APPLY_COMMAND,
      pending,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Redact a connection string down to host/db for display (never log creds).
// ---------------------------------------------------------------------------

function describeTarget(dbUrl) {
  if (!dbUrl) return '(none)';
  try {
    const u = new URL(dbUrl);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `${u.hostname}:${u.port || '5432'}/${db}`;
  } catch {
    return '(unparseable URL — redacted)';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let onDisk;
  try {
    onDisk = loadOnDiskMigrations(args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }

  const dbHost = describeTarget(args.dbUrl);

  let appliedSet = new Set();
  let connected = false;
  let source = 'none';

  if (!args.dbUrl) {
    // eslint-disable-next-line no-console
    console.error(
      'WARNING: no --db-url / $DATABASE_URL provided — running OFFLINE ' +
        '(static hazard analysis only; applied/pending split is unverified).',
    );
  } else {
    try {
      const probe = await probeApplied(args.dbUrl);
      appliedSet = probe.applied;
      source = probe.source;
      connected = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `WARNING: could not connect to target DB (${dbHost}): ${err.message}\n` +
          '         Degrading to OFFLINE static analysis — applied/pending split ' +
          'is unverified.',
      );
    }
  }

  const plan = buildPlan(onDisk, appliedSet, connected);
  const ctx = { connected, source, dbHost };

  const output = args.json
    ? renderJson(plan, ctx)
    : renderMarkdown(plan, ctx);

  // eslint-disable-next-line no-console
  console.log(output);

  if (args.report) {
    const reportAbs = resolve(ROOT, args.report);
    // `reportAbs` is an operator-supplied --report path for this local-only
    // CLI; no untrusted-input surface.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(dirname(reportAbs), { recursive: true });
    // Always write markdown to the report file even in --json mode.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(
      reportAbs,
      args.json ? renderMarkdown(plan, ctx) : output,
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.error(`\nReport written to ${args.report}`);
  }

  // Pending work is the normal state; only harness failure is non-zero.
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`Harness error: ${err.message}`);
  process.exit(2);
});
