/**
 * Mr. Mwikila handler — license-renewal reminders.
 *
 * Sees mining / health / safety licenses expiring in {90, 60, 30, 14,
 * 7, 3, 1} days → fires a reminder + drafts a renewal form. Default
 * tier T2 (act-with-reversal; the reminder is harmless and the form
 * is a draft).
 *
 * Pure-logic shape; the license + draft ports are injected.
 */

import type { MwikilaHandler, MwikilaHandlerProposal } from '../handler-runtime.js';

export interface LicenseRow {
  readonly id: string;
  readonly licenseKind: string;
  readonly licenseRef: string;
  readonly issuingAuthority: string;
  readonly expiresAt: string;
}

export interface LicenseRenewalPorts {
  listExpiringLicenses(args: {
    readonly tenantId: string;
    readonly windowDays: ReadonlyArray<number>;
    readonly nowIso: string;
  }): Promise<ReadonlyArray<LicenseRow>>;
  reminderAlreadyFired(args: {
    readonly tenantId: string;
    readonly licenseId: string;
    readonly windowDay: number;
  }): Promise<boolean>;
}

const DEFAULT_WINDOWS: ReadonlyArray<number> = [90, 60, 30, 14, 7, 3, 1];

export function pickClosestWindow(
  daysToExpiry: number,
  windows: ReadonlyArray<number>,
): number | null {
  const sorted = [...windows].sort((a, b) => a - b);
  for (const w of sorted) {
    if (daysToExpiry <= w) return w;
  }
  return null;
}

export function buildLicenseRenewalProposal(
  license: LicenseRow,
  windowDay: number,
  daysToExpiry: number,
): MwikilaHandlerProposal {
  return {
    actionKind: 'license.renewal_reminder',
    category: 'license-renewal-reminders',
    summary: `Reminder: ${license.licenseKind} (${license.licenseRef}) expires in ${daysToExpiry} days. Draft renewal form prepared.`,
    summarySw: `Kumbusho: leseni ${license.licenseKind} (${license.licenseRef}) inaisha siku ${daysToExpiry}. Rasimu ya fomu ya kuongeza muda imetayarishwa.`,
    rationale:
      `License is in the ${windowDay}-day pre-expiry window. ` +
      `Reminder fires once per window; a draft renewal form is attached ` +
      `to the inbox row for the owner to review.`,
    payload: {
      licenseId: license.id,
      licenseKind: license.licenseKind,
      licenseRef: license.licenseRef,
      issuingAuthority: license.issuingAuthority,
      expiresAt: license.expiresAt,
      windowDay,
      daysToExpiry,
    },
    amountTzs: 0,
    currency: 'TZS',
  };
}

export function createLicenseRenewalHandler(
  ports: LicenseRenewalPorts,
  windows: ReadonlyArray<number> = DEFAULT_WINDOWS,
): MwikilaHandler {
  return Object.freeze({
    actionKind: 'license.renewal_reminder',
    category: 'license-renewal-reminders',
    async propose({ tenantId, now }) {
      const expiring = await ports.listExpiringLicenses({
        tenantId,
        windowDays: windows,
        nowIso: now.toISOString(),
      });
      if (expiring.length === 0) return null;
      // Fire the most urgent one this tick.
      let urgent: { license: LicenseRow; windowDay: number; daysToExpiry: number } | null = null;
      for (const license of expiring) {
        const daysToExpiry = Math.ceil(
          (new Date(license.expiresAt).getTime() - now.getTime()) /
            86_400_000,
        );
        const windowDay = pickClosestWindow(daysToExpiry, windows);
        if (windowDay === null) continue;
        const fired = await ports.reminderAlreadyFired({
          tenantId,
          licenseId: license.id,
          windowDay,
        });
        if (fired) continue;
        if (urgent === null || daysToExpiry < urgent.daysToExpiry) {
          urgent = { license, windowDay, daysToExpiry };
        }
      }
      if (urgent === null) return null;
      return buildLicenseRenewalProposal(
        urgent.license,
        urgent.windowDay,
        urgent.daysToExpiry,
      );
    },
  });
}
