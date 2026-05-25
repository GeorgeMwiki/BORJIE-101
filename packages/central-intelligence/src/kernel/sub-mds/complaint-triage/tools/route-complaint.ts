/**
 * `complaint.route` — mutate tier (reversible).
 *
 * Routes a classified complaint to the right owner-portal queue.
 * Audit-logged. Reversible until an owner picks it up.
 */

import type { ComplaintCategory, ComplaintSeverity } from './classify-complaint.js';

export type RoutingDesk =
  | 'maintenance-desk'
  | 'billing-desk'
  | 'owner-direct'
  | 'legal-review'
  | 'community-desk'
  | 'general-inbox';

export interface RouteComplaintArgs {
  readonly category: ComplaintCategory;
  readonly severity: ComplaintSeverity;
}

export interface RouteComplaintResult {
  readonly desk: RoutingDesk;
  readonly priority: 'p0' | 'p1' | 'p2' | 'p3';
  readonly slaMinutes: number;
  readonly reasoning: string;
}

const SLA_BY_PRIORITY: Readonly<Record<RouteComplaintResult['priority'], number>> = Object.freeze({
  p0: 60,
  p1: 240,
  p2: 1440,
  p3: 4320,
});

export function routeComplaint(args: RouteComplaintArgs): RouteComplaintResult {
  let desk: RoutingDesk;
  switch (args.category) {
    case 'safety':
      desk = 'owner-direct';
      break;
    case 'fair-treatment':
    case 'privacy':
      desk = 'legal-review';
      break;
    case 'maintenance':
      desk = 'maintenance-desk';
      break;
    case 'billing':
      desk = 'billing-desk';
      break;
    case 'neighbor-noise':
      desk = 'community-desk';
      break;
    case 'lease-question':
      desk = 'owner-direct';
      break;
    case 'other':
    default:
      desk = 'general-inbox';
      break;
  }

  const priority: RouteComplaintResult['priority'] =
    args.severity === 'critical' ? 'p0'
    : args.severity === 'urgent' ? 'p1'
    : args.severity === 'standard' ? 'p2'
    : 'p3';

  return Object.freeze({
    desk,
    priority,
    slaMinutes: SLA_BY_PRIORITY[priority],
    reasoning: `${args.category} × ${args.severity} → ${desk} (${priority})`,
  });
}
