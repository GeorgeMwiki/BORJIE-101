/**
 * ChatArtifactStream — Piece-G chat-side artifact-stream renderer.
 *
 * The brain emits artifacts via SSE events `{event: 'ui_artifact', data: …}`.
 * The chat hook (`useUnifiedChat`) accumulates them on
 * `message.metadata.artifacts` as an ordered array. This component
 * renders them inline in the chat surface using `<UiArtifact>` from
 * `@borjie/genui`. While the message is streaming, completed
 * artifacts render immediately and an in-flight placeholder is shown
 * for the next slot.
 *
 * Defensive contract:
 *   * Each candidate artifact MUST have an `id`, `componentType`,
 *     `props`, and `data`. Missing fields surface as
 *     `UnknownKindCard`.
 *   * Cross-tenant artifacts are NOT filtered here — the API layer is
 *     responsible for never including foreign rows in the SSE stream.
 *     (RLS enforces this at the DB layer; we trust the API.)
 *
 * Persistence is fire-and-forget via the injected `persistArtifact`
 * callback — the chat host wires it to a server action that does a
 * single `INSERT … ON CONFLICT DO NOTHING` into `ui_artifacts`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { UiArtifact, type UiArtifactRow } from '@borjie/genui';

export interface ArtifactStreamCandidate {
  readonly id?: string;
  readonly tenantId?: string;
  readonly componentType?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly locale?: 'en' | 'sw';
  readonly themeTokenSetId?: string | null;
  readonly threadId?: string | null;
  readonly createdByUserId?: string | null;
  readonly version?: number;
  readonly createdAt?: string;
  /**
   * Optional stream-state marker emitted by the brain so the chat can
   * show a "placeholder" until the artifact is fully received.
   */
  readonly streaming?: boolean;
}

export interface ChatArtifactStreamProps {
  readonly artifacts: ReadonlyArray<ArtifactStreamCandidate>;
  readonly tenantId: string;
  readonly threadId?: string | null;
  /**
   * Optional callback fired once per artifact, after the first render.
   * Wire this to the host's server action that persists the artifact.
   */
  readonly persistArtifact?: (artifact: UiArtifactRow) => void;
  /**
   * Telemetry hook — forwarded to each `<UiArtifact>` for unknown-type
   * + schema-validation-failed events.
   */
  readonly onValidationFailure?: Parameters<typeof UiArtifact>[0]['onValidationFailure'];
}

function toUiArtifactRow(
  c: ArtifactStreamCandidate,
  tenantId: string,
  threadId?: string | null,
): UiArtifactRow | null {
  if (!c.id || typeof c.componentType !== 'string') return null;
  return {
    id: c.id,
    tenantId,
    threadId: c.threadId ?? threadId ?? null,
    createdByUserId: c.createdByUserId ?? null,
    componentType: c.componentType,
    props: c.props ?? {},
    data: c.data ?? {},
    version: typeof c.version === 'number' ? c.version : 1,
    title: c.title ?? null,
    description: c.description ?? null,
    locale: c.locale ?? 'en',
    themeTokenSetId: c.themeTokenSetId ?? null,
    createdAt: c.createdAt ?? new Date(0).toISOString(),
  };
}

function ArtifactPlaceholder(): JSX.Element {
  return (
    <div
      data-testid="ui-artifact-placeholder"
      style={{
        height: 64,
        borderRadius: 8,
        background:
          'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)',
        animation: 'genui-artifact-shimmer 1.2s linear infinite',
        margin: '6px 0',
      }}
    />
  );
}

export function ChatArtifactStream({
  artifacts,
  tenantId,
  threadId,
  persistArtifact,
  onValidationFailure,
}: ChatArtifactStreamProps): JSX.Element {
  const persisted = useRef<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      artifacts
        .map((c) => ({
          candidate: c,
          row: toUiArtifactRow(c, tenantId, threadId),
        }))
        .filter((entry): entry is { candidate: ArtifactStreamCandidate; row: UiArtifactRow } =>
          entry.row !== null,
        ),
    [artifacts, tenantId, threadId],
  );

  useEffect(() => {
    if (!persistArtifact) return;
    for (const { candidate, row } of rows) {
      if (candidate.streaming) continue;
      if (persisted.current.has(row.id)) continue;
      persisted.current.add(row.id);
      try {
        persistArtifact(row);
      } catch {
        // never throw from a side-effect; surface via telemetry hook.
      }
    }
  }, [rows, persistArtifact]);

  if (rows.length === 0) return <></>;

  return (
    <div
      data-testid="chat-artifact-stream"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}
    >
      {rows.map(({ candidate, row }) =>
        candidate.streaming ? (
          <ArtifactPlaceholder key={row.id} />
        ) : (
          <UiArtifact
            key={row.id}
            artifact={row}
            {...(onValidationFailure ? { onValidationFailure } : {})}
          />
        ),
      )}
    </div>
  );
}
