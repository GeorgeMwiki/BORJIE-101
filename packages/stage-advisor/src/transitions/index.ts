/**
 * Stage transitions — narrate the move from one stage to another so
 * the brain can introduce new capabilities supportively when the org
 * grows, and gracefully when it contracts.
 *
 * Pure: `getTransition(prev, curr)` returns either a transition card
 * (with narrative + capabilities-to-unlock) or `null` when prev === curr.
 *
 * Tone notes:
 *   - growth transitions are celebratory + actionable
 *   - shrink transitions are supportive, NEVER alarming or shaming
 */

import { STAGE_CARDS, STAGE_ORDER } from '../stages/definitions.js';
import type {
  CapabilityId,
  OrgStage,
  StageTransition,
  TransitionKind,
} from '../types.js';

function stageIndex(stage: OrgStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function diff(
  a: ReadonlyArray<CapabilityId>,
  b: ReadonlyArray<CapabilityId>,
): ReadonlyArray<CapabilityId> {
  const bSet = new Set(b);
  return a.filter((x) => !bSet.has(x));
}

function classify(prev: OrgStage, curr: OrgStage): TransitionKind {
  const p = stageIndex(prev);
  const c = stageIndex(curr);
  if (c > p) return 'grow';
  if (c < p) return 'shrink';
  return 'same';
}

const GROW_MESSAGES: Readonly<Record<OrgStage, string>> = {
  'pre-launch':
    'Setup is complete — let me know when you onboard your first property.',
  seedling:
    'Your first units are live. Let me know when you want help with the lease loop.',
  sprout:
    'You have grown past 10 units — time to introduce maintenance categories and scheduled inspections so things stay tidy.',
  sapling:
    'You have crossed 50 units. Let me introduce procurement coordination, inventory, and vendor management — they will start paying off quickly at this scale.',
  tree:
    'You have crossed 200 units. Fleet management, dedicated PM teams, and a tighter reporting cadence are now the next logical layer.',
  forest:
    'You have crossed 1,000 units. Time to look at regional ops, treasury, and a deliberate expansion pipeline.',
  ecosystem:
    'You have entered the ecosystem stage. Multi-jurisdiction, IR / AOR reporting, and the ops command center are ready when you are.',
};

const SHRINK_MESSAGES: Readonly<Record<OrgStage, string>> = {
  'pre-launch':
    'Lighter footprint right now — happy to walk you back through setup if anything changed.',
  seedling:
    'Your portfolio is back at seedling scale. The lease + payment basics will still cover everything you need.',
  sprout:
    'Sprout-stage workflows still fit. Maintenance taxonomy + scheduled inspections remain a good fit.',
  sapling:
    'Sapling-stage capabilities continue to be useful — procurement and vendor management remain available.',
  tree:
    'Tree-stage capabilities continue to apply — fleet and advanced reporting stay enabled.',
  forest:
    'Forest-stage operations stay in place — regional ops, treasury and expansion planning remain available.',
  ecosystem:
    'Ecosystem capabilities remain available. We will not retire jurisdictions or IR / AOR until you ask.',
};

const NEXT_STEPS_GROW: Readonly<Record<OrgStage, ReadonlyArray<string>>> = {
  'pre-launch': [
    'Finish the org-setup wizard if you have not already.',
    'Add your first property and configure a payment method.',
  ],
  seedling: [
    'Sign your first lease using the in-app workflow.',
    'Issue the first invoice and confirm your payment rail works end-to-end.',
    'Send a test broadcast to your tenant(s).',
  ],
  sprout: [
    'Define 5+ maintenance categories that match how you actually triage.',
    'Schedule your first recurring inspection (quarterly is a fine starting cadence).',
    'Subscribe to the weekly arrears digest.',
  ],
  sapling: [
    'Register your top-5 suppliers with payment terms and SLA expectations.',
    'Create your first inventory location at your main warehouse.',
    'Publish your first RFQ — start with a maintenance contract.',
  ],
  tree: [
    'Register your first fleet vehicle on the platform.',
    'Define your dedicated PM portfolio clusters.',
    'Subscribe to advanced reporting cadences (NOI, capex, occupancy forecast).',
  ],
  forest: [
    'Carve operations into 2+ regions with their own ops + treasury.',
    'Configure treasury accounts (operating + reserve + escrow).',
    'Build the expansion pipeline using the expansion-advisor.',
  ],
  ecosystem: [
    'Configure 2+ jurisdictions with their compliance plugins.',
    'Enable the IR / AOR monthly report.',
    'Light up the ops command center for multi-region pulse.',
  ],
};

const NEXT_STEPS_SHRINK: Readonly<Record<OrgStage, ReadonlyArray<string>>> = {
  'pre-launch': [
    'Take your time to reset. Everything you previously configured is preserved.',
  ],
  seedling: [
    'Focus on the lease loop while you re-stabilise.',
  ],
  sprout: [
    'Continue using maintenance taxonomy and scheduled inspections at the smaller scale.',
  ],
  sapling: [
    'Procurement + inventory continue to be available; scale them with your portfolio.',
  ],
  tree: [
    'Fleet + dedicated PM workflows remain useful even at the lighter footprint.',
  ],
  forest: [
    'Regional ops and treasury remain available; consolidate when you are ready.',
  ],
  ecosystem: [
    'Multi-jurisdiction + IR/AOR stay enabled; we will not retire anything without explicit ask.',
  ],
};

/**
 * Get the structured narrative + capability deltas for a transition.
 * Returns `null` when `prev === curr` — caller can skip rendering.
 */
export function getTransition(
  prev: OrgStage,
  curr: OrgStage,
): StageTransition | null {
  if (prev === curr) return null;
  const kind = classify(prev, curr);
  const prevCard = STAGE_CARDS[prev];
  const currCard = STAGE_CARDS[curr];
  const capabilitiesToUnlock =
    kind === 'grow'
      ? diff(currCard.capabilitiesUnlocked, prevCard.capabilitiesUnlocked)
      : [];
  // Shrink doesn't auto-hide capabilities the org learned — we surface
  // them as "capabilitiesToReview" so the user can opt to hide them if
  // they really don't want to see them anymore.
  const capabilitiesToReview =
    kind === 'shrink'
      ? diff(prevCard.capabilitiesUnlocked, currCard.capabilitiesUnlocked)
      : [];

  const introductionMessage =
    kind === 'grow' ? GROW_MESSAGES[curr] : SHRINK_MESSAGES[curr];
  const recommendedNextSteps =
    kind === 'grow' ? NEXT_STEPS_GROW[curr] : NEXT_STEPS_SHRINK[curr];

  return {
    from: prev,
    to: curr,
    kind,
    introductionMessage,
    recommendedNextSteps,
    capabilitiesToUnlock,
    capabilitiesToReview,
  };
}

/**
 * Are the two stages contiguous in the lifecycle ladder? Useful when
 * the caller wants to distinguish "natural growth" (sapling→tree) from
 * "leapfrog" (seedling→tree) — typically only seen in M&A scenarios.
 */
export function isAdjacent(a: OrgStage, b: OrgStage): boolean {
  return Math.abs(stageIndex(a) - stageIndex(b)) === 1;
}
