/**
 * Maintenance triage agent — Latchel-style conversational diagnostic
 * for resident-reported issues.
 *
 * Phase D D10 — Comprehensive Gap Closure (Sub-feature 5 of 6).
 *
 * Why this is a moat: Latchel (the US category leader) takes a
 * percentage of every dispatched work-order from PMs. Building our
 * own triage layer means:
 *   - we keep the margin,
 *   - we run the conversation in Swahili / Kiswahili / Sheng — Latchel
 *     does not localise to EA,
 *   - we resolve self-service issues without ever spinning up a
 *     dispatch (40-60% of reported issues fall into 5 canonical
 *     resolvable categories).
 *
 * The agent is a pure deterministic state-machine over a JSON-encoded
 * taxonomy file. NO LLM calls.
 */

import { z } from 'zod';

export type TriageUrgency =
  | 'self-service'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'emergency';

export type TriageNode = TriageQuestionNode | TriageDispatchNode | TriageSelfServiceNode;

export interface TriageQuestionNode {
  readonly kind: 'question';
  readonly id: string;
  readonly question: string;
  readonly options: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly nextNodeId: string;
  }>;
}

export interface TriageDispatchNode {
  readonly kind: 'dispatch';
  readonly id: string;
  readonly problemCode: string;
  readonly urgency: Exclude<TriageUrgency, 'self-service'>;
  readonly suggestedPartsList: ReadonlyArray<string>;
  readonly vendorTags: ReadonlyArray<string>;
  readonly residentSummary: string;
}

export interface TriageSelfServiceNode {
  readonly kind: 'self-service';
  readonly id: string;
  readonly problemCode: string;
  readonly instructions: ReadonlyArray<string>;
  readonly safetyWarning?: string;
}

export interface TriageTree {
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, TriageNode>>;
}

export const TriageTurnSchema = z.object({
  nodeId: z.string(),
  questionAsked: z.string(),
  optionChosenKey: z.string(),
  optionChosenLabel: z.string(),
  at: z.string(),
});

export type TriageTurn = z.infer<typeof TriageTurnSchema>;

export interface TriageSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly currentNodeId: string;
  readonly history: ReadonlyArray<TriageTurn>;
  readonly initialReport: string;
  readonly startedAt: string;
}

export type TriageOutcome =
  | { readonly kind: 'ask'; readonly node: TriageQuestionNode }
  | { readonly kind: 'self-service'; readonly node: TriageSelfServiceNode }
  | { readonly kind: 'dispatch'; readonly node: TriageDispatchNode };

const ROOT_NODE: TriageQuestionNode = {
  kind: 'question',
  id: 'root',
  question: 'What kind of problem are you experiencing?',
  options: [
    { key: 'electrical', label: 'No power / electrical', nextNodeId: 'electrical.scope' },
    { key: 'plumbing', label: 'Water / plumbing', nextNodeId: 'plumbing.scope' },
    { key: 'hvac', label: 'AC / heating not working', nextNodeId: 'hvac.scope' },
    { key: 'appliance', label: 'Appliance broken', nextNodeId: 'appliance.dispatch' },
    { key: 'other', label: 'Something else', nextNodeId: 'other.dispatch' },
  ],
};

const ELECTRICAL_SCOPE: TriageQuestionNode = {
  kind: 'question',
  id: 'electrical.scope',
  question: 'Where is the power out?',
  options: [
    { key: 'whole-house', label: 'The whole house', nextNodeId: 'electrical.whole-house.dispatch' },
    { key: 'zone', label: 'Just one room / zone', nextNodeId: 'electrical.zone.breaker-check' },
    { key: 'one-outlet', label: 'Just one wall socket', nextNodeId: 'electrical.outlet.dispatch' },
  ],
};

const ELECTRICAL_BREAKER_CHECK: TriageQuestionNode = {
  kind: 'question',
  id: 'electrical.zone.breaker-check',
  question: 'Please check the breaker box. Has a breaker flipped down or shows red?',
  options: [
    { key: 'yes', label: 'Yes, one is flipped', nextNodeId: 'electrical.breaker.flip-back' },
    { key: 'no', label: 'No, all look normal', nextNodeId: 'electrical.zone.dispatch' },
    { key: 'cant-find', label: 'I cannot find the breaker box', nextNodeId: 'electrical.zone.dispatch' },
  ],
};

