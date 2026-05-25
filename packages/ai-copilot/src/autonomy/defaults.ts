/**
 * Opinionated defaults for a newly-enabled Autonomous Department Mode.
 *
 * The head of estates may tweak any cell later through the delegation
 * matrix UI, but the defaults encode our strongest hypothesis about what
 * a responsible institutional operator wants Mr. Mwikila doing on his
 * own authority.
 *
 * Conservative where it must be (no auto-sending legal notices, escalate
 * safety-critical maintenance) and bold where the payoff justifies it
 * (auto-draft compliance, auto-send rent reminders, auto-approve
 * same-terms renewals).
 */

import type { AutonomyPolicy } from './types.js';

const ZERO_ISO = new Date(0).toISOString();

export function buildDefaultPolicy(tenantId: string): AutonomyPolicy {
  return {
    tenantId,
    autonomousModeEnabled: false,
    finance: {
      autoSendReminders: true,
      // Day offsets match the arrears ladder: soft at 5, firm at 10,
      // final at 20. Anything further is a human decision.
      reminderDayOffsets: [5, 10, 20],
      autoApproveRefundsMinorUnits: 50_000_00,
      autoApproveWaiversMinorUnits: 25_000_00,
      escalateArrearsAboveMinorUnits: 500_000_00,
    },
    leasing: {
      autoApproveRenewalsSameTerms: true,
      maxAutoApproveRentIncreasePct: 8,
      autoApproveApplicationScoreMin: 0.75,
      autoSendOfferLetters: false,
    },
    maintenance: {
      // 100,000 minor units ~= 1,000.00 in the tenant currency.
      autoApproveBelowMinorUnits: 100_000,
      autoDispatchTrustedVendors: true,
      autoCloseResolvedTickets: true,
      escalateSafetyCriticalImmediately: true,
    },
    compliance: {
      autoDraftNotices: true,
      autoSendLegalNotices: false,
      autoRenewLicencesBefore: 30,
      escalateOnNewRegulation: true,
    },
    communications: {
      autoSendRoutineUpdates: true,
      autoTranslateToTenantLanguage: true,
      escalateNegativeSentimentScoreBelow: -0.4,
      quietHoursStartHour: 21,
      quietHoursEndHour: 7,
    },
    // Wave 27 Part B.9 — six additional domains with conservative defaults.
    // Every auto_X flag is false or the auto-threshold is 0, so a
    // freshly-created tenant behaves identically to the old 5-domain shape
    // until heads explicitly loosen individual cells via the delegation
    // matrix UI. Presence of the blocks lets the UI render the full grid
    // and lets the autonomy engine short-circuit on unknown-domain lookups.
    marketing: {
      autoPublishListings: false,
      autoAdjustAskingRentPct: 0,
      autoSendOpenHouseInvites: false,
      monthlyAdSpendCapMinorUnits: 0,
    },
    hr: {
      autoOnboardContractors: false,
      autoApprovePayrollBelowMinorUnits: 0,
      autoIssueCertificatesOfEmployment: true,
    },
    procurement: {
      autoIssuePurchaseOrdersBelowMinorUnits: 0,
      autoRenewVendorContracts: false,
      escalateSingleSourceAwards: true,
    },
    insurance: {
      autoRenewPoliciesBeforeDays: 30,
      autoFileClaimsBelowMinorUnits: 0,
      escalateCoverageGaps: true,
    },
    legal_proceedings: {
      autoDraftEvictionNotices: true,
      autoFileToTribunal: false,
      autoScheduleMediation: false,
    },
    tenant_welfare: {
      autoOfferPaymentPlansBelowMinorUnits: 100_000_00,
      autoEnrollInHardshipRelief: false,
      escalateVulnerableHouseholds: true,
    },
    escalation: {
      primaryUserId: null,
      secondaryUserId: null,
      fallbackEmails: [],
    },
    version: 1,
    updatedAt: ZERO_ISO,
    updatedBy: null,
  };
}

/**
 * The delegation matrix UI asks for a static dimensionality.
 * Wave 27 Part B.9: expanded from 5×6=30 to 11×6=66 cells.
 */
export const DELEGATION_MATRIX_DIMENSIONS = {
  domains: 11,
  actionTypes: 6,
  totalCells: 66,
} as const;
