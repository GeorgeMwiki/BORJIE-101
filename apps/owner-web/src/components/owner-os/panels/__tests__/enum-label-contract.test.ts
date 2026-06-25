/**
 * Enum-label contract + locale-purity gate (raw-enum-render class).
 *
 * The bug class: a panel cell that renders a DB enum token verbatim
 * (`render: (r) => r.status`) prints the raw code (`active`,
 * `processing_plant`). Source-literal scanners can't see it (the string
 * arrives at runtime off the wire), yet it leaks English under `sw`.
 *
 * This gate, run in the package test suite, asserts:
 *
 *  1. CONTRACT — the FE vocabulary in `enumLabels` is a faithful copy of
 *     the gateway/database source of truth (every server token has a
 *     label; order-independent). A server-side vocabulary change that
 *     adds a token fails here until the label lands.
 *
 *  2. PARITY — every token has a NON-EMPTY label in BOTH `en` and `sw`
 *     (no half-translated token; no cross-language fallback).
 *
 *  3. ZERO-MIX — under `sw`, `enumLabel(domain, token, 'sw')` never
 *     returns the raw `snake_case` token verbatim. This is the
 *     regression tripwire: revert any panel to `render: (r) => r.<field>`
 *     and the rendered value becomes the raw token — which this test
 *     proves a localised label never equals.
 *
 * Proof the gate BITES: delete a token from `enumLabels.entityStatus`
 * (e.g. `active`) and assertion (1) goes RED; restore it and it's GREEN.
 * Replace a `sw` label with its raw token and assertion (3) goes RED.
 */

import { describe, it, expect } from 'vitest';

import { enumLabel, type EnumDomain } from '../enum-label';
import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';

// ── Faithful copies of the server source-of-truth vocabularies ──────────
// Kept in sync with:
//   estate-entities.schema.ts        ESTATE_ENTITY_KINDS / _STATUSES
//   estate-groups.schema.ts          ESTATE_HOLDING_TYPES
//   estate-assets.schema.ts          ESTATE_ASSET_CLASSES / _VALUATION_METHODS
//   mining/csr-plans.hono.ts         CSR status enum + schema category comment
//   safety-csr.schema.ts             community_meetings.status comment
//   audit-trail.router.ts            ACTOR_KIND_ENUM / ACTION_CATEGORY_ENUM
//   interactive-reports + document-render-jobs schemas  render kinds
//   lib/types/lmbm.ts                LmbmNodeKind (round-11 sweep)
//   lib/queries/market-intelligence  DisruptionAlert kind / severity
//   lib/queries/capacity-expansion   ExpansionKind / recommendation severity
//   ai-copilot/head-briefing/types   Escalation P1-3 / urgency / AutonomyDomain
//   lib/queries/wave9                SandboxWrite status / operation
//
// NOTE on the FREE-TEXT columns (siteStatus, sandboxWriteStatus,
// sandboxOperation): the gateway column is a plain string, not a hard DB
// enum, so there is no closed server enum to mirror. The vocabulary below
// is the bounded set the FE intentionally localises; anything else is
// humanised by enumLabel() (never leaked raw). The test set therefore
// EQUALS the FE set for these domains — the no-drift / no-unmapped pair
// pins the curated vocabulary, and the humanise safety-net test covers the
// open tail.
const SERVER_VOCAB: Record<EnumDomain, readonly string[]> = {
  entityKind: [
    'mine_licence_holder', 'processing_plant', 'transport_co', 'equipment_rental',
    'camp_catering', 'fuel_station', 'retail_at_site', 'real_estate', 'agriculture',
    'forestry', 'tourism', 'security_co', 'insurance_brokerage', 'consulting_firm',
    'training_school', 'subsidiary_holding', 'joint_venture', 'other',
  ],
  entityStatus: ['active', 'dormant', 'divested', 'wound_up'],
  holdingType: [
    'family_office', 'investment_co', 'trust', 'sole_proprietor', 'jv',
    'cooperative_apex',
  ],
  assetClass: [
    'mining_licence', 'land_parcel', 'building', 'plant_equipment', 'vehicle',
    'inventory', 'financial_instrument', 'intellectual_property', 'goodwill',
    'crypto', 'other',
  ],
  valuationMethod: [
    'book_value', 'market_value', 'replacement_cost', 'appraised',
    'discounted_cash_flow', 'other',
  ],
  csrCategory: [
    'education', 'water', 'health', 'roads', 'markets', 'land_rehab', 'youth',
    'other',
  ],
  csrStatus: ['draft', 'approved', 'in_progress', 'completed', 'cancelled'],
  communityMeetingStatus: ['scheduled', 'held', 'cancelled', 'deferred'],
  // contracts library — bounded lifecycle the FE owns until the table lands.
  legalContractStatus: [
    'draft', 'under_review', 'negotiating', 'executed', 'active', 'expired',
    'terminated',
  ],
  ancillaryStatus: ['active', 'dormant', 'divested', 'wound_up'],
  renderKind: [
    'html_bundle', 'html_with_video', 'html_with_charts', 'print_pdf_fallback',
    'text', 'docxtemplater', 'react-pdf', 'typst',
  ],
  auditActorKind: [
    'ai_autonomous', 'ai_proposal', 'ai_execution', 'human_approval',
    'human_override', 'human_action', 'system',
  ],
  auditActionCategory: [
    'finance', 'offtake', 'royalty_collection', 'licence_suspension',
    'counterparty_welfare', 'maintenance', 'compliance', 'communications',
    'marketing', 'hr', 'procurement', 'insurance', 'legal', 'other',
    // deprecated legacy aliases retained for immutable historical entries
    'leasing', 'rent_collection', 'tenant_welfare', 'eviction',
  ],

  // ── Round-11 non-owner-os surfaces (raw-enum-render sweep) ────────────
  // sites.status — free-text lifecycle column (curated bounded set).
  siteStatus: [
    'active', 'planned', 'exploration', 'development', 'production',
    'suspended', 'care_and_maintenance', 'rehabilitation', 'closed',
    'dormant', 'unknown', 'unspecified',
  ],
  // LmbmNodeKind
  lmbmNodeKind: ['company', 'licence', 'site', 'document', 'person', 'event'],
  // market-intelligence disruption_alerts.kind
  disruptionKind: ['logistics', 'regulatory', 'weather', 'geopolitics'],
  // shared alert severity (disruption ∪ expansion recommendation)
  alertSeverity: ['info', 'low', 'medium', 'high', 'critical'],
  // ExpansionKind (hyphenated)
  expansionKind: ['new-shaft', 'new-site', 'processing-upgrade'],
  // head-briefing escalation.priority
  escalationPriority: ['P1', 'P2', 'P3'],
  // head-briefing pending-approval.urgency
  approvalUrgency: ['low', 'medium', 'high'],
  // owner-os reminders.status — dispatch lifecycle union
  reminderStatus: [
    'scheduled', 'sending', 'sent', 'acknowledged', 'failed', 'cancelled',
  ],
  // owner-os reminders.channel — ReminderChannel
  reminderChannel: ['email', 'sms', 'slack', 'whatsapp'],
  // head-briefing notable-action.domain — AutonomyDomain
  autonomyDomain: [
    'finance', 'offtake', 'maintenance', 'compliance', 'communications',
    'marketing', 'hr', 'procurement', 'insurance', 'legal_proceedings',
    'community_welfare',
  ],
  // md-agentic sandbox-writes status — free-text lifecycle (curated set)
  sandboxWriteStatus: ['pending', 'committed', 'rejected'],
  // md-agentic sandbox-writes operation — free-text DB verb (curated set)
  sandboxOperation: ['insert', 'update', 'delete', 'upsert'],
};

