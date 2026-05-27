/**
 * Pure helpers for provision-dev-tenant + seed-demo-data.
 *
 * No side effects, no Postgres, no network. Keeping these in their own
 * module lets the tests exercise CLI parsers, request-body builders, and
 * the deterministic demo-data plan without standing up Supabase or a DB.
 *
 * Two CLI surfaces live here:
 *   - parseProvisionDevArgs — drives provision-dev-tenant.ts
 *   - parseSeedDemoArgs     — drives seed-demo-data.ts
 *
 * The demo-data plan (sites + workers + parcels + buyers + bids +
 * incidents + documents) is exported as a pure builder so tests can
 * snapshot it without running the script.
 */

// ─── Shared errors ────────────────────────────────────────────────────

export class ProvisionDevValidationError extends Error {
  override readonly name = 'ProvisionDevValidationError';
}

export class SeedDemoValidationError extends Error {
  override readonly name = 'SeedDemoValidationError';
}

// ─── Wire-level constants (mirrors /orgs/signup) ──────────────────────

export const COUNTRY_CODES = ['TZ', 'KE', 'UG', 'NG', 'OTHER'] as const;
export const CURRENCY_CODES = ['TZS', 'USD', 'KES', 'UGX', 'NGN'] as const;
export const LANGUAGE_CODES = ['sw', 'en'] as const;
export const ACCOUNT_KINDS = ['individual', 'business'] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

// ─── Country → currency / language defaults ──────────────────────────

const COUNTRY_CURRENCY: Readonly<Record<CountryCode, CurrencyCode>> = {
  TZ: 'TZS',
  KE: 'KES',
  UG: 'UGX',
  NG: 'NGN',
  OTHER: 'USD',
};

const COUNTRY_LANGUAGE: Readonly<Record<CountryCode, LanguageCode>> = {
  TZ: 'sw',
  KE: 'en',
  UG: 'en',
  NG: 'en',
  OTHER: 'en',
};

export function defaultCurrencyFor(country: CountryCode): CurrencyCode {
  return COUNTRY_CURRENCY[country];
}

export function defaultLanguageFor(country: CountryCode): LanguageCode {
  return COUNTRY_LANGUAGE[country];
}

// ─── Validation regexes ──────────────────────────────────────────────

const E164_PHONE = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEED_TAG = /^[a-z0-9][a-z0-9_-]{2,63}$/;

// ─── Generic argv parser ─────────────────────────────────────────────

