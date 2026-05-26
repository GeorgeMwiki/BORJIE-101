/**
 * Linear normalizer — raw GraphQL node → canonical envelope.
 */

import type { LinearEntityKind, LinearEntityPayload } from '../types.js';

export interface LinearIssueNode {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly updatedAt?: string;
  readonly state?: { readonly name?: string };
  readonly assignee?: { readonly email?: string };
}

export interface NormaliseParams {
  readonly kind: LinearEntityKind;
  readonly node: LinearIssueNode | Readonly<Record<string, unknown>>;
}

export function normaliseLinearNode(params: NormaliseParams): LinearEntityPayload | null {
  const n = params.node as Readonly<Record<string, unknown>>;
  const id = typeof n.id === 'string' ? n.id : null;
  const updatedAt = typeof n.updatedAt === 'string' ? n.updatedAt : null;
  if (id === null || updatedAt === null) return null;
  const title = typeof n.title === 'string' ? n.title : null;
  const description = typeof n.description === 'string' ? n.description : null;
  const stateObj = (n.state as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const stateName = stateObj !== undefined && typeof stateObj.name === 'string' ? stateObj.name : null;
  const assigneeObj = (n.assignee as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const assigneeEmail = assigneeObj !== undefined && typeof assigneeObj.email === 'string' ? assigneeObj.email : null;
  return {
    entityKind: params.kind,
    entityId: id,
    title,
    state: stateName,
    assigneeEmailHashed: assigneeEmail,
    description,
    updatedAt,
  };
}
