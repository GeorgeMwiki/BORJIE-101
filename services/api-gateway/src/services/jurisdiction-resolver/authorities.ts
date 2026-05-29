/**
 * Per-jurisdiction named authorities — JA-1.
 *
 * Sourced from #207's seed (PCCB/NEMC/EITI/TMAA for TZ + the 7
 * other jurisdictions) and frozen here so the resolver can answer
 * synchronously when the regulator_jurisdictions DB lookup is
 * unavailable (tests, degraded mode, brain-teach prompt injection
 * on the critical path).
 *
 * This is a STATIC SNAPSHOT — the canonical source of truth at
 * runtime is `regulator_jurisdictions`. Disagreements between the
 * two are detectable via tests + the WS-3 regulator lookup. The
 * snapshot exists so prompt construction never blocks on a DB hit.
 */

import type { JurisdictionAuthorities } from './types.js';

interface AuthoritiesEntry extends JurisdictionAuthorities {
  readonly countryCode: string;
  readonly countryName: string;
}

const FALLBACK_AUTHORITIES: AuthoritiesEntry = Object.freeze({
  countryCode: 'TZ',
  countryName: 'Tanzania',
  mineralAuthority: 'PCCB',
  environmentalAuthority: 'NEMC',
  transparencyInitiative: 'EITI',
  auditAuthority: 'TMAA',
});

export const JURISDICTION_AUTHORITIES: ReadonlyArray<AuthoritiesEntry> =
  Object.freeze([
    Object.freeze({
      countryCode: 'TZ',
      countryName: 'Tanzania',
      mineralAuthority: 'PCCB',
      environmentalAuthority: 'NEMC',
      transparencyInitiative: 'EITI',
      auditAuthority: 'TMAA',
    }),
    Object.freeze({
      countryCode: 'KE',
      countryName: 'Kenya',
      mineralAuthority: 'State Department of Mining',
      environmentalAuthority: 'NEMA-KE',
      transparencyInitiative: 'EITI',
      auditAuthority: 'OAG-KE',
    }),
    Object.freeze({
      countryCode: 'UG',
      countryName: 'Uganda',
      mineralAuthority: 'Directorate of Geological Survey and Mines',
      environmentalAuthority: 'NEMA-UG',
      transparencyInitiative: 'EITI',
      auditAuthority: 'OAG-UG',
    }),
    Object.freeze({
      countryCode: 'NG',
      countryName: 'Nigeria',
      mineralAuthority: 'Mining Cadastre Office',
      environmentalAuthority: 'NESREA',
      transparencyInitiative: 'NEITI',
      auditAuthority: 'OAuGF',
    }),
    Object.freeze({
      countryCode: 'ZA',
      countryName: 'South Africa',
      mineralAuthority: 'Department of Mineral Resources and Energy',
      environmentalAuthority: 'DFFE',
      transparencyInitiative: 'EITI-aspirant',
      auditAuthority: 'AGSA',
    }),
    Object.freeze({
      countryCode: 'AU',
      countryName: 'Australia',
      mineralAuthority: 'State Mining Authorities (DMIRS WA / DRDMW QLD / NSW DPI)',
      environmentalAuthority: 'DCCEEW',
      transparencyInitiative: 'EITI',
      auditAuthority: 'ANAO',
    }),
    Object.freeze({
      countryCode: 'CL',
      countryName: 'Chile',
      mineralAuthority: 'Sernageomin',
      environmentalAuthority: 'SMA',
      transparencyInitiative: 'EITI',
      auditAuthority: 'CGR',
    }),
    Object.freeze({
      countryCode: 'ID',
      countryName: 'Indonesia',
      mineralAuthority: 'ESDM (Ministry of Energy and Mineral Resources)',
      environmentalAuthority: 'KLHK',
      transparencyInitiative: 'EITI',
      auditAuthority: 'BPK',
    }),
  ]);

/**
 * Look up the authorities snapshot for a country code. Returns the
 * TZ fallback when the country is not seeded — callers can detect
 * this via the source field on `ResolvedJurisdiction` ('unseeded').
 */
export function getAuthoritiesByCountry(
  countryCode: string,
): AuthoritiesEntry | null {
  const match = JURISDICTION_AUTHORITIES.find(
    (a) => a.countryCode === countryCode,
  );
  return match ?? null;
}

/**
 * Returns the TZ fallback — exposed so the resolver can render an
 * "unseeded" snapshot using TZ structure with the requested country
 * code stamped on top.
 */
export function getFallbackAuthorities(): AuthoritiesEntry {
  return FALLBACK_AUTHORITIES;
}
