/**
 * GitHub normalizer — raw issue/PR → canonical envelope.
 */

import type { GitHubEntityKind, GitHubEntityPayload } from '../types.js';
import type { GitHubIssue } from '../client/github-client.js';

export interface NormaliseParams {
  readonly raw: GitHubIssue | Readonly<Record<string, unknown>>;
}

export function normaliseGitHubIssue(params: NormaliseParams): GitHubEntityPayload | null {
  const r = params.raw as Readonly<Record<string, unknown>>;
  const nodeId = typeof r.node_id === 'string' ? r.node_id : null;
  if (nodeId === null) return null;
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : null;
  if (updatedAt === null) return null;
  const number = typeof r.number === 'number' ? r.number : null;
  const title = typeof r.title === 'string' ? r.title : null;
  const state = typeof r.state === 'string' ? r.state : null;
  const user = (r.user as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const authorLogin = user !== undefined && typeof user.login === 'string' ? user.login : null;
  const authorEmail = user !== undefined && typeof user.email === 'string' ? user.email : null;
  const isPR = r.pull_request !== undefined && r.pull_request !== null;
  const kind: GitHubEntityKind = isPR ? 'pull_request' : 'issue';
  return {
    entityKind: kind,
    entityId: nodeId,
    number,
    title,
    state,
    authorLogin,
    authorEmailHashed: authorEmail,
    updatedAt,
  };
}