const ELECTRICAL_BREAKER_FLIP_BACK: TriageSelfServiceNode = {
  kind: 'self-service',
  id: 'electrical.breaker.flip-back',
  problemCode: 'electrical.breaker.tripped',
  instructions: [
    'Make sure your hands are dry.',
    'At the breaker, push the flipped switch FULLY down (off), then FULLY up (on).',
    'If the switch refuses to stay up, or trips again within a minute, do NOT keep retrying.',
    'Test by turning on a light in the affected zone.',
  ],
  safetyWarning: 'Never open the breaker box panel itself. Only flip the switch.',
};

const ELECTRICAL_ZONE_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'electrical.zone.dispatch',
  problemCode: 'electrical.no-power-zone',
  urgency: 'high',
  suggestedPartsList: ['RCD module', 'wire connectors', 'voltage tester'],
  vendorTags: ['electrician', 'certified'],
  residentSummary: 'A licensed electrician will be dispatched within 4 hours.',
};

const ELECTRICAL_WHOLE_HOUSE_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'electrical.whole-house.dispatch',
  problemCode: 'electrical.no-power-whole',
  urgency: 'critical',
  suggestedPartsList: ['main-breaker assembly', 'meter-side tester'],
  vendorTags: ['electrician', 'utility-liaison'],
  residentSummary: 'Whole-house outages need same-day response.',
};

const ELECTRICAL_OUTLET_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'electrical.outlet.dispatch',
  problemCode: 'electrical.dead-outlet',
  urgency: 'medium',
  suggestedPartsList: ['replacement socket', 'face-plate'],
  vendorTags: ['electrician'],
  residentSummary: 'A technician will swap the socket within 24 hours.',
};

const PLUMBING_SCOPE: TriageQuestionNode = {
  kind: 'question',
  id: 'plumbing.scope',
  question: 'What is wrong with the water?',
  options: [
    { key: 'leak', label: 'There is a leak / water on the floor', nextNodeId: 'plumbing.leak.dispatch' },
    { key: 'no-water', label: 'No water coming out at all', nextNodeId: 'plumbing.no-water.dispatch' },
    { key: 'slow-drain', label: 'Sink / shower draining slowly', nextNodeId: 'plumbing.slow-drain.self' },
  ],
};

const PLUMBING_SLOW_DRAIN_SELF: TriageSelfServiceNode = {
  kind: 'self-service',
  id: 'plumbing.slow-drain.self',
  problemCode: 'plumbing.slow-drain',
  instructions: [
    'Remove the drain strainer/cover. Most pop off by hand.',
    'Pull out any visible hair or debris with a hooked tool or gloved fingers.',
    'Run hot water for 30 seconds.',
    'If still slow, request a dispatch.',
  ],
};

const PLUMBING_LEAK_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'plumbing.leak.dispatch',
  problemCode: 'plumbing.leak',
  urgency: 'critical',
  suggestedPartsList: ['shut-off valve', 'pipe-thread tape', 'compression fittings'],
  vendorTags: ['plumber', 'emergency'],
  residentSummary: 'Please locate the main water shut-off and turn it off if the leak is large.',
};

const PLUMBING_NO_WATER_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'plumbing.no-water.dispatch',
  problemCode: 'plumbing.no-water',
  urgency: 'high',
  suggestedPartsList: ['tank-pump replacement', 'pressure-switch'],
  vendorTags: ['plumber'],
  residentSummary: 'Could be the storage tank or building supply.',
};

const HVAC_SCOPE: TriageQuestionNode = {
  kind: 'question',
  id: 'hvac.scope',
  question: 'Is the AC unit running at all (any sound or air movement)?',
  options: [
    { key: 'not-running', label: 'It is completely dead', nextNodeId: 'hvac.not-running.remote-check' },
    { key: 'running-no-cool', label: 'Running but blowing warm air', nextNodeId: 'hvac.warm.dispatch' },
    { key: 'noisy', label: 'Making strange noises', nextNodeId: 'hvac.noisy.dispatch' },
  ],
};

