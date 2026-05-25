/**
 * Starting-point chips — shown above the empty chat input to suggest
 * relevant questions the user can ask RIGHT NOW.
 *
 * The shape is a pure function of `(user, context)`. No I/O happens
 * here — the caller pre-loads the lightweight context (lease end,
 * recent maintenance, season, role-specific signals) and we score
 * candidate chips against it.
 *
 * Why pure: rendered on every chat-panel mount, latency budget is
 * < 5 ms. Also keeps the hot path testable without mocking I/O.
 */

import type { Role } from './roles.js';

/** ISO date string at day precision (YYYY-MM-DD). */
export type IsoDate = string;

/** Northern-hemisphere season buckets — used for energy/seasonal chips. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'dry' | 'wet';

export interface UserSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly role: Role;
  /** Display name — purely for personalising the chip copy, not for auth. */
  readonly displayName?: string;
}

/**
 * Lightweight context the caller assembles before mounting the chat.
 * All fields optional — chips degrade gracefully.
 */
export interface StartingPointContext {
  readonly today: IsoDate;
  readonly season?: Season;
  /** ISO date — when the user's lease ends. Drives the renewal chip. */
  readonly leaseEndDate?: IsoDate | null;
  /** Days since the user's oldest open maintenance request. */
  readonly oldestOpenMaintenanceAgeDays?: number | null;
  /** Number of properties the user owns (drives onboarding for new owners). */
  readonly ownedPropertyCount?: number;
  /** Whether the user has a property manager already attached. */
  readonly hasPropertyManager?: boolean;
  /** Number of arrears (overdue invoices) on the portfolio. */
  readonly arrearsCount?: number;
  /** Most recent significant activity verb on the account. */
  readonly recentActivity?:
    | 'logged-new-property'
    | 'completed-onboarding'
    | 'received-late-notice'
    | 'submitted-maintenance'
    | null;
}

export interface StartingPoint {
  readonly id: string;
  readonly label: string;
  /** The prompt that gets submitted when the user clicks the chip. */
  readonly prompt: string;
  /** 0 = lowest, higher = more urgent / more relevant. */
  readonly priority: number;
  /** Human-readable reason for surfacing this chip — included in audit. */
  readonly reason: string;
}

const MIN_CHIPS = 3;
const MAX_CHIPS = 5;

/**
 * Generate 3-5 chips for `user` given `context`. Always returns at
 * least `MIN_CHIPS` chips by topping up with sensible role defaults.
 */
