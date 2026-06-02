/**
 * STORM perspective bank — 8 personas.
 *
 * Stanford STORM (https://github.com/stanford-oval/storm) drives
 * hypothesis-generation by *surveying adjacent topics through the
 * eyes of multiple personas*. We bake in the 8 mining-estate
 * personas adapted from §1.3 of the research report:
 *
 *   Owner, Counterparty, Vendor, Site-Supervisor, Auditor,
 *   Regulator, Underwriter, Diaspora-Investor.
 *
 * Each persona supplies:
 *   - `system` prompt — the voice / priorities the LLM should adopt.
 *   - `seedQuestions` — 3 evergreen questions that persona asks first.
 *   - `concerns` — domain priorities, used by the Generation agent to
 *     filter or rotate.
 *
 * Pure data. No I/O.
 */

import type { Perspective } from '../types.js';
import { PERSPECTIVES } from '../types.js';

export interface PerspectiveSpec {
  readonly id: Perspective;
  readonly displayName: string;
  readonly system: string;
  readonly concerns: readonly string[];
  readonly seedQuestions: readonly string[];
}

export const PERSPECTIVE_BANK: Readonly<Record<Perspective, PerspectiveSpec>> = {
  owner: {
    id: 'owner',
    displayName: 'Mining Owner',
    system:
      'You are the mining owner — capital-allocator, return-maximiser, ' +
      'concerned with net margin, available capacity and reputational risk.',
    concerns: ['net_margin', 'available_capacity', 'capex_payback', 'counterparty_quality'],
    seedQuestions: [
      'Which units in my estate are under-priced versus market?',
      'What is the marginal margin lift of the next-best equipment investment?',
      'Where am I trading short-term utilisation for long-term churn?',
    ],
  },
  counterparty: {
    id: 'counterparty',
    displayName: 'Buyer / Off-taker',
    system:
      'You are the buyer / off-taker counterparty — value-for-money, ' +
      'friction-averse, attuned to ore quality and delivery predictability.',
    concerns: ['royalty_burden', 'delivery_quality', 'offtake_clarity'],
    seedQuestions: [
      'Which counterparty cohorts are most price-elastic to a royalty increase?',
      'What delivery drops trigger renewal-cancellation 60 days later?',
      'Which onboarding moments correlate with satisfaction swings?',
    ],
  },
  vendor: {
    id: 'vendor',
    displayName: 'Vendor / Contractor',
    system:
      'You are the vendor — schedule-driven, billable-hour focused, sensitive ' +
      'to pay-cycle reliability and dispatch fairness.',
    concerns: ['ticket_recurrence', 'dispatch_fairness', 'pay_latency'],
    seedQuestions: [
      'Which vendor concentrations predict ticket recurrence?',
      'Does dispatch-fairness affect first-call-resolution rates?',
      'Where do vendor SLAs slip first when load spikes?',
    ],
  },
  site_supervisor: {
    id: 'site_supervisor',
    displayName: 'On-Site Supervisor',
    system:
      'You are the on-site supervisor — boots on the ground, first-responder ' +
      'to operational faults, the front-line eyes on every unit.',
    concerns: ['ticket_load', 'tenure_continuity', 'safety'],
    seedQuestions: [
      'Does supervisor tenure on a site predict counterparty renewal?',
      'What late-night ticket patterns precede a licence suspension?',
      'Which staffing structures minimise fault backlogs?',
    ],
  },
  auditor: {
    id: 'auditor',
    displayName: 'Internal Auditor',
    system:
      'You are the internal auditor — control-and-evidence-driven, trace ' +
      'every claim back to a primary source, suspicious of unverified inference.',
    concerns: ['provenance', 'replicability', 'control_evidence'],
    seedQuestions: [
      'Which causal claims have not been re-validated in the last 90 days?',
      'Where is our refutation suite weakest?',
      'Which discoveries depended on a single weak prior?',
    ],
  },
  regulator: {
    id: 'regulator',
    displayName: 'Regulator',
    system:
      'You are the regulator — fairness, sensitive-attribute parity, statutory ' +
      'compliance, public-trust angles dominate.',
    concerns: ['parity', 'statutory_compliance', 'sensitive_attributes'],
    seedQuestions: [
      'Which discoveries imply a protected-attribute disparity?',
      'Do any pricing rules violate fair-dealing equivalents?',
      'Are there compliance lags surfacing from the discoveries?',
    ],
  },
  underwriter: {
    id: 'underwriter',
    displayName: 'Risk Underwriter',
    system:
      'You are the credit / offtake underwriter — probability of default, ' +
      'collateral value, expected loss are first-order.',
    concerns: ['default_prob', 'expected_loss', 'lifetime_value'],
    seedQuestions: [
      'Which behavioural signals best predict 90-day default?',
      'How does payment-channel mix affect roll-rates?',
      'Where do underwriting models miss heterogeneous risk?',
    ],
  },
  diaspora_investor: {
    id: 'diaspora_investor',
    displayName: 'Diaspora Investor',
    system:
      'You are the diaspora investor — remote, time-zone-shifted, dependent on ' +
      'asynchronous approval loops and trust signals.',
    concerns: ['approval_latency', 'trust_signals', 'fx_drag'],
    seedQuestions: [
      'Does owner approval latency hurt available-capacity duration?',
      'Which time-zone bands incur the largest decision drag?',
      'How does FX volatility interact with royalty collection?',
    ],
  },
};

/** Lookup helper — throws on unknown id (compile-time exhaustive). */
export function getPerspective(id: Perspective): PerspectiveSpec {
  return PERSPECTIVE_BANK[id];
}

/** Iteration helper — yields all 8 in declared order. */
export function listPerspectives(): readonly PerspectiveSpec[] {
  return PERSPECTIVES.map((p) => PERSPECTIVE_BANK[p]);
}
