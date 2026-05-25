/**
 * Maintenance domain skills:
 *  - skill.maintenance.triage          — classify + score a maintenance request
 *  - skill.maintenance.assign_work_order — rank vendors/caretakers for a work order
 *
 * The classifier is deterministic and keyword-driven (auditable). The ranker
 * is a weighted score over skill match, current load, historical completion,
 * and proximity. Both are dependency-free so the Orchestrator can run them
 * without a live DB (tests, evals, development).
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

// ---------------------------------------------------------------------------
// skill.maintenance.triage
// ---------------------------------------------------------------------------

export const TriageCategory = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  HVAC: 'hvac',
  APPLIANCE: 'appliance',
  STRUCTURAL: 'structural',
  PEST: 'pest',
  LANDSCAPING: 'landscaping',
  SECURITY: 'security',
  OTHER: 'other',
} as const;
export type TriageCategory =
  (typeof TriageCategory)[keyof typeof TriageCategory];

export const TriageSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  EMERGENCY: 'emergency',
} as const;
export type TriageSeverity =
  (typeof TriageSeverity)[keyof typeof TriageSeverity];

export const MaintenanceTriageParamsSchema = z.object({
  description: z.string().min(1).max(5_000),
  unitId: z.string().optional(),
  reportedAt: z.string().optional(),
  /** Temperature 0..1; low temp = deterministic, high = model-driven later. */
  temperature: z.number().min(0).max(1).default(0),
});

export interface MaintenanceTriageResult {
  category: TriageCategory;
  severity: TriageSeverity;
  isEmergency: boolean;
  suggestedSlaHours: number;
  keywords: string[];
  rationale: string;
}

const CATEGORY_PATTERNS: Array<{ cat: TriageCategory; re: RegExp }> = [
  { cat: 'plumbing', re: /\b(leak|pipe|tap|faucet|toilet|drain|sewer|sink|water|flood|burst)\b/i },
  { cat: 'electrical', re: /\b(electric|power|wiring|socket|outlet|breaker|shock|spark|bulb|light)\b/i },
  { cat: 'hvac', re: /\b(ac|air[- ]?con|hvac|heat(?:ing)?|cool(?:ing)?|vent|fan)\b/i },
  { cat: 'appliance', re: /\b(fridge|refrigerator|oven|stove|cooker|microwave|washing machine|dishwasher)\b/i },
  { cat: 'structural', re: /\b(wall|ceiling|roof|floor|door|window|crack|collapse|tile)\b/i },
  { cat: 'pest', re: /\b(rat|mice|cockroach|bed ?bug|termite|pest|infestation|ants?)\b/i },
  { cat: 'landscaping', re: /\b(garden|grass|lawn|tree|hedge|landscap)\b/i },
  { cat: 'security', re: /\b(gate|fence|alarm|cctv|camera|lock|break[- ]?in)\b/i },
];

const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(flood(?:ing)?|burst|gas leak|fire|smoke|electrocut|ceiling collaps|sewage)\b/i,
  /\b(no water for \d+ days|power out (?:for )?\d+ days)\b/i,
  /\b(burst pipe|major leak|flooding (?:into|below))\b/i,
];

const HIGH_PATTERNS: RegExp[] = [
  /\b(no (?:hot )?water|no power|no electricity|broken lock|broken window|cannot lock)\b/i,
  /\b(fridge (?:not working|broken)|toilet (?:not working|blocked))\b/i,
];

export function triageMaintenance(
  params: z.infer<typeof MaintenanceTriageParamsSchema>
): MaintenanceTriageResult {
  const text = params.description;
  const keywords: string[] = [];
  let category: TriageCategory = 'other';
  for (const { cat, re } of CATEGORY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      category = cat;
      keywords.push(m[0].toLowerCase());
      break;
    }
  }

  let severity: TriageSeverity = 'low';
  let isEmergency = false;
  if (EMERGENCY_PATTERNS.some((re) => re.test(text))) {
    severity = 'emergency';
    isEmergency = true;
  } else if (HIGH_PATTERNS.some((re) => re.test(text))) {
    severity = 'high';
  } else if (/\b(urgent|asap|today|immediately)\b/i.test(text)) {
    severity = 'high';
  } else if (/\b(soon|this week|please)\b/i.test(text)) {
    severity = 'medium';
  }

  const slaMap: Record<TriageSeverity, number> = {
    emergency: 2,
    high: 24,
    medium: 72,
    low: 168, // one week
  };

  return {
    category,
    severity,
    isEmergency,
    suggestedSlaHours: slaMap[severity],
    keywords,
    rationale: `category_match:${category}${keywords.length ? `(${keywords.join(',')})` : ''};severity:${severity}`,
  };
}

