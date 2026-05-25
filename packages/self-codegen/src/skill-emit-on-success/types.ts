/**
 * Skill emit on success — Voyager-compounding.
 *
 * Pattern #8 from R-CODEGEN: after every successful self-codegen task the
 * brain proposes a new `SKILL.md`. The skill is auto-tagged with task class
 * · jurisdiction · success conditions, then routed through K-C HITL
 * promotion (per M-F) — never auto-promoted.
 */

export interface SkillProposalInput {
  readonly taskClass: string;
  readonly jurisdiction: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly verification: readonly string[];
  readonly successConditions: readonly string[];
  readonly tenantId?: string;
  readonly modifiedFiles: readonly string[];
}

export interface SkillProposal {
  /** Path inside `.claude/skills/_proposed/` (never auto-promoted). */
  readonly proposedPath: string;
  readonly frontmatter: {
    readonly name: string;
    readonly description: string;
    readonly taskClass: string;
    readonly jurisdiction: string;
    readonly successConditions: readonly string[];
    readonly proposedAt: string;
    readonly tenantId?: string;
  };
  readonly body: string;
  /** The full SKILL.md as it should land on disk. */
  readonly fileContents: string;
}

export type PromotionDecision =
  | { kind: 'promoted'; promotedPath: string; approverId: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'pending'; queuedAt: string };