export function generateStartingPoints(args: {
  readonly user: UserSnapshot;
  readonly context: StartingPointContext;
}): ReadonlyArray<StartingPoint> {
  const { user, context } = args;
  const candidates: StartingPoint[] = [];

  // Lease end approaching — top priority for tenants
  if (
    user.role === 'tenant' &&
    context.leaseEndDate &&
    daysBetween(context.today, context.leaseEndDate) <= 90 &&
    daysBetween(context.today, context.leaseEndDate) >= 0
  ) {
    candidates.push({
      id: 'lease-renewal',
      label: 'Discuss renewal',
      prompt:
        'My lease is ending soon. Walk me through my renewal options and what to negotiate.',
      priority: 100,
      reason: `lease ends in ${daysBetween(context.today, context.leaseEndDate)} days`,
    });
  }

  // Maintenance request unresolved > 7 days
  if (
    context.oldestOpenMaintenanceAgeDays != null &&
    context.oldestOpenMaintenanceAgeDays > 7
  ) {
    candidates.push({
      id: 'maintenance-escalate',
      label: 'Escalate maintenance',
      prompt:
        'I have an open maintenance request that has gone past the normal SLA. What should I do next?',
      priority: 90,
      reason: `oldest open ticket is ${context.oldestOpenMaintenanceAgeDays} days old`,
    });
  }

  // Seasonal energy chip
  if (
    context.season === 'winter' &&
    (user.role === 'tenant' || user.role === 'owner')
  ) {
    candidates.push({
      id: 'season-winter-energy',
      label: 'Lower the winter energy bill',
      prompt:
        'Winter is here. What can I do to reduce my heating bill this season without major works?',
      priority: 60,
      reason: 'winter season',
    });
  }
  if (
    context.season === 'summer' &&
    (user.role === 'tenant' || user.role === 'owner')
  ) {
    candidates.push({
      id: 'season-summer-cooling',
      label: 'Cool the place efficiently',
      prompt:
        'It is summer. What are the cheapest ways to keep the place cool without running A/C all day?',
      priority: 50,
      reason: 'summer season',
    });
  }
  if (
    context.season === 'wet' &&
    (user.role === 'tenant' || user.role === 'owner')
  ) {
    candidates.push({
      id: 'season-wet-damp',
      label: 'Avoid damp in the rainy season',
      prompt:
        'Rainy season is starting. How do I prevent damp and mould in my unit?',
      priority: 55,
      reason: 'wet season',
    });
  }

  // New owner onboarding
  if (
    user.role === 'owner' &&
    (context.ownedPropertyCount ?? 0) > 0 &&
    context.hasPropertyManager === false
  ) {
    candidates.push({
      id: 'owner-onboard-pm',
      label: 'Find a property manager',
      prompt:
        'I have property but no property manager yet. Walk me through how to pick the right one.',
      priority: 80,
      reason: 'new owner without PM',
    });
  }
  if (
    user.role === 'owner' &&
    context.recentActivity === 'logged-new-property'
  ) {
    candidates.push({
      id: 'owner-sustainability-upgrade',
      label: 'Plan sustainability upgrades',
      prompt:
        'I just added a new property. What sustainability upgrades pay back fastest?',
      priority: 70,
      reason: 'recent new-property log',
    });
  }

  // PM arrears chip
  if (
    user.role === 'property-manager' &&
    (context.arrearsCount ?? 0) > 0
  ) {
    candidates.push({
      id: 'pm-arrears',
      label: `${context.arrearsCount} accounts in arrears`,
      prompt:
        'Show me the arrears playbook for the open accounts and which to chase first.',
      priority: 85,
      reason: `${context.arrearsCount} arrears`,
    });
  }

  // Tenant late-notice received
  if (
    user.role === 'tenant' &&
    context.recentActivity === 'received-late-notice'
  ) {
    candidates.push({
      id: 'tenant-late-notice',
      label: 'I got a late notice — what now?',
      prompt:
        'I received a late-payment notice. How do I resolve this quickly and what are my options?',
      priority: 95,
      reason: 'recent late notice',
    });
  }

  // Role defaults — always available, low priority. We add several so
  // the chip set is never empty.
  candidates.push(...roleDefaults(user.role));

  // De-dupe by id, sort by priority desc, slice to MAX.
  const seen = new Set<string>();
  const ordered = [...candidates]
    .sort((a, b) => b.priority - a.priority)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  const limited = ordered.slice(0, MAX_CHIPS);
  // Guarantee MIN_CHIPS by topping up with role defaults if we somehow
  // fell short. Should never trigger in practice but cheap insurance.
  if (limited.length < MIN_CHIPS) {
    return [...limited, ...roleDefaults(user.role)].slice(0, MIN_CHIPS);
  }
  return limited;
}

