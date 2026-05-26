#!/usr/bin/env node
/**
 * refresh-fx-rates.ts — refresh the `currency_rates` table.
 *
 * Two modes:
 *   --rates "USD=1.0,TZS=0.000395,KES=0.0077"  manual upsert (source = 'manual')
 *   --provider fixer-io                          provider mode (env-gated, stubbed)
 *
 * Output: per-rate diff line + a final summary.
 *
 * Usage:
 *   pnpm refresh-fx-rates --rates "USD=1.0,TZS=0.000395,KES=0.0077,EUR=1.08"
 *   pnpm refresh-fx-rates --provider fixer-io
 *   pnpm refresh-fx-rates --help
 *
 * Environment:
 *   DATABASE_URL          required (postgres connection string)
 *   FIXER_IO_API_KEY      required when --provider fixer-io is used
 *
 * Exit codes:
 *   0 — success (rates upserted or no changes)
 *   1 — fatal error (missing env, DB error, parse failure)
 *   2 — usage / validation error
 *
 * Schema (created by migration 0117):
 *   currency_rates(code TEXT PK, rate_to_usd DOUBLE PRECISION,
 *                  as_of TIMESTAMPTZ, source TEXT)
 */

import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// CLI parsing — small, hand-rolled. We deliberately do not pull commander/yargs.
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly help: boolean;
  readonly rates: string | null;
  readonly provider: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let help = false;
  let rates: string | null = null;
  let provider: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--rates') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new UsageError('--rates requires a value');
      }
      rates = next;
      i += 1;
      continue;
    }
    if (arg !== undefined && arg.startsWith('--rates=')) {
      rates = arg.slice('--rates='.length);
      continue;
    }
    if (arg === '--provider') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new UsageError('--provider requires a value');
      }
      provider = next;
      i += 1;
      continue;
    }
    if (arg !== undefined && arg.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
      continue;
    }
    throw new UsageError(`Unknown argument: ${arg ?? ''}`);
  }

  return { help, rates, provider };
}

class UsageError extends Error {
  readonly kind = 'usage' as const;
}

class ConfigError extends Error {
  readonly kind = 'config' as const;
}

// ---------------------------------------------------------------------------
// Help text.
// ---------------------------------------------------------------------------

const HELP_TEXT = `refresh-fx-rates — update currency_rates table

USAGE
  pnpm refresh-fx-rates --rates "USD=1.0,TZS=0.000395,KES=0.0077"
  pnpm refresh-fx-rates --provider fixer-io
  pnpm refresh-fx-rates --help

OPTIONS
  --rates <csv>      Manual upsert. CSV of CODE=RATE pairs. Source = 'manual'.
  --provider <name>  Provider mode (env-gated). Currently supports: fixer-io.
                     Requires FIXER_IO_API_KEY in env. Currently stubbed.
  --help, -h         Show this help.

ENVIRONMENT
  DATABASE_URL       required (postgres connection string)
  FIXER_IO_API_KEY   required when --provider fixer-io is used

NOTES
  - At least one of --rates or --provider must be provided.
  - All rates are stored as "1 unit of CODE = rate_to_usd USD".
  - On unchanged input the row is left alone (no-op upsert).
`;

// ---------------------------------------------------------------------------
// Rate parsing + validation.
// ---------------------------------------------------------------------------

export interface RateEntry {
  readonly code: string;
  readonly rateToUsd: number;
}

const ISO_4217_CODE = /^[A-Z]{3}$/;

