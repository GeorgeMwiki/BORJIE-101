/**
 * Teams normalizer — Graph message → canonical envelope.
 */

import type { TeamsMessagePayload } from '../types.js';
import type { GraphMessage } from '../client/teams-client.js';

export interface NormaliseParams {
  readonly teamId: string;
  readonly channelId: string;
  readonly raw: GraphMessage | Readonly<Record<string, unknown>>;
}

export function normaliseTeamsMessage(params: NormaliseParams): TeamsMessagePayload | null {
  const r = params.raw as Readonly<Record<string, unknown>>;
  const id = typeof r.id === 'string' ? r.id : null;
  if (id === null) return null;
  const created = typeof r.createdDateTime === 'string' ? r.createdDateTime : null;
  if (created === null) return null;
  const from = (r.from as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const fromUser =
    from !== undefined ? (from.user as Readonly<Record<string, unknown>> | undefined) : undefined;
  const displayName = fromUser && typeof fromUser.displayName === 'string' ? fromUser.displayName : 'unknown';
  const fromMail =
    fromUser && typeof (fromUser as Record<string, unknown>).mail === 'string'
      ? ((fromUser as Record<string, unknown>).mail as string)
      : null;
  const body = (r.body as Readonly<Record<string, unknown>> | undefined) ?? undefined;
  const content = body !== undefined && typeof body.content === 'string' ? body.content : null;
  const rawAttachments = Array.isArray(r.attachments) ? (r.attachments as ReadonlyArray<Readonly<Record<string, unknown>>>) : [];
  const attachments = rawAttachments.map((a) => ({
    id: typeof a.id === 'string' ? a.id : '',
    contentType: typeof a.contentType === 'string' ? a.contentType : 'application/octet-stream',
    name: typeof a.name === 'string' ? a.name : null,
    contentUrl: typeof a.contentUrl === 'string' ? a.contentUrl : null,
  }));
  return {
    teamId: params.teamId,
    channelId: params.channelId,
    messageId: id,
    fromDisplayName: displayName,
    fromEmailHashed: fromMail,
    content,
    attachments,
    sentAt: created,
  };
}
