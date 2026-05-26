/**
 * Slack normaliser — provider payload → canonical row.
 *
 * Maps `SlackApiMessage` to `SlackMessage` (the row shape that lands
 * in `slack_messages`). PII inside `text` passes through the boundary
 * redactor before the row is built. Attachments capture only the
 * provider id + MIME + size + the MinIO storage key the upload
 * sidecar produced (storage upload itself lives in the poller,
 * driven by the same fetcher port).
 *
 * The normaliser is pure given the injected deps — it produces a new
 * object every call and never mutates the input.
 */

import type {
  Clock,
  SlackApiMessage,
  SlackMessage,
  UuidGen,
} from '../types.js';
import type { PiiRedactor } from '../redact/pii-redactor.js';

export interface NormaliseRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly apiMessage: SlackApiMessage;
  /** sha256 of the canonical row body, computed by the caller. */
  readonly auditHash: string;
  /** Map of slack file id → MinIO storage key. */
  readonly attachmentStorageKeys: ReadonlyMap<string, string>;
}

export interface SlackNormaliserDeps {
  readonly redactor: PiiRedactor;
  readonly clock: Clock;
  readonly uuid: UuidGen;
}

export function createSlackNormaliser(deps: SlackNormaliserDeps) {
  return {
    normalise: async (req: NormaliseRequest): Promise<SlackMessage> => {
      const fieldId = `slack:${req.workspaceId}:${req.channelId}:text`;
      const rawText = req.apiMessage.text ?? '';
      const { redacted } =
        rawText.length === 0
          ? { redacted: '' }
          : await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId,
              value: rawText,
            });

      const reactions = (req.apiMessage.reactions ?? []).map((r) => ({
        name: r.name,
        count: r.count,
        users: [...r.users],
      }));

      const files = (req.apiMessage.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        size: f.size,
        storage_key: req.attachmentStorageKeys.get(f.id) ?? null,
      }));

      return {
        id: deps.uuid.v4(),
        tenant_id: req.tenantId,
        workspace_id: req.workspaceId,
        channel_id: req.channelId,
        ts: req.apiMessage.ts,
        user_id: req.apiMessage.user ?? null,
        text: rawText.length === 0 ? null : redacted,
        thread_ts: req.apiMessage.thread_ts ?? null,
        reactions,
        files,
        raw: {
          type: req.apiMessage.type,
          ...(req.apiMessage.subtype === undefined
            ? {}
            : { subtype: req.apiMessage.subtype }),
        },
        ingested_at: deps.clock.nowIso(),
        audit_hash: req.auditHash,
      };
    },
  };
}

export type SlackNormaliser = ReturnType<typeof createSlackNormaliser>;
