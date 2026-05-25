/**
 * HR domain skill:
 *  - skill.hr.assign_to_team_member — rank team members for a task using
 *    skill match, current workload, and performance signals.
 *
 * Consumed by every Junior (they delegate to employees) and by the Coworker
 * persona when helping an employee "request permission" or "escalate".
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const AssignToTeamMemberParamsSchema = z.object({
  taskLabel: z.string().min(1).max(200),
  requiredSkills: z.array(z.string()).default([]),
  requiredLanguages: z.array(z.string()).default([]),
  coveredPropertyId: z.string().optional(),
  /** Team members in the candidate pool. */
  teamMembers: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        name: z.string().min(1),
        jobTitle: z.string().default(''),
        capabilities: z.record(z.string(), z.number().min(0).max(1)).default({}),
        languages: z.array(z.string()).default([]),
        coveredPropertyIds: z.array(z.string()).default([]),
        currentOpenAssignments: z.number().int().nonnegative().default(0),
        performanceScore: z.number().min(0).max(1).default(0.7),
        status: z
          .enum(['active', 'on_leave', 'suspended', 'pending_onboarding', 'terminated'])
          .default('active'),
      })
    )
    .min(1),
  urgency: z.enum(['low', 'medium', 'high', 'emergency']).default('medium'),
});

export interface HrAssignmentCandidate {
  employeeId: string;
  name: string;
  jobTitle: string;
  score: number;
  skillMatch: number;
  languageMatch: number;
  propertyCoverage: number;
  loadPenalty: number;
  performance: number;
  eligible: boolean;
  rationale: string;
}

export interface HrAssignmentResult {
  taskLabel: string;
  ranked: HrAssignmentCandidate[];
  recommended: HrAssignmentCandidate | null;
  ineligibleCount: number;
}

export function assignToTeamMember(
  rawParams: z.infer<typeof AssignToTeamMemberParamsSchema>
): HrAssignmentResult {
  // Apply schema defaults so direct callers (tests, internal code) get the
  // same behaviour as ToolHandler callers.
  const params = AssignToTeamMemberParamsSchema.parse(rawParams);
  const urgencyBoost = { low: 0.5, medium: 1, high: 1.3, emergency: 1.7 }[
    params.urgency
  ];
  const ranked = params.teamMembers.map((m) => {
    const eligible = m.status === 'active';
    const reqSkills = params.requiredSkills ?? [];
    const reqLangs = params.requiredLanguages ?? [];
    const skillScores = reqSkills.length
      ? reqSkills.map((s) => m.capabilities[s] ?? 0)
      : [1];
    const skillMatch = Math.min(...skillScores);

    const languageMatch = reqLangs.length
      ? reqLangs.every((l) => m.languages.includes(l))
        ? 1
        : 0.3
      : 1;

    const propertyCoverage = params.coveredPropertyId
      ? m.coveredPropertyIds.includes(params.coveredPropertyId) ||
        m.coveredPropertyIds.includes('*')
        ? 1
        : 0.2
      : 1;

    const loadPenalty = 1 / (1 + m.currentOpenAssignments * 0.3);

    const raw =
      0.4 * skillMatch +
      0.15 * languageMatch +
      0.15 * propertyCoverage +
      0.15 * loadPenalty +
      0.15 * m.performanceScore;

    const score = eligible ? raw * urgencyBoost : 0;

    return {
      employeeId: m.employeeId,
      name: m.name,
      jobTitle: m.jobTitle,
      score,
      skillMatch,
      languageMatch,
      propertyCoverage,
      loadPenalty,
      performance: m.performanceScore,
      eligible,
      rationale:
        `status=${m.status} ` +
        `skill=${skillMatch.toFixed(2)} ` +
        `lang=${languageMatch.toFixed(2)} ` +
        `prop=${propertyCoverage.toFixed(2)} ` +
        `load=${loadPenalty.toFixed(2)} ` +
        `perf=${m.performanceScore.toFixed(2)}`,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return {
    taskLabel: params.taskLabel,
    ranked,
    recommended: ranked[0]?.eligible ? ranked[0] : null,
    ineligibleCount: ranked.filter((r) => !r.eligible).length,
  };
}

export const assignToTeamMemberTool: ToolHandler = {
  name: 'skill.hr.assign_to_team_member',
  description:
    'Rank team members for a task by skill match, language, property coverage, current load, and performance. Urgency weights the score. Ineligible (on-leave/terminated/etc.) are scored 0.',
  parameters: {
    type: 'object',
    required: ['taskLabel', 'teamMembers'],
    properties: {
      taskLabel: { type: 'string' },
      requiredSkills: { type: 'array', items: { type: 'string' } },
      requiredLanguages: { type: 'array', items: { type: 'string' } },
      coveredPropertyId: { type: 'string' },
      teamMembers: { type: 'array', items: { type: 'object' } },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'emergency'],
      },
    },
  },
  async execute(params) {
    const parsed = AssignToTeamMemberParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = assignToTeamMember(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: result.recommended
        ? `Recommend ${result.recommended.name} (score=${result.recommended.score.toFixed(2)})`
        : `No eligible candidate among ${result.ranked.length}`,
    };
  },
};

export const HR_SKILL_TOOLS: ToolHandler[] = [assignToTeamMemberTool];
