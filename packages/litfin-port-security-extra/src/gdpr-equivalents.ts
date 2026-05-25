/**
 * Per-jurisdiction GDPR-equivalent helpers — Subject Access Request
 * (SAR) renderers and deadline calculators.
 *
 * LITFIN ref: src/core/privacy/* — handles GDPR, POPIA (ZA), KE Data
 * Protection Act, TZ Personal Data Protection Act, NDPR (NG).
 *
 * Computes statutory response deadline given the request received-at
 * timestamp and the jurisdiction. Includes business-day vs calendar-day
 * conventions per jurisdiction.
 */

import type { JurisdictionCode, UserId } from './types.js';

export interface SubjectAccessRequest {
  readonly subjectId: UserId;
  readonly receivedAtMs: number;
  readonly jurisdiction: JurisdictionCode;
  readonly requestType:
    | 'access'
    | 'erasure'
    | 'rectification'
    | 'restriction'
    | 'portability'
    | 'objection';
}

export interface SARDeadline {
  readonly jurisdiction: JurisdictionCode;
  readonly statutoryBasis: string;
  readonly deadlineMs: number;
  /** Days as published in statute. */
  readonly statutoryDays: number;
  readonly dayConvention: 'calendar' | 'business';
  /** Whether the regulator allows extension on complex requests. */
  readonly extensionAllowed: boolean;
  readonly extensionDays: number;
}

interface JurisdictionConfig {
  readonly basis: string;
  readonly days: number;
  readonly convention: 'calendar' | 'business';
  readonly extensionAllowed: boolean;
  readonly extensionDays: number;
}

const JURISDICTION_CONFIG: Readonly<Record<JurisdictionCode, JurisdictionConfig>> = {
  KE: {
    basis: 'Data Protection Act, 2019 — s.26 (Kenya)',
    days: 7,
    convention: 'business',
    extensionAllowed: false,
    extensionDays: 0,
  },
  TZ: {
    basis: 'Personal Data Protection Act, 2022 (Tanzania)',
    days: 14,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 14,
  },
  UG: {
    basis: 'Data Protection and Privacy Act, 2019 (Uganda)',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 30,
  },
  NG: {
    basis: 'Nigeria Data Protection Act, 2023',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 30,
  },
  ZA: {
    basis: 'Protection of Personal Information Act (POPIA) s.23 (South Africa)',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 30,
  },
  GH: {
    basis: 'Data Protection Act 843, 2012 (Ghana)',
    days: 14,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 14,
  },
  RW: {
    basis: 'Law No 058/2021 — data protection (Rwanda)',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 30,
  },
  EU: {
    basis: 'GDPR Art. 12(3)',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 60,
  },
  UK: {
    basis: 'UK GDPR Art. 12(3) / DPA 2018',
    days: 30,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 60,
  },
  US: {
    basis: 'CCPA s.1798.130 (California; other state laws vary)',
    days: 45,
    convention: 'calendar',
    extensionAllowed: true,
    extensionDays: 45,
  },
  OTHER: {
    basis: 'Default 30-calendar-day prudent baseline (no statute on file)',
    days: 30,
    convention: 'calendar',
    extensionAllowed: false,
    extensionDays: 0,
  },
};

const MS_PER_DAY = 86_400_000;

/** Skip weekends when calculating business days. Mon=1..Fri=5. */
const addBusinessDays = (startMs: number, n: number): number => {
  let ms = startMs;
  let added = 0;
  while (added < n) {
    ms += MS_PER_DAY;
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return ms;
};

export const computeDeadline = (req: SubjectAccessRequest): SARDeadline => {
  const cfg = JURISDICTION_CONFIG[req.jurisdiction];
  const deadlineMs =
    cfg.convention === 'business'
      ? addBusinessDays(req.receivedAtMs, cfg.days)
      : req.receivedAtMs + cfg.days * MS_PER_DAY;
  return {
    jurisdiction: req.jurisdiction,
    statutoryBasis: cfg.basis,
    deadlineMs,
    statutoryDays: cfg.days,
    dayConvention: cfg.convention,
    extensionAllowed: cfg.extensionAllowed,
    extensionDays: cfg.extensionDays,
  };
};

export const isOverdue = (deadline: SARDeadline, nowMs: number): boolean =>
  nowMs > deadline.deadlineMs;

export const hoursRemaining = (deadline: SARDeadline, nowMs: number): number =>
  (deadline.deadlineMs - nowMs) / (60 * 60 * 1000);

export const requiresDPIA = (req: SubjectAccessRequest): boolean =>
  req.requestType === 'erasure' || req.requestType === 'portability';
