/**
 * proposeSkill — emit a SKILL.md proposal after a successful task.
 *
 * The proposal lands in `.claude/skills/_proposed/<slug>/SKILL.md`, NEVER
 * directly in `.claude/skills/<slug>/`. Promotion is gated by K-C's HITL
 * subagent (per M-F) — `promoteSkill` is a thin wrapper that enforces the
 * dual-control rule.
 */

import {
  type PromotionDecision,
  type SkillProposal,
  type SkillProposalInput,
} from './types.js';

const SLUG_FORBIDDEN = /[^a-z0-9-]/g;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(SLUG_FORBIDDEN, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unnamed-skill';
}

export function proposeSkill(
  input: SkillProposalInput,
  nowIso: string = new Date().toISOString(),
): SkillProposal {
  if (!input.taskClass || input.taskClass.trim().length === 0) {
    throw new Error('proposeSkill: taskClass is required.');
  }
  if (!input.jurisdiction || input.jurisdiction.trim().length === 0) {
    throw new Error('proposeSkill: jurisdiction is required.');
  }
  if (input.successConditions.length === 0) {
    throw new Error('proposeSkill: successConditions is required (>=1).');
  }
  const slug = slugify(`${input.taskClass}-${input.jurisdiction}`);
  const proposedPath = `.claude/skills/_proposed/${slug}/SKILL.md`;

  const frontmatter = {
    name: slug,
    description: input.summary,
    taskClass: input.taskClass,
    jurisdiction: input.jurisdiction,
    successConditions: input.successConditions,
    proposedAt: nowIso,
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
  };

  const body = renderBody(input);
  const fileContents = renderFile(frontmatter, body);

  return Object.freeze<SkillProposal>({
    proposedPath,
    frontmatter: Object.freeze({ ...frontmatter }),
    body,
    fileContents,
  });
}

function renderBody(input: SkillProposalInput): string {
  const lines: string[] = [];
  lines.push('# When to use');
  lines.push(input.summary);
  lines.push('');
  lines.push('# Steps');
  for (const s of input.steps) lines.push(`1. ${s}`);
  lines.push('');
  lines.push('# Verification');
  for (const v of input.verification) lines.push(`- ${v}`);
  lines.push('');
  if (input.modifiedFiles.length > 0) {
    lines.push('# Files this skill typically touches');
    for (const f of input.modifiedFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }
  lines.push('# Status');
  lines.push(
    '_PROPOSED — awaits K-C HITL promotion. Do not auto-discover until promoted._',
  );
  return lines.join('\n');
}

function renderFile(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const fm = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      fm.push(`${k}:`);
      for (const item of v) fm.push(`  - ${JSON.stringify(item)}`);
    } else if (v !== undefined) {
      fm.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  fm.push('---');
  fm.push('');
  fm.push(body);
  return fm.join('\n');
}

/**
 * The HITL promotion gate. Always returns `pending` unless a verified
 * approver id is supplied — `auto-promote` is intentionally not possible.
 */
export function promoteSkill(args: {
  proposal: SkillProposal;
  approverId?: string;
  approverScopes?: readonly string[];
  rejected?: { reason: string };
}): PromotionDecision {
  if (args.rejected) {
    return { kind: 'rejected', reason: args.rejected.reason };
  }
  if (!args.approverId) {
    return { kind: 'pending', queuedAt: new Date().toISOString() };
  }
  // M-F gate: approver must hold the `skill:promote` scope.
  const scopes = args.approverScopes ?? [];
  if (!scopes.includes('skill:promote')) {
    return {
      kind: 'rejected',
      reason: `Approver "${args.approverId}" lacks scope "skill:promote".`,
    };
  }
  const promotedPath = args.proposal.proposedPath.replace(
    '/skills/_proposed/',
    '/skills/',
  );
  return {
    kind: 'promoted',
    promotedPath,
    approverId: args.approverId,
  };
}
