/**
 * MCP `$/progress` notifications — server-pushed progress updates for
 * long-running tool calls.
 *
 * Per MCP 2024-11-05:
 *   - The client includes a `progressToken` in the `tools/call` params'
 *     `_meta` field.
 *   - The server emits `$/progress` notifications carrying the same
 *     token + a progress value (+ optional total).
 *
 * The dispatcher hands each tool handler a `notify(progress, total?)`
 * helper that pushes the notification onto the wire via the configured
 * `NotificationSink`. Tools that don't need progress simply ignore it.
 */

export interface ProgressNotification {
  readonly progressToken: string | number;
  readonly progress: number;
  readonly total?: number;
  readonly message?: string;
}

export interface NotificationSink {
  /** Push an MCP `$/progress` notification to the active channel. */
  progress(notification: ProgressNotification): void;
  /** Push an MCP `$/result_partial` (custom, JSON-RPC compliant). */
  resultPartial(payload: {
    readonly requestId: string | number | null;
    readonly chunk: unknown;
  }): void;
  /** Push an MCP `notifications/resources/updated` event. */
  resourcesUpdated(payload: { readonly uri: string }): void;
  /** Push an MCP `notifications/roots/list_changed` event. */
  rootsListChanged(): void;
}

/** No-op sink used when the dispatcher has no notification channel. */
export function createNoopNotificationSink(): NotificationSink {
  const sink: NotificationSink = {
    progress(_n: ProgressNotification): void {
      /* noop */
    },
    resultPartial(_p: { readonly requestId: string | number | null; readonly chunk: unknown }): void {
      /* noop */
    },
    resourcesUpdated(_p: { readonly uri: string }): void {
      /* noop */
    },
    rootsListChanged(): void {
      /* noop */
    },
  };
  return Object.freeze(sink);
}

export interface MemoryNotificationSink extends NotificationSink {
  readonly events: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}

/** Capture sink used by tests. */
export function createMemoryNotificationSink(): MemoryNotificationSink {
  const events: Array<{ kind: string; payload: unknown }> = [];
  const sink: MemoryNotificationSink = {
    progress(payload: ProgressNotification): void {
      events.push({ kind: 'progress', payload });
    },
    resultPartial(payload: {
      readonly requestId: string | number | null;
      readonly chunk: unknown;
    }): void {
      events.push({ kind: 'result_partial', payload });
    },
    resourcesUpdated(payload: { readonly uri: string }): void {
      events.push({ kind: 'resources/updated', payload });
    },
    rootsListChanged(): void {
      events.push({ kind: 'roots/list_changed', payload: {} });
    },
    get events(): ReadonlyArray<{ readonly kind: string; readonly payload: unknown }> {
      return Object.freeze([...events]);
    },
  };
  return Object.freeze(sink);
}

/** Helper handed to tool handlers — bound to the request's progressToken. */
export interface ToolProgressEmitter {
  emit(progress: number, total?: number, message?: string): void;
  partial(chunk: unknown): void;
}

export function createToolProgressEmitter(
  sink: NotificationSink,
  options: {
    readonly requestId: string | number | null;
    readonly progressToken?: string | number;
  },
): ToolProgressEmitter {
  const emitter: ToolProgressEmitter = {
    emit(progress: number, total?: number, message?: string): void {
      if (options.progressToken === undefined) return;
      sink.progress({
        progressToken: options.progressToken,
        progress,
        ...(total !== undefined ? { total } : {}),
        ...(message !== undefined ? { message } : {}),
      });
    },
    partial(chunk: unknown): void {
      sink.resultPartial({ requestId: options.requestId, chunk });
    },
  };
  return Object.freeze(emitter);
}

/** Pull the progress token from a request's `_meta` field per MCP spec. */
export function extractProgressToken(
  params: Readonly<Record<string, unknown>> | undefined,
): string | number | undefined {
  if (!params) return undefined;
  const meta = params['_meta'];
  if (!meta || typeof meta !== 'object') return undefined;
  const tok = (meta as Record<string, unknown>)['progressToken'];
  if (typeof tok === 'string' || typeof tok === 'number') return tok;
  return undefined;
}