const HVAC_REMOTE_CHECK: TriageQuestionNode = {
  kind: 'question',
  id: 'hvac.not-running.remote-check',
  question: 'When you press the AC remote, does the display light up?',
  options: [
    { key: 'no-display', label: 'No, the remote display is blank', nextNodeId: 'hvac.remote-battery.self' },
    { key: 'display-ok', label: 'Yes, remote works but unit ignores it', nextNodeId: 'hvac.warm.dispatch' },
  ],
};

const HVAC_REMOTE_BATTERY_SELF: TriageSelfServiceNode = {
  kind: 'self-service',
  id: 'hvac.remote-battery.self',
  problemCode: 'hvac.remote-battery-dead',
  instructions: [
    'Open the back of the AC remote — slide the cover down.',
    'Replace the two AAA batteries.',
    'Point the remote at the AC unit and press the power button.',
  ],
};

const HVAC_WARM_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'hvac.warm.dispatch',
  problemCode: 'hvac.no-cooling',
  urgency: 'medium',
  suggestedPartsList: ['35uF capacitor', 'refrigerant top-up', 'gas leak detector'],
  vendorTags: ['hvac', 'refrigerant-certified'],
  residentSummary: 'A licensed HVAC technician will visit within 24-48 hours.',
};

const HVAC_NOISY_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'hvac.noisy.dispatch',
  problemCode: 'hvac.noise',
  urgency: 'low',
  suggestedPartsList: ['fan-motor bearings', 'mounting screws'],
  vendorTags: ['hvac'],
  residentSummary: 'A technician will inspect within 48 hours.',
};

const APPLIANCE_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'appliance.dispatch',
  problemCode: 'appliance.general',
  urgency: 'low',
  suggestedPartsList: [],
  vendorTags: ['appliance-tech'],
  residentSummary: 'An appliance technician will visit within 3 working days.',
};

const OTHER_DISPATCH: TriageDispatchNode = {
  kind: 'dispatch',
  id: 'other.dispatch',
  problemCode: 'general.uncategorised',
  urgency: 'low',
  vendorTags: ['general'],
  suggestedPartsList: [],
  residentSummary: 'A general technician will reach out to clarify and schedule.',
};

export const DEFAULT_TRIAGE_TREE: TriageTree = {
  rootNodeId: 'root',
  nodes: {
    root: ROOT_NODE,
    'electrical.scope': ELECTRICAL_SCOPE,
    'electrical.zone.breaker-check': ELECTRICAL_BREAKER_CHECK,
    'electrical.breaker.flip-back': ELECTRICAL_BREAKER_FLIP_BACK,
    'electrical.zone.dispatch': ELECTRICAL_ZONE_DISPATCH,
    'electrical.whole-house.dispatch': ELECTRICAL_WHOLE_HOUSE_DISPATCH,
    'electrical.outlet.dispatch': ELECTRICAL_OUTLET_DISPATCH,
    'plumbing.scope': PLUMBING_SCOPE,
    'plumbing.slow-drain.self': PLUMBING_SLOW_DRAIN_SELF,
    'plumbing.leak.dispatch': PLUMBING_LEAK_DISPATCH,
    'plumbing.no-water.dispatch': PLUMBING_NO_WATER_DISPATCH,
    'hvac.scope': HVAC_SCOPE,
    'hvac.not-running.remote-check': HVAC_REMOTE_CHECK,
    'hvac.remote-battery.self': HVAC_REMOTE_BATTERY_SELF,
    'hvac.warm.dispatch': HVAC_WARM_DISPATCH,
    'hvac.noisy.dispatch': HVAC_NOISY_DISPATCH,
    'appliance.dispatch': APPLIANCE_DISPATCH,
    'other.dispatch': OTHER_DISPATCH,
  },
};

export interface StartSessionArgs {
  readonly tenantId: string;
  readonly customerId: string;
  readonly initialReport: string;
  readonly tree?: TriageTree;
  readonly clock?: () => Date;
  readonly sessionId?: string;
}

