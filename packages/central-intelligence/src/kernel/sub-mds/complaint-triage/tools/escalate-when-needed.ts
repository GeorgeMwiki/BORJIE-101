/**
 * `complaint.escalate_when_needed` — mutate tier (reversible).
 *
 * Escalation matrix:
 *   - critical safety              → owner direct phone within 60 min
 *   - fair-treatment / harassment  → owner direct phone + legal-tag
 *   - privacy violation            → owner direct + legal-tag
 *   - urgent maintenance / billing → maintenance/billing desk fast-lane
 *   - everything else              → standard queue
 *
 * The tool emits an ESCALATION DIRECTIVE — it does not place the
 * phone call. The owner-portal action panel renders the directive.
 */

import type {
  ComplaintCategory,
  ComplaintSeverity,
} from './classify-complaint.js';

export type EscalationChannel =
  | 'owner-direct-phone'
  | 'maintenance-fast-lane'
  | 'billing-fast-lane'
  | 'legal-review-queue'
  | 'standard-queue';

export interface EscalationDirective {
  readonly channel: EscalationChannel;
  readonly slaMinutes: number;
  readonly tags: ReadonlyArray<'legal' | 'safety' | 'billing' | 'maintenance' | 'community'>;
  readonly mustNotifyOwner: boolean;
  readonly reasoning: string;
}

export interface EscalateArgs {
  readonly category: ComplaintCategory;
  readonly severity: ComplaintSeverity;
}

export function escalateWhenNeeded(args: EscalateArgs): EscalationDirective {
  const { category, severity } = args;

  type Tag = EscalationDirective['tags'][number];
  const tags = (xs: ReadonlyArray<Tag>): ReadonlyArray<Tag> => Object.freeze(xs.slice());

  // Critical safety — top priority
  if (category === 'safety' && severity === 'critical') {
    const result: EscalationDirective = {
      channel: 'owner-direct-phone',
      slaMinutes: 60,
      tags: tags(['safety']),
      mustNotifyOwner: true,
      reasoning: 'Critical safety complaint — owner phoned within 60 min',
    };
    return Object.freeze(result);
  }

  // Fair-treatment / privacy — legal review + owner alert
  if (category === 'fair-treatment' || category === 'privacy') {
    const result: EscalationDirective = {
      channel: 'owner-direct-phone',
      slaMinutes: severity === 'critical' ? 60 : 240,
      tags: tags(['legal']),
      mustNotifyOwner: true,
      reasoning: `${category} — flagged for legal review with owner notification`,
    };
    return Object.freeze(result);
  }

  // Non-critical safety — owner notified but standard SLA
  if (category === 'safety') {
    const result: EscalationDirective = {
      channel: 'owner-direct-phone',
      slaMinutes: 240,
      tags: tags(['safety']),
      mustNotifyOwner: true,
      reasoning: 'Safety concern — owner notified, standard SLA',
    };
    return Object.freeze(result);
  }

  // Urgent maintenance — fast-lane
  if (category === 'maintenance' && (severity === 'urgent' || severity === 'critical')) {
    const result: EscalationDirective = {
      channel: 'maintenance-fast-lane',
      slaMinutes: 240,
      tags: tags(['maintenance']),
      mustNotifyOwner: false,
      reasoning: 'Urgent maintenance — fast-lane queue',
    };
    return Object.freeze(result);
  }

  // Urgent billing — fast-lane
  if (category === 'billing' && (severity === 'urgent' || severity === 'critical')) {
    const result: EscalationDirective = {
      channel: 'billing-fast-lane',
      slaMinutes: 240,
      tags: tags(['billing']),
      mustNotifyOwner: false,
      reasoning: 'Urgent billing — fast-lane queue',
    };
    return Object.freeze(result);
  }

  // Chatter or neighbour noise low priority
  if (severity === 'chatter') {
    const result: EscalationDirective = {
      channel: 'standard-queue',
      slaMinutes: 4320,
      tags: tags([]),
      mustNotifyOwner: false,
      reasoning: 'Chatter severity — standard queue, no escalation',
    };
    return Object.freeze(result);
  }

  const fallback: EscalationDirective = {
    channel: 'standard-queue',
    slaMinutes: 1440,
    tags: tags(category === 'neighbor-noise' ? ['community'] : []),
    mustNotifyOwner: false,
    reasoning: `${category} × ${severity} — standard queue`,
  };
  return Object.freeze(fallback);
}
