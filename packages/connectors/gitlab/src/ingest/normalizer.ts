/**
 * GitLab normalizer.
 */

import type { GitLabEntityKind, GitLabEntityPayload } from '../types.js';

export interface NormaliseParams {
  readonly kind: GitLabEntityKind;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function normaliseGitLabIssue(params: NormaliseParams): GitLabEntityPayload | null {
  const r = params.raw;
  const id = typeof r.id === 'number' ? String(r.id) : typeof r.id === 'string' ? r.id : null;
  if (id === null) return null;
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : null;
  if (updatedAt === null) return null;
  const iid = typeof r.iid === 'number' ? r.iid : null;
  const title = typeof r.title === 'string' ? r.title : null;
  const state = typeof r.state === 'string' ? r.state : null;
  const author = (r.author as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const username =
    author !== undefined && typeof author.username === 'string' ? author.username : null;
  const email = author !== undefined && typeof author.email === 'string' ? author.email : null;
  return {
    entityKind: params.kind,
    entityId: id,
    iid,
    title,
    state,
    authorUsername: username,
    authorEmailHashed: email,
    updatedAt,
  };
}
