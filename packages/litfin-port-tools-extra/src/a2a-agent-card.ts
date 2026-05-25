/**
 * A2A (agent-to-agent) — tuned agent-card format.
 *
 * LITFIN ref: src/core/agent-platform/* — declarative description of
 * an agent's capabilities, auth modes, skill graph, and policy.
 * Aligned with the A2A 0.2 draft spec.
 */

import { z } from 'zod';

export const A2ASkill = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** Free-form tags for discovery. */
  tags: z.array(z.string()).default([]),
  /** Whether the skill mutates state or is read-only. */
  sideEffects: z.boolean().default(false),
});
export type A2ASkill = z.infer<typeof A2ASkill>;

export const A2AAuthMode = z.enum(['none', 'api-key', 'oauth2', 'mtls', 'jwt-bearer']);
export type A2AAuthMode = z.infer<typeof A2AAuthMode>;

export const A2AAgentCard = z
  .object({
    name: z.string().min(1).max(80),
    version: z.string().min(1),
    description: z.string().min(1).max(1000),
    publisher: z.string().min(1),
    endpoints: z.object({
      invoke: z.string().url(),
      health: z.string().url(),
    }),
    auth: z.object({
      modes: z.array(A2AAuthMode).min(1),
    }),
    skills: z.array(A2ASkill).min(1),
    /** Per-A2A spec — JSON Web Key Set URL. */
    jwksUri: z.string().url().optional(),
    /** Optional policy URI describing rate limits, cost, terms. */
    policyUri: z.string().url().optional(),
    /** Coarse SLA promise. */
    sla: z
      .object({
        latencyP95Ms: z.number().int().positive(),
        availabilityRatio: z.number().min(0).max(1),
      })
      .optional(),
  })
  .strict();
export type A2AAgentCard = z.infer<typeof A2AAgentCard>;

export const validateAgentCard = (
  raw: unknown,
):
  | { readonly ok: true; readonly card: A2AAgentCard }
  | { readonly ok: false; readonly errors: readonly string[] } => {
  const parsed = A2AAgentCard.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  return { ok: true, card: parsed.data };
};

export interface CardBuilderInput {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly publisher: string;
  readonly baseUrl: string;
  readonly authModes: readonly A2AAuthMode[];
  readonly skills: readonly A2ASkill[];
}

export const buildAgentCard = (input: CardBuilderInput): A2AAgentCard =>
  A2AAgentCard.parse({
    name: input.name,
    version: input.version,
    description: input.description,
    publisher: input.publisher,
    endpoints: {
      invoke: `${input.baseUrl.replace(/\/$/, '')}/a2a/invoke`,
      health: `${input.baseUrl.replace(/\/$/, '')}/a2a/health`,
    },
    auth: { modes: input.authModes },
    skills: input.skills,
  });

/** Match a request's required tags against an agent's skill set. */
export const findCapableSkills = (
  card: A2AAgentCard,
  requiredTags: readonly string[],
): readonly A2ASkill[] => {
  const need = new Set(requiredTags);
  return card.skills.filter((s) => s.tags.some((t) => need.has(t)));
};