export const maintenanceTriageTool: ToolHandler = {
  name: 'skill.maintenance.triage',
  description:
    'Classify a maintenance request by category (plumbing/electrical/etc.) and severity. Detects emergencies (flood, gas leak, fire). Returns suggested SLA.',
  parameters: {
    type: 'object',
    required: ['description'],
    properties: {
      description: { type: 'string' },
      unitId: { type: 'string' },
      reportedAt: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = MaintenanceTriageParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = triageMaintenance(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Triage: ${result.category}/${result.severity}${result.isEmergency ? ' (EMERGENCY)' : ''}, SLA ${result.suggestedSlaHours}h`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.maintenance.assign_work_order
// ---------------------------------------------------------------------------

export const AssignWorkOrderParamsSchema = z.object({
  workOrderId: z.string().min(1),
  requiredSkills: z.array(z.string()).min(1),
  /** Candidate pool — filtered by the caller to the team/vendor universe. */
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        skills: z.record(z.string(), z.number().min(0).max(1)).default({}),
        currentOpenJobs: z.number().int().nonnegative().default(0),
        completionRate30d: z.number().min(0).max(1).default(0.8),
        avgTimeToCloseHours: z.number().nonnegative().default(48),
        distanceKm: z.number().nonnegative().default(5),
      })
    )
    .min(1),
  urgency: z.enum(['low', 'medium', 'high', 'emergency']).default('medium'),
});

export interface AssignmentCandidate {
  id: string;
  name: string;
  score: number;
  skillMatch: number;
  loadPenalty: number;
  reliability: number;
  proximity: number;
  rationale: string;
}

export interface AssignWorkOrderResult {
  workOrderId: string;
  ranked: AssignmentCandidate[];
  recommended: AssignmentCandidate | null;
}

export function rankAssignees(
  params: z.infer<typeof AssignWorkOrderParamsSchema>
): AssignWorkOrderResult {
  const urgencyWeight = { low: 0.5, medium: 1, high: 1.4, emergency: 1.8 }[
    params.urgency
  ];
  const ranked: AssignmentCandidate[] = params.candidates.map((c) => {
    // Skill match — min across required skills so a missing skill tanks score.
    const skillScores = params.requiredSkills.map((s) => c.skills[s] ?? 0);
    const skillMatch = skillScores.length
      ? Math.min(...skillScores)
      : 0;

    // Load penalty — 0..1, higher = better (less loaded)
    const loadPenalty = 1 / (1 + c.currentOpenJobs * 0.25);

    // Reliability — completion rate weighted by closing speed
    const speed = Math.max(0.2, Math.min(1, 48 / (c.avgTimeToCloseHours || 48)));
    const reliability = 0.7 * c.completionRate30d + 0.3 * speed;

    // Proximity — 0..1, 10km → 0.5, 1km → ~0.91
    const proximity = 1 / (1 + c.distanceKm * 0.1);

    const score =
      (0.45 * skillMatch + 0.2 * reliability + 0.15 * loadPenalty + 0.2 * proximity) *
      urgencyWeight;

    return {
      id: c.id,
      name: c.name,
      score,
      skillMatch,
      loadPenalty,
      reliability,
      proximity,
      rationale:
        `skill=${skillMatch.toFixed(2)} ` +
        `reliab=${reliability.toFixed(2)} ` +
        `load=${loadPenalty.toFixed(2)} ` +
        `prox=${proximity.toFixed(2)}`,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return {
    workOrderId: params.workOrderId,
    ranked,
    recommended: ranked[0] ?? null,
  };
}

export const assignWorkOrderTool: ToolHandler = {
  name: 'skill.maintenance.assign_work_order',
  description:
    'Rank candidate caretakers/vendors for a work order by skill match, load, reliability, and proximity, weighted by urgency.',
  parameters: {
    type: 'object',
    required: ['workOrderId', 'requiredSkills', 'candidates'],
    properties: {
      workOrderId: { type: 'string' },
      requiredSkills: { type: 'array', items: { type: 'string' } },
      candidates: { type: 'array', items: { type: 'object' } },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'emergency'],
        default: 'medium',
      },
    },
  },
  async execute(params) {
    const parsed = AssignWorkOrderParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = rankAssignees(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: result.recommended
        ? `Recommend ${result.recommended.name} (score=${result.recommended.score.toFixed(2)})`
        : 'No suitable candidate found',
    };
  },
};

export const MAINTENANCE_SKILL_TOOLS: ToolHandler[] = [
  maintenanceTriageTool,
  assignWorkOrderTool,
];
