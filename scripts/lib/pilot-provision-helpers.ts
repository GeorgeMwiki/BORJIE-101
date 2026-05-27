/**
 * Pure helpers for pilot-provision — no side effects, no Postgres, no
 * network. Keeping these in their own module lets the tests exercise
 * the CLI parser + validators without standing up Supabase or a DB.
 */

export interface PilotProvisionArgs {
  readonly phone: string;
  readonly tenantId: string;
  readonly cohort: string;
  readonly email?: string;
  readonly password?: string;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export class PilotProvisionValidationError extends Error {
  override readonly name = 'PilotProvisionValidationError';
}

const E164_PHONE = /^\+[1-9]\d{6,14}$/;
const COHORT_SLUG = /^[a-z][a-z0-9-]{1,62}$/;
const TENANT_ID = /^[A-Za-z0-9._-]{3,64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parsePilotProvisionArgs(
  argv: readonly string[],
): PilotProvisionArgs {
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

  const phone = String(flags.get('phone') ?? '').trim();
  const tenantId = String(flags.get('tenant') ?? '').trim();
  const cohort = String(flags.get('cohort') ?? '').trim().toLowerCase();
  const emailRaw = String(flags.get('email') ?? '').trim().toLowerCase();
  const passwordRaw = String(flags.get('password') ?? '').trim();
  const dryRun = Boolean(flags.get('dry-run'));
  const json = Boolean(flags.get('json'));

  if (!phone) {
    throw new PilotProvisionValidationError('--phone is required (E.164, e.g. +255712345678)');
  }
  if (!E164_PHONE.test(phone)) {
    throw new PilotProvisionValidationError(
      `--phone must be E.164 (e.g. +255712345678); got "${phone}"`,
    );
  }
  if (!tenantId) {
    throw new PilotProvisionValidationError('--tenant is required');
  }
  if (!TENANT_ID.test(tenantId)) {
    throw new PilotProvisionValidationError(
      `--tenant must match ${TENANT_ID.source}; got "${tenantId}"`,
    );
  }
  if (!cohort) {
    throw new PilotProvisionValidationError('--cohort is required');
  }
  if (!COHORT_SLUG.test(cohort)) {
    throw new PilotProvisionValidationError(
      `--cohort must be a lower-case slug (e.g. pilot-tz-may-2026); got "${cohort}"`,
    );
  }
  if (emailRaw && !EMAIL.test(emailRaw)) {
    throw new PilotProvisionValidationError(`--email must be a valid address; got "${emailRaw}"`);
  }

  const args: PilotProvisionArgs = {
    phone,
    tenantId,
    cohort,
    ...(emailRaw ? { email: emailRaw } : {}),
    ...(passwordRaw ? { password: passwordRaw } : {}),
    dryRun,
    json,
  };
  return args;
}