function parseFlags(argv: readonly string[]): Map<string, string | boolean> {
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
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

// ─── provision-dev-tenant CLI ─────────────────────────────────────────

export interface ProvisionDevArgs {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly kind: AccountKind;
  readonly country: CountryCode;
  readonly currency: CurrencyCode;
  readonly language: LanguageCode;
  readonly businessRegistrationNumber: string;
  readonly taxId: string;
  readonly miningLicenceNumber?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export function parseProvisionDevArgs(
  argv: readonly string[],
): ProvisionDevArgs {
  const flags = parseFlags(argv);

  const name = String(flags.get('name') ?? '').trim();
  const email = String(flags.get('email') ?? '').trim().toLowerCase();
  const phone = String(flags.get('phone') ?? '').trim();
  const kindRaw = String(flags.get('kind') ?? 'business').trim().toLowerCase();
  const countryRaw = String(flags.get('country') ?? 'TZ').trim().toUpperCase();
  const dryRun = Boolean(flags.get('dry-run'));
  const json = Boolean(flags.get('json'));

  if (!name) {
    throw new ProvisionDevValidationError('--name is required');
  }
  if (name.length < 2 || name.length > 160) {
    throw new ProvisionDevValidationError(
      '--name must be 2..160 characters',
    );
  }
  if (!email || !EMAIL.test(email)) {
    throw new ProvisionDevValidationError(
      '--email must be a valid address (e.g. owner@acme.test)',
    );
  }
  if (!phone || !E164_PHONE.test(phone)) {
    throw new ProvisionDevValidationError(
      '--phone must be E.164 (e.g. +255700000000)',
    );
  }
  if (!ACCOUNT_KINDS.includes(kindRaw as AccountKind)) {
    throw new ProvisionDevValidationError(
      `--kind must be one of ${ACCOUNT_KINDS.join(', ')}; got "${kindRaw}"`,
    );
  }
  if (!COUNTRY_CODES.includes(countryRaw as CountryCode)) {
    throw new ProvisionDevValidationError(
      `--country must be one of ${COUNTRY_CODES.join(', ')}; got "${countryRaw}"`,
    );
  }
  const kind = kindRaw as AccountKind;
  const country = countryRaw as CountryCode;

  // Currency + language flags can override the country defaults but
  // we keep deterministic fallbacks for fully cold runs.
  const currencyRaw = String(flags.get('currency') ?? defaultCurrencyFor(country))
    .trim()
    .toUpperCase();
  if (!CURRENCY_CODES.includes(currencyRaw as CurrencyCode)) {
    throw new ProvisionDevValidationError(
      `--currency must be one of ${CURRENCY_CODES.join(', ')}; got "${currencyRaw}"`,
    );
  }
  const languageRaw = String(
    flags.get('language') ?? defaultLanguageFor(country),
  )
    .trim()
    .toLowerCase();
  if (!LANGUAGE_CODES.includes(languageRaw as LanguageCode)) {
    throw new ProvisionDevValidationError(
      `--language must be one of ${LANGUAGE_CODES.join(', ')}; got "${languageRaw}"`,
    );
  }

  // The signup endpoint requires business-registration-number + tax-id
  // when kind=business. We synthesise dev-only defaults so the CLI stays
  // ergonomic; real ops always pass explicit values via flags.
  const slugifiedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const businessRegistrationNumber = String(
    flags.get('business-reg') ?? `DEV-BRN-${slugifiedName || 'tenant'}`,
  ).trim();
  const taxId = String(
    flags.get('tax-id') ?? `DEV-TIN-${slugifiedName || 'tenant'}`,
  ).trim();
  const miningLicenceRaw = String(flags.get('mining-licence') ?? '').trim();

  const args: ProvisionDevArgs = {
    name,
    email,
    phone,
    kind,
    country,
    currency: currencyRaw as CurrencyCode,
    language: languageRaw as LanguageCode,
    businessRegistrationNumber,
    taxId,
    ...(miningLicenceRaw ? { miningLicenceNumber: miningLicenceRaw } : {}),
    dryRun,
    json,
  };
  return args;
}

// ─── /orgs/signup body builder ───────────────────────────────────────

export interface SignupBodyIndividual {
  readonly kind: 'individual';
  readonly country: CountryCode;
  readonly fullName: string;
  readonly phoneE164: string;
  readonly email: string;
  readonly defaultLanguage: LanguageCode;
  readonly primaryCurrency: CurrencyCode;
  readonly miningLicenceNumber?: string;
}

export interface SignupBodyBusiness {
  readonly kind: 'business';
  readonly country: CountryCode;
  readonly orgName: string;
  readonly businessRegistrationNumber: string;
  readonly taxId: string;
  readonly ownerEmail: string;
  readonly ownerFullName: string;
  readonly ownerPhoneE164: string;
  readonly defaultLanguage: LanguageCode;
  readonly primaryCurrency: CurrencyCode;
  readonly miningLicenceNumber?: string;
}

export type SignupBody = SignupBodyIndividual | SignupBodyBusiness;

export function buildSignupBody(args: ProvisionDevArgs): SignupBody {
  if (args.kind === 'individual') {
    const body: SignupBodyIndividual = {
      kind: 'individual',
      country: args.country,
      fullName: args.name,
      phoneE164: args.phone,
      email: args.email,
      defaultLanguage: args.language,
      primaryCurrency: args.currency,
      ...(args.miningLicenceNumber
        ? { miningLicenceNumber: args.miningLicenceNumber }
        : {}),
    };
    return body;
  }
  const body: SignupBodyBusiness = {
    kind: 'business',
    country: args.country,
    orgName: args.name,
    businessRegistrationNumber: args.businessRegistrationNumber,
    taxId: args.taxId,
    ownerEmail: args.email,
    ownerFullName: args.name,
    ownerPhoneE164: args.phone,
    defaultLanguage: args.language,
    primaryCurrency: args.currency,
    ...(args.miningLicenceNumber
      ? { miningLicenceNumber: args.miningLicenceNumber }
      : {}),
  };
  return body;
}

// ─── seed-demo-data CLI ──────────────────────────────────────────────

export interface SeedDemoArgs {
  readonly tenantId?: string;
  readonly phone?: string;
  readonly seedRunId: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export function parseSeedDemoArgs(argv: readonly string[]): SeedDemoArgs {
  const flags = parseFlags(argv);

  const tenantIdRaw = String(flags.get('tenant-id') ?? '').trim();
  const phoneRaw = String(flags.get('phone') ?? '').trim();
  const seedRunRaw = String(flags.get('seed-run-id') ?? '').trim().toLowerCase();
  const dryRun = Boolean(flags.get('dry-run'));
  const json = Boolean(flags.get('json'));

  if (!tenantIdRaw && !phoneRaw) {
    throw new SeedDemoValidationError(
      'one of --tenant-id or --phone is required',
    );
  }
  if (tenantIdRaw && !UUID.test(tenantIdRaw)) {
    throw new SeedDemoValidationError(
      `--tenant-id must be a UUID; got "${tenantIdRaw}"`,
    );
  }
  if (phoneRaw && !E164_PHONE.test(phoneRaw)) {
    throw new SeedDemoValidationError(
      `--phone must be E.164; got "${phoneRaw}"`,
    );
  }

  // Default seed-run id is stable per machine-day so re-runs on the
  // same machine produce the same tag (idempotent cleanup later).
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const defaultSeedRunId = `dev-seed-${today}`;
  const seedRunId = seedRunRaw || defaultSeedRunId;
  if (!SEED_TAG.test(seedRunId)) {
    throw new SeedDemoValidationError(
      `--seed-run-id must match ${SEED_TAG.source}; got "${seedRunId}"`,
    );
  }

  const args: SeedDemoArgs = {
    ...(tenantIdRaw ? { tenantId: tenantIdRaw } : {}),
    ...(phoneRaw ? { phone: phoneRaw } : {}),
    seedRunId,
    dryRun,
    json,
  };
  return args;
}

// ─── Demo data plan ──────────────────────────────────────────────────

export interface DemoSitePlan {
  readonly name: string;
  readonly mineral: string;
  readonly location: string;
  readonly phase: string;
  readonly licenceNumber: string;
  readonly licenceKind: 'PL' | 'PML' | 'ML' | 'SML';
}

export interface DemoWorkerPlan {
  readonly siteIndex: number;
  readonly fullName: string;
  readonly role: string;
  readonly phone: string;
}

export interface DemoOreParcelPlan {
  readonly siteIndex: number;
  readonly massKg: string;
  readonly storageLocation: string;
}

export interface DemoBuyerPlan {
  readonly name: string;
  readonly kind: 'broker' | 'refiner' | 'exporter';
}

export interface DemoBidPlan {
  readonly buyerIndex: number;
  readonly parcelIndex: number;
  readonly bidPriceTzs: number;
  readonly paymentTerms: 'instant' | 'net_30' | 'net_60';
}

export interface DemoIncidentPlan {
  readonly siteIndex: number;
  readonly kind: 'safety' | 'environmental' | 'near_miss';
  readonly severity: 'low' | 'medium' | 'high';
  readonly description: string;
}

export interface DemoDocumentPlan {
  readonly siteIndex: number;
  readonly title: string;
  readonly kind: string;
}

export interface DemoDataPlan {
  readonly sites: ReadonlyArray<DemoSitePlan>;
  readonly workers: ReadonlyArray<DemoWorkerPlan>;
  readonly oreParcels: ReadonlyArray<DemoOreParcelPlan>;
  readonly buyers: ReadonlyArray<DemoBuyerPlan>;
  readonly bids: ReadonlyArray<DemoBidPlan>;
  readonly incidents: ReadonlyArray<DemoIncidentPlan>;
  readonly documents: ReadonlyArray<DemoDocumentPlan>;
}

/**
 * Build the canonical demo plan. Pure — the script consumes this and
 * issues the HTTP calls. Counts match the brief: 3 sites, 5 workers
 * per site (15), 10 ore parcels, 3 buyers, bids per buyer, 2 daily
 * safety incidents, 5 documents.
 */
export function buildDemoDataPlan(): DemoDataPlan {
  const sites: ReadonlyArray<DemoSitePlan> = [
    {
      name: 'Geita Gold',
      mineral: 'gold',
      location: 'Geita Region, Tanzania',
      phase: 'extraction',
      licenceNumber: 'PML-GEITA-001',
      licenceKind: 'PML',
    },
    {
      name: 'Mwanza Cu',
      mineral: 'copper',
      location: 'Mwanza Region, Tanzania',
      phase: 'expansion',
      licenceNumber: 'ML-MWANZA-007',
      licenceKind: 'ML',
    },
    {
      name: 'Mererani Tanzanite',
      mineral: 'tanzanite',
      location: 'Mererani, Manyara, Tanzania',
      phase: 'sampling',
      licenceNumber: 'PML-MRR-013',
      licenceKind: 'PML',
    },
  ];

  // Five workers per site — deterministic phone numbers so repeats
  // converge instead of producing duplicates.
  const workerRoles = ['supervisor', 'driller', 'loader', 'driver', 'guard'];
  const workers: DemoWorkerPlan[] = [];
  for (let s = 0; s < sites.length; s += 1) {
    for (let w = 0; w < 5; w += 1) {
      const role = workerRoles[w] ?? 'general';
      workers.push({
        siteIndex: s,
        fullName: `Worker ${s + 1}-${w + 1} ${role}`,
        role,
        phone: `+2557${(50 + s).toString().padStart(2, '0')}${(100 + w * 11)
          .toString()
          .padStart(5, '0')}`,
      });
    }
  }

  // 10 ore parcels spread across the 3 sites — 4/3/3.
  const oreParcels: DemoOreParcelPlan[] = [];
  const parcelDistribution = [4, 3, 3];
  for (let s = 0; s < sites.length; s += 1) {
    const count = parcelDistribution[s] ?? 0;
    for (let p = 0; p < count; p += 1) {
      oreParcels.push({
        siteIndex: s,
        massKg: ((s + 1) * 1000 + p * 250).toString(),
        storageLocation: `${sites[s]?.name ?? 'site'} stockpile #${p + 1}`,
      });
    }
  }

  const buyers: ReadonlyArray<DemoBuyerPlan> = [
    { name: 'Songwe Refiners Ltd', kind: 'refiner' },
    { name: 'Pan-African Brokers', kind: 'broker' },
    { name: 'Indian Ocean Exports', kind: 'exporter' },
  ];

  // One bid per buyer on a rotating parcel — keeps the bid table
  // populated without over-fitting.
  const bids: DemoBidPlan[] = buyers.map((_, b) => ({
    buyerIndex: b,
    parcelIndex: b % oreParcels.length,
    bidPriceTzs: 12_500_000 + b * 1_750_000,
    paymentTerms: (['instant', 'net_30', 'net_60'] as const)[b] ?? 'instant',
  }));

  // Two safety incidents spread across the first two sites.
  const incidents: ReadonlyArray<DemoIncidentPlan> = [
    {
      siteIndex: 0,
      kind: 'safety',
      severity: 'medium',
      description: 'Minor slip near processing area — no injuries.',
    },
    {
      siteIndex: 1,
      kind: 'near_miss',
      severity: 'low',
      description: 'Loader near-miss with bowser at refuel point.',
    },
  ];

  // Five seed documents — one per site plus extras for legal + assay.
  const documents: ReadonlyArray<DemoDocumentPlan> = [
    { siteIndex: 0, title: 'Geita assay report Q1', kind: 'assay_report' },
    { siteIndex: 0, title: 'Geita licence renewal', kind: 'licence' },
    { siteIndex: 1, title: 'Mwanza ESIA addendum', kind: 'esia' },
    { siteIndex: 2, title: 'Mererani sample log', kind: 'sample_log' },
    {
      siteIndex: 2,
      title: 'Mererani community grievance log',
      kind: 'grievance_log',
    },
  ];

  return {
    sites,
    workers,
    oreParcels,
    buyers,
    bids,
    incidents,
    documents,
  };
}

// ─── Utility: stable seed attribute injection ────────────────────────

export function seedAttributes(
  seedRunId: string,
  extras: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...extras,
    seed_run_id: seedRunId,
    seeded_by: 'seed-demo-data-script',
  });
}