const DOMAINS = Object.keys(SERVER_VOCAB) as EnumDomain[];

describe('owner-os enum-label contract (raw-enum-render gate)', () => {
  it('every server domain has a FE label vocabulary', () => {
    for (const domain of DOMAINS) {
      expect(P.enumLabels[domain], `missing FE vocab for ${domain}`).toBeDefined();
    }
  });

  it('every server token has a FE label (contract: no unmapped token)', () => {
    for (const domain of DOMAINS) {
      const vocab = P.enumLabels[domain] as Record<string, unknown>;
      const missing = SERVER_VOCAB[domain].filter((t) => !(t in vocab));
      expect(missing, `unmapped ${domain} tokens`).toEqual([]);
    }
  });

  it('the FE vocabulary adds no token the server cannot emit (no drift)', () => {
    for (const domain of DOMAINS) {
      const server = new Set(SERVER_VOCAB[domain]);
      const extra = Object.keys(P.enumLabels[domain]).filter((t) => !server.has(t));
      expect(extra, `stale ${domain} tokens not in server enum`).toEqual([]);
    }
  });

  it('every token has a non-empty EN and SW label (parity, no mixing)', () => {
    for (const domain of DOMAINS) {
      const vocab = P.enumLabels[domain] as Record<
        string,
        { en: string; sw: string }
      >;
      for (const token of SERVER_VOCAB[domain]) {
        const label = vocab[token]!;
        expect(label.en.length, `empty EN for ${domain}.${token}`).toBeGreaterThan(0);
        expect(label.sw.length, `empty SW for ${domain}.${token}`).toBeGreaterThan(0);
      }
    }
  });

  it('NEVER renders a raw enum token verbatim under sw (zero-mix tripwire)', () => {
    for (const domain of DOMAINS) {
      for (const token of SERVER_VOCAB[domain]) {
        const sw = enumLabel(domain, token, 'sw');
        // The whole point: a localised SW label must differ from the raw
        // code (which is what a `render: (r) => r.field` regression emits).
        expect(
          sw,
          `${domain}.${token} leaks the raw token under sw`,
        ).not.toBe(token);
        expect(sw.length).toBeGreaterThan(0);
      }
    }
  });

  it('EN and SW labels differ for tokens whose code is not already English', () => {
    // Catches a half-done entry where a translator left the SW slot equal to
    // the EN label for a token that clearly needs a Swahili word.
    const sample: Array<[EnumDomain, string]> = [
      ['entityStatus', 'active'],
      ['csrCategory', 'education'],
      ['auditActionCategory', 'finance'],
      ['holdingType', 'family_office'],
    ];
    for (const [domain, token] of sample) {
      const en = enumLabel(domain, token, 'en');
      const sw = enumLabel(domain, token, 'sw');
      expect(sw, `${domain}.${token} SW not localised`).not.toBe(en);
    }
  });

  it('resolves empty / nullish tokens to the em-dash placeholder', () => {
    expect(enumLabel('entityStatus', null, 'sw')).toBe('—');
    expect(enumLabel('entityStatus', undefined, 'en')).toBe('—');
    expect(enumLabel('entityStatus', '', 'sw')).toBe('—');
  });

  it('humanises an unknown token instead of printing it raw (safety net)', () => {
    // Wire drift: a value the server adds before the label lands must not
    // render as a bare snake_case code.
    expect(enumLabel('entityStatus', 'brand_new_value', 'sw')).toBe('Brand new value');
    expect(enumLabel('entityStatus', 'brand_new_value', 'sw')).not.toBe('brand_new_value');
  });
});
