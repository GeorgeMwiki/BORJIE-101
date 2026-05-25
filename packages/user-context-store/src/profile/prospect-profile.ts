/**
 * Prospect-role profile builder.
 *
 * Prospects are pre-lease leads. Their dossier blends search history,
 * property views, saved listings, and a lead-quality score. Primary
 * source is `marketing_leads`, with optional enrichments from
 * `property_views` / `saved_listings` (if present).
 */
import type { IdentityFacts, ProspectProfile } from '../types.js';

export interface BuildProspectProfileArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly db: unknown;
}

interface DrizzleLike {
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickDate(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

async function loadIdentity(
  db: DrizzleLike,
  args: BuildProspectProfileArgs,
): Promise<IdentityFacts> {
  const fallback: IdentityFacts = {
    userId: args.userId,
    tenantId: args.tenantId,
  };
  // Prospects may live in users OR marketing_leads.
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return fallback;
    const userResult = await exec({
      sql: 'SELECT * FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      params: [args.userId, args.tenantId],
    });
    let row: Record<string, unknown> | undefined = userResult.rows[0];
    if (!row) {
      const leadResult = await exec({
        sql: `SELECT * FROM marketing_leads WHERE id = $1 LIMIT 1`,
        params: [args.userId],
      });
      row = leadResult.rows[0];
    }
    if (!row) return fallback;
    const id: IdentityFacts = {
      userId: args.userId,
      tenantId: args.tenantId,
    };
    const email = pickString(row, 'email', 'contact_value');
    if (email) id.email = email;
    const phone = pickString(row, 'phone');
    if (phone) id.phone = phone;
    const firstName = pickString(row, 'first_name', 'contact_name');
    if (firstName) id.firstName = firstName;
    const lastName = pickString(row, 'last_name');
    if (lastName) id.lastName = lastName;
    return id;
  }, fallback);
}

async function loadSearches(
  db: DrizzleLike,
  args: BuildProspectProfileArgs,
): Promise<ReadonlyArray<{ query: string; timestamp: string }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT query, created_at AS ts
        FROM prospect_searches
        WHERE tenant_id = $1 AND prospect_id = $2
        ORDER BY created_at DESC
        LIMIT 50
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => ({
      query: String(row['query'] ?? ''),
      timestamp: pickDate(row, 'ts') ?? new Date(0).toISOString(),
    }));
  }, undefined);
}

async function loadViews(
  db: DrizzleLike,
  args: BuildProspectProfileArgs,
): Promise<ReadonlyArray<{ propertyId: string; viewedAt: string }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT property_id, viewed_at
        FROM property_views
        WHERE tenant_id = $1 AND prospect_id = $2
        ORDER BY viewed_at DESC
        LIMIT 100
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => ({
      propertyId: String(row['property_id']),
      viewedAt: pickDate(row, 'viewed_at') ?? new Date(0).toISOString(),
    }));
  }, undefined);
}

async function loadSavedListings(
  db: DrizzleLike,
  args: BuildProspectProfileArgs,
): Promise<ReadonlyArray<{ propertyId: string; savedAt: string }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT property_id, saved_at
        FROM saved_listings
        WHERE tenant_id = $1 AND prospect_id = $2
        ORDER BY saved_at DESC
        LIMIT 100
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => ({
      propertyId: String(row['property_id']),
      savedAt: pickDate(row, 'saved_at') ?? new Date(0).toISOString(),
    }));
  }, undefined);
}

async function loadLeadQuality(
  db: DrizzleLike,
  args: BuildProspectProfileArgs,
): Promise<ProspectProfile['leadQuality'] | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT turn_count, explicit_signup_intent, primary_pain
        FROM marketing_leads
        WHERE id = $1 LIMIT 1
      `,
      params: [args.userId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const turnCount = pickNumber(row, 'turn_count') ?? 0;
    const explicit = row['explicit_signup_intent'] === true;
    const score = Math.min(100, turnCount * 10 + (explicit ? 40 : 0));
    const band: 'cold' | 'warm' | 'hot' =
      score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
    const quality: NonNullable<ProspectProfile['leadQuality']> = { score, band };
    const pain = pickString(row, 'primary_pain');
    if (pain) quality.primaryPain = pain;
    return quality;
  }, undefined);
}

/**
 * Build a {@link ProspectProfile} dossier.
 */
export async function buildProspectProfile(
  args: BuildProspectProfileArgs,
): Promise<ProspectProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const searches = await loadSearches(db, args);
  const propertiesViewed = await loadViews(db, args);
  const savedListings = await loadSavedListings(db, args);
  const leadQuality = await loadLeadQuality(db, args);

  const profile: ProspectProfile = { identity };
  if (searches) profile.searches = searches;
  if (propertiesViewed) profile.propertiesViewed = propertiesViewed;
  if (savedListings) profile.savedListings = savedListings;
  if (leadQuality) profile.leadQuality = leadQuality;
  return profile;
}