export function parseRatesCsv(csv: string): RateEntry[] {
  const parts = csv
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    throw new UsageError('--rates value is empty');
  }

  const out: RateEntry[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0 || eq === part.length - 1) {
      throw new UsageError(`Bad rate pair: "${part}" (expected CODE=RATE)`);
    }
    const code = part.slice(0, eq).trim().toUpperCase();
    const rateStr = part.slice(eq + 1).trim();
    if (!ISO_4217_CODE.test(code)) {
      throw new UsageError(`Bad currency code: "${code}" (expected ISO-4217, 3 letters)`);
    }
    const rate = Number(rateStr);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new UsageError(`Bad rate for ${code}: "${rateStr}" (must be > 0)`);
    }
    if (seen.has(code)) {
      throw new UsageError(`Duplicate currency code: ${code}`);
    }
    seen.add(code);
    out.push({ code, rateToUsd: rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider stubs. Real network calls are intentionally NOT implemented yet —
// callers get a clear "PROVIDER_NOT_CONFIGURED" exit until a key is wired up.
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = ['fixer-io'] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

function isSupportedProvider(name: string): name is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

async function fetchProviderRates(
  provider: SupportedProvider,
): Promise<readonly RateEntry[]> {
  if (provider === 'fixer-io') {
    const key = process.env.FIXER_IO_API_KEY;
    if (key === undefined || key.length === 0) {
      throw new ConfigError(
        'PROVIDER_NOT_CONFIGURED: FIXER_IO_API_KEY is not set. ' +
          'Either set the env var or use --rates for a manual upsert.',
      );
    }
    // Follow-up (#33): fetch https://data.fixer.io/api/latest?access_key=<key>&base=USD
    // and convert to "1 unit of CODE = rateToUsd USD" form. Out of scope here.
    throw new ConfigError(
      'PROVIDER_NOT_CONFIGURED: fixer-io fetch is not implemented yet. ' +
        'Use --rates for a manual upsert until the provider is wired up.',
    );
  }
  // Exhaustive guard — the type system already prevents new providers from
  // landing here without an explicit branch.
  throw new ConfigError(`PROVIDER_NOT_CONFIGURED: unknown provider "${provider}"`);
}

// ---------------------------------------------------------------------------
// Database upsert.
// ---------------------------------------------------------------------------

export interface RateDiff {
  readonly code: string;
  readonly newRate: number;
  readonly previousRate: number | null;
  readonly previousSource: string | null;
  readonly source: string;
  readonly changed: boolean;
}

export interface RefreshResult {
  readonly diffs: readonly RateDiff[];
  readonly updatedCount: number;
}

interface ExistingRow {
  readonly code: string;
  readonly rate_to_usd: number;
  readonly source: string | null;
}

export async function upsertRates(
  sql: postgres.Sql<Record<string, unknown>>,
  rates: readonly RateEntry[],
  source: string,
): Promise<RefreshResult> {
  if (rates.length === 0) {
    return { diffs: [], updatedCount: 0 };
  }

  // Read existing rows for the codes we're about to write so we can produce
  // a per-row "was X / unchanged" diff line.
  const codes = rates.map((r) => r.code);
  const existing = await sql<ExistingRow[]>`
    SELECT code, rate_to_usd, source
      FROM currency_rates
     WHERE code IN ${sql(codes)}
  `;
  const byCode = new Map<string, ExistingRow>();
  for (const row of existing) {
    byCode.set(row.code, row);
  }

  const diffs: RateDiff[] = [];
  let updatedCount = 0;

  // Use a single transaction so partial refreshes can never leak.
  await sql.begin(async (tx) => {
    for (const r of rates) {
      const prev = byCode.get(r.code) ?? null;
      const previousRate = prev !== null ? Number(prev.rate_to_usd) : null;
      const previousSource = prev?.source ?? null;
      // Treat "unchanged" as "same numeric rate AND same source". A rate that
      // is bit-identical but coming from a new source is still a write.
      const sameRate =
        previousRate !== null && Number(previousRate) === Number(r.rateToUsd);
      const sameSource = previousSource === source;
      const changed = !(sameRate && sameSource);

      if (changed) {
        await tx`
          INSERT INTO currency_rates (code, rate_to_usd, source, as_of)
          VALUES (${r.code}, ${r.rateToUsd}, ${source}, NOW())
          ON CONFLICT (code) DO UPDATE
            SET rate_to_usd = EXCLUDED.rate_to_usd,
                source      = EXCLUDED.source,
                as_of       = EXCLUDED.as_of
        `;
        updatedCount += 1;
      }

      diffs.push({
        code: r.code,
        newRate: r.rateToUsd,
        previousRate,
        previousSource,
        source,
        changed,
      });
    }
  });

  return { diffs, updatedCount };
}

// ---------------------------------------------------------------------------
// Logging — kept tiny and side-effect-free so the unit test below can ignore.
// ---------------------------------------------------------------------------

function formatDiffLine(d: RateDiff): string {
  if (!d.changed) {
    return `${d.code}: unchanged`;
  }
  if (d.previousRate === null) {
    return `${d.code}: ${d.newRate} (new, source: ${d.source})`;
  }
  return (
    `${d.code}: ${d.newRate} (was ${d.previousRate}` +
    `${d.previousSource !== null ? `, prev source: ${d.previousSource}` : ''}` +
    `, source: ${d.source})`
  );
}

function formatSummary(result: RefreshResult): string {
  if (result.updatedCount === 0) {
    return 'no changes';
  }
  return `updated ${result.updatedCount} rate${result.updatedCount === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Resolve database URL — fail fast with a clear message if missing.
// ---------------------------------------------------------------------------

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new ConfigError('DATABASE_URL is not set');
  }
  return url;
}

// ---------------------------------------------------------------------------
// Main entrypoint.
// ---------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\n${HELP_TEXT}`);
      return 2;
    }
    throw err;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args.rates === null && args.provider === null) {
    process.stderr.write(
      'Either --rates or --provider must be provided.\n\n' + HELP_TEXT,
    );
    return 2;
  }

  if (args.rates !== null && args.provider !== null) {
    process.stderr.write(
      '--rates and --provider are mutually exclusive.\n\n' + HELP_TEXT,
    );
    return 2;
  }

  // Resolve work to do BEFORE we open a DB connection so we can fail fast
  // on missing env / bad input without a dangling pool.
  let rates: readonly RateEntry[];
  let source: string;
  try {
    if (args.rates !== null) {
      rates = parseRatesCsv(args.rates);
      source = 'manual';
    } else {
      const providerName = args.provider as string;
      if (!isSupportedProvider(providerName)) {
        process.stderr.write(
          `Unsupported provider: "${providerName}". Supported: ` +
            `${SUPPORTED_PROVIDERS.join(', ')}\n`,
        );
        return 2;
      }
      rates = await fetchProviderRates(providerName);
      source = providerName;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }

  let databaseUrl: string;
  try {
    databaseUrl = resolveDatabaseUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    return 1;
  }

  const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  try {
    const result = await upsertRates(sql, rates, source);
    for (const d of result.diffs) {
      process.stdout.write(`${formatDiffLine(d)}\n`);
    }
    process.stdout.write(`${formatSummary(result)}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refresh-fx-rates failed: ${msg}\n`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------
// CLI bootstrap.
// ---------------------------------------------------------------------------

// Detect "run as a CLI" robustly. Comparing `file://${argv[1]}` directly
// breaks on paths with spaces (the import.meta.url is percent-encoded but the
// argv value isn't), so route both through `pathToFileURL`.
const isCliEntry = (() => {
  if (typeof process === 'undefined' || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`refresh-fx-rates crashed: ${msg}\n`);
      process.exit(1);
    });
}