function roleDefaults(role: Role): StartingPoint[] {
  switch (role) {
    case 'tenant':
      return [
        {
          id: 'default-tenant-rent-fair',
          label: 'Is my rent fair?',
          prompt:
            'Compared to similar units in my area, is the rent I am paying fair?',
          priority: 20,
          reason: 'role default — tenant',
        },
        {
          id: 'default-tenant-rights',
          label: 'My tenant rights',
          prompt:
            'What are my main rights as a tenant in this country, in plain English?',
          priority: 15,
          reason: 'role default — tenant',
        },
        {
          id: 'default-tenant-neighborhood',
          label: 'About my neighbourhood',
          prompt: 'Tell me about my neighbourhood — schools, safety, commute.',
          priority: 10,
          reason: 'role default — tenant',
        },
      ];
    case 'owner':
      return [
        {
          id: 'default-owner-yield',
          label: 'How is my yield trending?',
          prompt:
            'How is the rental yield on my portfolio trending vs the market?',
          priority: 25,
          reason: 'role default — owner',
        },
        {
          id: 'default-owner-acquire',
          label: 'Should I buy more?',
          prompt:
            'Given my current portfolio, should I be acquiring more property right now?',
          priority: 20,
          reason: 'role default — owner',
        },
        {
          id: 'default-owner-sustainability',
          label: 'Sustainability angle',
          prompt:
            'What is the commercial case for sustainability upgrades on my buildings?',
          priority: 15,
          reason: 'role default — owner',
        },
      ];
    case 'property-manager':
      return [
        {
          id: 'default-pm-renewals',
          label: 'Renewal pipeline',
          prompt:
            'Which renewals should I prioritise this month and what is the play for each?',
          priority: 25,
          reason: 'role default — PM',
        },
        {
          id: 'default-pm-occupancy',
          label: 'Lift occupancy',
          prompt:
            'What are the highest-leverage moves to lift occupancy across the portfolio?',
          priority: 20,
          reason: 'role default — PM',
        },
        {
          id: 'default-pm-automation',
          label: 'Automate the boring stuff',
          prompt:
            'What can I hand over to the autonomous-management agent without losing oversight?',
          priority: 15,
          reason: 'role default — PM',
        },
      ];
    case 'estate-manager':
      return [
        {
          id: 'default-em-vendor',
          label: 'Pick the right vendor',
          prompt:
            'How should I be choosing vendors for routine maintenance?',
          priority: 20,
          reason: 'role default — EM',
        },
        {
          id: 'default-em-preventive',
          label: 'Preventive schedule',
          prompt:
            'What preventive-maintenance schedule should I run this quarter?',
          priority: 15,
          reason: 'role default — EM',
        },
        {
          id: 'default-em-compliance',
          label: 'Compliance check',
          prompt:
            'What compliance checks am I most likely to miss this quarter?',
          priority: 10,
          reason: 'role default — EM',
        },
      ];
    case 'admin':
      return [
        {
          id: 'default-admin-overview',
          label: 'Platform health snapshot',
          prompt: 'Give me a platform health snapshot for today.',
          priority: 20,
          reason: 'role default — admin',
        },
        {
          id: 'default-admin-risk',
          label: 'Top risks this week',
          prompt: 'What are the top three risks across tenants this week?',
          priority: 15,
          reason: 'role default — admin',
        },
        {
          id: 'default-admin-adoption',
          label: 'Feature adoption',
          prompt:
            'Which recently-shipped features are getting the most traction?',
          priority: 10,
          reason: 'role default — admin',
        },
      ];
    case 'prospect':
      return [
        {
          id: 'default-prospect-find',
          label: 'Find a place',
          prompt: 'Help me find a place that fits my budget and area.',
          priority: 20,
          reason: 'role default — prospect',
        },
        {
          id: 'default-prospect-budget',
          label: 'How much can I afford?',
          prompt: 'How much should I budget for rent given my income?',
          priority: 15,
          reason: 'role default — prospect',
        },
        {
          id: 'default-prospect-neighborhood',
          label: 'Best neighbourhood for me',
          prompt:
            'I am moving to this city — which neighbourhood fits a young professional?',
          priority: 10,
          reason: 'role default — prospect',
        },
      ];
    case 'service-provider':
      return [
        {
          id: 'default-sp-jobs',
          label: 'My open jobs',
          prompt: 'Show me my open jobs and the soonest deadlines.',
          priority: 20,
          reason: 'role default — service provider',
        },
        {
          id: 'default-sp-site',
          label: 'Site instructions',
          prompt: 'Walk me through the site instructions for my next job.',
          priority: 15,
          reason: 'role default — service provider',
        },
        {
          id: 'default-sp-materials',
          label: 'Materials checklist',
          prompt: 'What materials should I bring for the next job?',
          priority: 10,
          reason: 'role default — service provider',
        },
      ];
  }
}

function daysBetween(today: IsoDate, later: IsoDate): number {
  const t = Date.parse(today);
  const l = Date.parse(later);
  if (Number.isNaN(t) || Number.isNaN(l)) return Number.POSITIVE_INFINITY;
  return Math.floor((l - t) / (1000 * 60 * 60 * 24));
}
