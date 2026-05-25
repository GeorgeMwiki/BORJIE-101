/**
 * skill.org.query_organization — Mr. Mwikila's "talk to your organization"
 * skill. Wraps OrgQueryService (process-miner + bottleneck-detector +
 * improvement-tracker) as a ToolHandler for the orchestrator.
 *
 * The skill is stateless: the concrete OrgQueryService singleton is
 * injected at app boot via `buildQueryOrganizationTool`. Skill exposes a
 * small JSON-schema envelope so any LLM-driven router can invoke it.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import type { OrgAnswer } from '../../org-awareness/query-organization.js';

export const QueryOrganizationParamsSchema = z.object({
  question: z.string().min(1).max(500),
  tenantId: z.string().min(1).optional(),
});

export type QueryOrganizationParams = z.infer<
  typeof QueryOrganizationParamsSchema
>;

export interface QueryOrganizationServiceLike {
  answer(req: {
    readonly tenantId: string;
    readonly question: string;
  }): Promise<OrgAnswer>;
}

/**
 * Build a ToolHandler that the ToolDispatcher can register. The tool
 * reads tenantId from the execution context (preferred) and falls back
 * to params.tenantId if the context lacks one (unusual).
 */
export function buildQueryOrganizationTool(
  service: QueryOrganizationServiceLike,
): ToolHandler {
  return {
    name: 'skill.org.query_organization',
    description:
      'Answer an admin question about the tenant organization: bottlenecks, improvements since platform adoption, process statistics, or overall health. Returns a structured answer plus a blackboard block (before_after_chart / bottleneck_sankey / rolling_trend / status_summary).',
    parameters: {
      type: 'object',
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description: 'Natural-language admin question.',
        },
        tenantId: {
          type: 'string',
          description:
            'Optional explicit tenant override; default is the executing persona tenant.',
        },
      },
    },
    async execute(params, context) {
      const parsed = QueryOrganizationParamsSchema.safeParse(params);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }
      const tenantId =
        context?.tenant?.tenantId ?? parsed.data.tenantId ?? '';
      if (!tenantId) {
        return {
          ok: false,
          error:
            'query_organization: tenantId missing (neither persona context nor params supplied one)',
        };
      }
      try {
        const answer = await service.answer({
          tenantId,
          question: parsed.data.question,
        });
        return {
          ok: true,
          data: answer,
          evidenceSummary: answer.headline,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
  };
}