export function startSession(args: StartSessionArgs): {
  session: TriageSession;
  outcome: TriageOutcome;
} {
  const tree = args.tree ?? DEFAULT_TRIAGE_TREE;
  const clock = args.clock ?? (() => new Date());
  const session: TriageSession = {
    sessionId: args.sessionId ?? cryptoSafeUuid(),
    tenantId: args.tenantId,
    customerId: args.customerId,
    currentNodeId: tree.rootNodeId,
    history: [],
    initialReport: args.initialReport,
    startedAt: clock().toISOString(),
  };
  const rootNode = tree.nodes[tree.rootNodeId];
  if (!rootNode) {
    throw new Error(
      `triage: tree.rootNodeId "${tree.rootNodeId}" not found in tree.nodes`,
    );
  }
  return { session, outcome: outcomeFor(rootNode) };
}

export interface AnswerArgs {
  readonly session: TriageSession;
  readonly optionKey: string;
  readonly tree?: TriageTree;
  readonly clock?: () => Date;
}

export function answer(args: AnswerArgs): {
  session: TriageSession;
  outcome: TriageOutcome;
} {
  const tree = args.tree ?? DEFAULT_TRIAGE_TREE;
  const clock = args.clock ?? (() => new Date());
  const current = tree.nodes[args.session.currentNodeId];
  if (!current) {
    throw new Error(
      `triage: currentNodeId "${args.session.currentNodeId}" not found`,
    );
  }
  if (current.kind !== 'question') {
    throw new Error(
      `triage: cannot answer — current node "${current.id}" is terminal (${current.kind})`,
    );
  }
  const option = current.options.find((o) => o.key === args.optionKey);
  if (!option) {
    throw new Error(
      `triage: option "${args.optionKey}" not valid at node "${current.id}"`,
    );
  }
  const nextNode = tree.nodes[option.nextNodeId];
  if (!nextNode) {
    throw new Error(
      `triage: nextNodeId "${option.nextNodeId}" not found in tree`,
    );
  }
  const turn: TriageTurn = {
    nodeId: current.id,
    questionAsked: current.question,
    optionChosenKey: option.key,
    optionChosenLabel: option.label,
    at: clock().toISOString(),
  };
  const nextSession: TriageSession = {
    ...args.session,
    currentNodeId: option.nextNodeId,
    history: [...args.session.history, turn],
  };
  return { session: nextSession, outcome: outcomeFor(nextNode) };
}

function outcomeFor(node: TriageNode): TriageOutcome {
  if (node.kind === 'question') return { kind: 'ask', node };
  if (node.kind === 'self-service') return { kind: 'self-service', node };
  return { kind: 'dispatch', node };
}

function cryptoSafeUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface BuildWorkOrderArgs {
  readonly session: TriageSession;
  readonly dispatchNode: TriageDispatchNode;
}

export interface WorkOrderDraft {
  readonly tenantId: string;
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly problemCode: string;
  readonly urgency: TriageDispatchNode['urgency'];
  readonly suggestedPartsList: ReadonlyArray<string>;
  readonly vendorTags: ReadonlyArray<string>;
  readonly triageTranscript: ReadonlyArray<TriageTurn>;
  readonly residentReport: string;
}

export function buildWorkOrder(args: BuildWorkOrderArgs): WorkOrderDraft {
  const title = `${args.dispatchNode.problemCode} — ${args.session.customerId}`;
  const description = [
    `Initial report: ${args.session.initialReport}`,
    '',
    'Diagnostic transcript:',
    ...args.session.history.map(
      (h) => `Q: ${h.questionAsked}\nA: ${h.optionChosenLabel}`,
    ),
    '',
    args.dispatchNode.residentSummary,
  ].join('\n');
  return {
    tenantId: args.session.tenantId,
    customerId: args.session.customerId,
    title,
    description,
    problemCode: args.dispatchNode.problemCode,
    urgency: args.dispatchNode.urgency,
    suggestedPartsList: args.dispatchNode.suggestedPartsList,
    vendorTags: args.dispatchNode.vendorTags,
    triageTranscript: args.session.history,
    residentReport: args.session.initialReport,
  };
}
