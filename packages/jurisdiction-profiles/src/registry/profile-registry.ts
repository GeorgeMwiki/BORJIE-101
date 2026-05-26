/**
 * Profile registry — pluggable in-process catalogue of jurisdiction
 * profiles. The composition root calls `registerProfile(tzProfile)` /
 * `registerProfiles(extras)` at bootstrap; everywhere else reads
 * through `findProfile(id)`. Adding a new jurisdiction = adding a new
 * package and one bootstrap call. No core edit.
 *
 * Pure data structure — no I/O. Persistence is the seed package's job
 * (see `seed-profiles.ts` for the SQL-ready row builder).
 *
 * Immutability: every mutating op returns a NEW Registry value (per
 * coding-style.md). Internally the registry is a frozen Map snapshot.
 */

import {
  type JurisdictionProfile,
  JurisdictionProfileSchema,
} from '../types.js';

export interface ProfileRegistry {
  readonly entries: ReadonlyMap<string, JurisdictionProfile>;
}

export function emptyProfileRegistry(): ProfileRegistry {
  return { entries: new Map<string, JurisdictionProfile>() };
}

/**
 * Register a single profile, returning a NEW registry. Throws if the
 * id already exists (registration is single-shot) or if the profile
 * fails zod validation.
 */
export function registerProfile(
  reg: ProfileRegistry,
  profile: JurisdictionProfile,
): ProfileRegistry {
  const parsed = JurisdictionProfileSchema.parse(profile);
  if (reg.entries.has(parsed.id)) {
    throw new Error(`profile_already_registered:${parsed.id}`);
  }
  const next = new Map(reg.entries);
  next.set(parsed.id, parsed);
  return { entries: next };
}

/**
 * Register many profiles in one call. Atomic — if ANY profile is
 * invalid or duplicates an existing id, the original registry is
 * returned unchanged and the error is thrown.
 */
export function registerProfiles(
  reg: ProfileRegistry,
  profiles: ReadonlyArray<JurisdictionProfile>,
): ProfileRegistry {
  let acc = reg;
  for (const p of profiles) {
    acc = registerProfile(acc, p);
  }
  return acc;
}

export function findProfile(
  reg: ProfileRegistry,
  id: string,
): JurisdictionProfile | undefined {
  return reg.entries.get(id);
}

export function requireProfile(
  reg: ProfileRegistry,
  id: string,
): JurisdictionProfile {
  const p = reg.entries.get(id);
  if (!p) {
    throw new Error(`profile_not_registered:${id}`);
  }
  return p;
}

export function listProfileIds(reg: ProfileRegistry): ReadonlyArray<string> {
  return Array.from(reg.entries.keys()).sort();
}

/**
 * Lookup by data-protection law id (e.g. `'gdpr'` → list of profiles
 * whose `data_protection_laws` contains `'gdpr'`).
 */
export function findProfilesByDataProtectionLaw(
  reg: ProfileRegistry,
  lawId: string,
): ReadonlyArray<JurisdictionProfile> {
  const out: JurisdictionProfile[] = [];
  for (const p of reg.entries.values()) {
    if (p.data_protection_laws.includes(lawId)) {
      out.push(p);
    }
  }
  return out;
}

export function findProfilesByLanguagePack(
  reg: ProfileRegistry,
  langCode: string,
): ReadonlyArray<JurisdictionProfile> {
  const out: JurisdictionProfile[] = [];
  for (const p of reg.entries.values()) {
    if (p.language_pack_codes.includes(langCode)) {
      out.push(p);
    }
  }
  return out;
}

export function findProfilesByResidencyKind(
  reg: ProfileRegistry,
  kind: JurisdictionProfile['data_residency_kind'],
): ReadonlyArray<JurisdictionProfile> {
  const out: JurisdictionProfile[] = [];
  for (const p of reg.entries.values()) {
    if (p.data_residency_kind === kind) {
      out.push(p);
    }
  }
  return out;
}
