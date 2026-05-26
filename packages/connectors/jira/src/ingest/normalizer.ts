/**
 * Jira normalizer — raw issue → canonical envelope.
 */

import type { JiraEntityKind, JiraEntityPayload } from '../types.js';
import type { SearchIssue } from '../client/jira-client.js';

export interface NormaliseParams {
  readonly kind: JiraEntityKind;
  readonly issue: SearchIssue | Readonly<Record<string, unknown>>;
}

export function normaliseJiraIssue(params: NormaliseParams): JiraEntityPayload | null {
  const i = params.issue as Readonly<Record<string, unknown>>;
  const id = typeof i.id === 'string' ? i.id : null;
  if (id === null) return null;
  const key = typeof i.key === 'string' ? i.key : null;
  const fields = (i.fields as Readonly<Record<string, unknown>> | undefined) ?? {};
  const updatedAt = typeof fields.updated === 'string' ? fields.updated : null;
  if (updatedAt === null) return null;
  const summary = typeof fields.summary === 'string' ? fields.summary : null;
  const status = (fields.status as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const statusName =
    status !== undefined && typeof status.name === 'string' ? status.name : null;
  const assignee = (fields.assignee as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const assigneeEmail =
    assignee !== undefined && typeof assignee.emailAddress === 'string'
      ? assignee.emailAddress
      : null;
  const reporter = (fields.reporter as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const reporterEmail =
    reporter !== undefined && typeof reporter.emailAddress === 'string'
      ? reporter.emailAddress
      : null;
  return {
    entityKind: params.kind,
    entityId: id,
    key,
    summary,
    status: statusName,
    assigneeEmailHashed: assigneeEmail,
    reporterEmailHashed: reporterEmail,
    updatedAt,
  };
}
