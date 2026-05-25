/**
 * Pure helpers for bootstrap-tenant — no side effects, no Postgres.
 *
 * Keeping these in their own module lets the tests exercise them without
 * spinning up a DB or importing `postgres` (which opens a socket at module
 * init in some configurations).
 */

export interface BootstrapArgs {
  readonly name: string;
  readonly countryCode: string;
  readonly adminEmail: string;
  readonly adminPhone: string;
  readonly slug: string;
  readonly withDemoData: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export class BootstrapValidationError extends Error {
  override readonly name = 'BootstrapValidationError';
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
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

  const name = String(flags.get('name') ?? '').trim();
  const countryCode = String(flags.get('country') ?? '').trim().toUpperCase();
  const adminEmail = String(flags.get('admin-email') ?? '').trim().toLowerCase();
  const adminPhone = String(flags.get('admin-phone') ?? '').trim();
  const explicitSlug = String(flags.get('slug') ?? '').trim().toLowerCase();
  const withDemoData = Boolean(flags.get('with-demo-data'));
  const dryRun = Boolean(flags.get('dry-run'));
  const json = Boolean(flags.get('json'));

  if (!name) throw new BootstrapValidationError('--name is required');
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new BootstrapValidationError('--country must be ISO-3166-1 alpha-2 (e.g. TZ)');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new BootstrapValidationError('--admin-email must be a valid email');
  }
  if (!adminPhone) throw new BootstrapValidationError('--admin-phone is required');

  const slug = explicitSlug || slugify(name);
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    throw new BootstrapValidationError(`Derived slug "${slug}" is invalid`);
  }
  return { name, countryCode, adminEmail, adminPhone, slug, withDemoData, dryRun, json };
}

/**
 * Country → currency lookup. Intentionally small — the full mapping lives
 * in @borjie/compliance-plugins, but this script runs before the
 * gateway is up and can't reach into workspace packages at the repo root.
 * Falls back to 'USD' for unknown codes; the gateway's plugin layer
 * overrides this during the first authenticated request.
 */
export function resolveCountryCurrency(countryCode: string): string {
  const map: Readonly<Record<string, string>> = {
    TZ: 'TZS', KE: 'KES', UG: 'UGX', NG: 'NGN', ZA: 'ZAR',
    US: 'USD', GB: 'GBP', EU: 'EUR', IN: 'INR', RW: 'RWF',
  };
  return map[countryCode.toUpperCase()] ?? 'USD';
}

/**
 * Next Monday at 08:00 UTC. If `from` is already Monday, rolls forward to
 * the *next* Monday so the first briefing never fires the same day.
 */
export function nextMondayAt8(from: Date): Date {
  const d = new Date(from.getTime());
  d.setUTCHours(8, 0, 0, 0);
  const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d;
}
