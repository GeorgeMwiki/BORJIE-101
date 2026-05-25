/**
 * MCP server formatters — Slack / Linear / GitHub message shapes.
 *
 * LITFIN ref: src/core/mcp/* — payload-builders tuned to the
 * upstream API quirks. We export the pure formatters so any MCP
 * implementation (stdio, HTTP, SSE) can use them.
 */

import { z } from 'zod';

// --------------------------------------------------------------------
// Slack — chat.postMessage payload with rich blocks.
// --------------------------------------------------------------------

export const SlackMessage = z.object({
  channel: z.string().min(1),
  text: z.string().min(1).max(40_000),
  blocks: z.array(z.unknown()).optional(),
  threadTs: z.string().optional(),
  unfurlLinks: z.boolean().optional(),
});
export type SlackMessage = z.infer<typeof SlackMessage>;

export interface SlackFormatInput {
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly threadTs?: string;
  readonly mentions?: readonly string[];
}

export const formatSlackMessage = (input: SlackFormatInput): SlackMessage => {
  const mentionsLine =
    input.mentions !== undefined && input.mentions.length > 0
      ? input.mentions.map((m) => `<@${m}>`).join(' ') + '\n'
      : '';
  const bulletLines =
    input.bullets !== undefined && input.bullets.length > 0
      ? '\n' + input.bullets.map((b) => `• ${b}`).join('\n')
      : '';
  const text = `*${input.title}*\n${mentionsLine}${input.body}${bulletLines}`;
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: input.title } },
    { type: 'section', text: { type: 'mrkdwn', text: input.body } },
  ];
  if (input.bullets !== undefined && input.bullets.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: input.bullets.map((b) => `• ${b}`).join('\n') },
    });
  }
  return SlackMessage.parse({
    channel: input.channel,
    text,
    blocks,
    ...(input.threadTs !== undefined ? { threadTs: input.threadTs } : {}),
    unfurlLinks: false,
  });
};

// --------------------------------------------------------------------
// Linear — issue.create payload.
// --------------------------------------------------------------------

export const LinearIssueCreate = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  labels: z.array(z.string().uuid()).optional(),
  assigneeId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  estimate: z.number().int().min(0).optional(),
});
export type LinearIssueCreate = z.infer<typeof LinearIssueCreate>;

export interface LinearFormatInput {
  readonly teamId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: 'urgent' | 'high' | 'medium' | 'low';
  readonly labelIds?: readonly string[];
  readonly assigneeId?: string;
  readonly estimate?: number;
}

const PRIORITY_MAP = { urgent: 1, high: 2, medium: 3, low: 4 } as const;

export const formatLinearIssue = (input: LinearFormatInput): LinearIssueCreate =>
  LinearIssueCreate.parse({
    teamId: input.teamId,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.priority !== undefined ? { priority: PRIORITY_MAP[input.priority] } : {}),
    ...(input.labelIds !== undefined ? { labels: input.labelIds } : {}),
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    ...(input.estimate !== undefined ? { estimate: input.estimate } : {}),
  });

// --------------------------------------------------------------------
// GitHub — PR body template.
// --------------------------------------------------------------------

export interface GitHubPRFormatInput {
  readonly title: string;
  readonly summaryBullets: readonly string[];
  readonly testPlan?: readonly string[];
  readonly relatedIssues?: readonly string[];
  readonly breakingChanges?: readonly string[];
}

export interface GitHubPRPayload {
  readonly title: string;
  readonly body: string;
}

export const formatGitHubPR = (input: GitHubPRFormatInput): GitHubPRPayload => {
  const lines: string[] = [];
  lines.push('## Summary', '', ...input.summaryBullets.map((b) => `- ${b}`), '');
  if (input.testPlan !== undefined && input.testPlan.length > 0) {
    lines.push('## Test plan', '', ...input.testPlan.map((t) => `- [ ] ${t}`), '');
  }
  if (input.breakingChanges !== undefined && input.breakingChanges.length > 0) {
    lines.push('## Breaking changes', '', ...input.breakingChanges.map((b) => `- ${b}`), '');
  }
  if (input.relatedIssues !== undefined && input.relatedIssues.length > 0) {
    lines.push('## Related', '', ...input.relatedIssues.map((i) => `- ${i}`), '');
  }
  return { title: input.title, body: lines.join('\n') };
};
