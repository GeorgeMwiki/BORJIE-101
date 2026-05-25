/**
 * Cross-portal listener (Admin Platform Portal) — Central Command Phase A C6.
 *
 * Subscribes to `/api/v1/cross-portal/subscribe` (SSE) on mount and
 * dispatches the four event kinds (`announcement` / `notification` /
 * `state-mutation` / `wake-trigger`) into per-kind handlers. Tenant
 * scope is enforced server-side by the JWT — the client cannot ask
 * for another tenant's stream.
 *
 * Auto-reconnect with exponential backoff (max 30s) so transient
 * gateway restarts don't drop the brain's push channel.
 *
 * Native `EventSource` cannot pass an Authorization header in WHATWG
 * browsers; we use `fetch()` + a manual SSE parser so the bearer flows
 * the same as on every other authenticated route.
 *
 * Identical bodies live in:
 *   - apps/customer-app/src/lib/cross-portal-listener.ts (this file)
 *   - apps/owner-portal/src/lib/cross-portal-listener.ts
 *   - apps/admin-web/src/lib/cross-portal-listener.ts
 *   - apps/estate-manager-app/src/lib/cross-portal-listener.ts
 *
 * Phase B may extract to a shared `packages/cross-portal-client/`
 * package once a portal wants to override the dispatch surface.
 */

export type CrossPortalEventKind =
  | 'announcement'
  | 'notification'
  | 'state-mutation'
  | 'wake-trigger';

export interface CrossPortalEvent {
  readonly kind: CrossPortalEventKind;
  readonly payload: Record<string, unknown>;
  readonly emittedBy: string;
  readonly emittedAt: string;
}

const ALLOWED_KINDS: ReadonlyArray<CrossPortalEventKind> = [
  'announcement',
  'notification',
  'state-mutation',
  'wake-trigger',
];

export interface CrossPortalListenerOptions {
  /**
   * Bearer JWT for the current authenticated user. The listener
   * passes this in the `Authorization` header.
   */
  readonly token: string;
  /**
   * Gateway base URL. Defaults to `''` (same origin) so the listener
   * works seamlessly behind a reverse proxy.
   */
  readonly baseUrl?: string;
  /**
   * Callback for every received event. The dispatcher decides what
   * to do per kind (toast, store mutation, refetch, etc.).
   */
  onEvent(event: CrossPortalEvent): void;
  /**
   * Optional connection-state callback. Useful for portal UI to
   * render a "live" indicator near the brain status pill.
   */
  onConnectionChange?(state: 'connecting' | 'open' | 'closed'): void;
  /**
   * Optional error callback. Defaults to swallowing — the listener
   * keeps reconnecting regardless.
   */
  onError?(error: unknown): void;
  /**
   * Hard ceiling on reconnect backoff (ms). Default 30s.
   */
  readonly maxBackoffMs?: number;
}

export interface CrossPortalListenerHandle {
  /** Tear down the listener (closes the stream + cancels reconnects). */
  close(): void;
}

/**
 * Open a cross-portal SSE connection. Returns a handle whose `close()`
 * stops the listener. Safe to call once per mount; calling more than
 * once gives you multiple independent streams.
 */
export function startCrossPortalListener(
  options: CrossPortalListenerOptions,
): CrossPortalListenerHandle {
  if (!options.token) {
    throw new Error('cross-portal-listener: token required');
  }
  const baseUrl = options.baseUrl ?? '';
  const url = `${baseUrl}/api/v1/cross-portal/subscribe`;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;

  let closed = false;
  let abort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  /** Dedupe identical events that arrive within a short window —
   *  protects against transient pubsub double-delivery on reconnect. */
  const recent: Array<{ key: string; t: number }> = [];

  const dedupeWindowMs = 5_000;
  const setConnState = (state: 'connecting' | 'open' | 'closed'): void => {
    try {
      options.onConnectionChange?.(state);
    } catch {
      // swallow
    }
  };

  const isRecent = (event: CrossPortalEvent): boolean => {
    const key = `${event.kind}::${event.emittedAt}::${event.emittedBy}`;
    const now = Date.now();
    while (recent.length > 0 && now - (recent[0]?.t ?? 0) > dedupeWindowMs) {
      recent.shift();
    }
    if (recent.some((r) => r.key === key)) return true;
    recent.push({ key, t: now });
    return false;
  };

  const dispatch = (event: CrossPortalEvent): void => {
    if (!ALLOWED_KINDS.includes(event.kind)) return;
    if (isRecent(event)) return;
    try {
      options.onEvent(event);
    } catch (err) {
      try {
        options.onError?.(err);
      } catch {
        // swallow
      }
    }
  };

  const parseFrame = (
    raw: string,
  ): { eventName: string; data: string } | null => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0 && eventName === 'message') return null;
    return { eventName, data: dataLines.join('\n') };
  };

  const handleFrame = (frame: { eventName: string; data: string }): void => {
    if (
      frame.eventName === 'ready' ||
      frame.eventName === 'heartbeat' ||
      frame.eventName === 'message'
    ) {
      return;
    }
    try {
      const parsed = JSON.parse(frame.data) as Partial<CrossPortalEvent>;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.kind === 'string' &&
        typeof parsed.emittedBy === 'string' &&
        typeof parsed.emittedAt === 'string' &&
        parsed.payload &&
        typeof parsed.payload === 'object'
      ) {
        dispatch(parsed as CrossPortalEvent);
      }
    } catch {
      // malformed frame — drop silently
    }
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    setConnState('connecting');
    abort = new AbortController();
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'text/event-stream',
        },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`cross-portal-listener: HTTP ${res.status}`);
      }
      setConnState('open');
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const frame = parseFrame(raw);
          if (frame) handleFrame(frame);
          idx = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      try {
        options.onError?.(err);
      } catch {
        // swallow
      }
    } finally {
      setConnState('closed');
      abort = null;
    }
    if (!closed) {
      scheduleReconnect();
    }
  };

  const scheduleReconnect = (): void => {
    if (closed) return;
    attempt += 1;
    const backoff = Math.min(
      maxBackoffMs,
      // Jitter via crypto-strong randomness so reconnect collisions
      // across tabs do not align — 0..199ms.
      Math.floor(Math.min(30, 2 ** attempt) * 100) + (crypto.getRandomValues(new Uint16Array(1))[0] % 200),
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, backoff);
  };

  void connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        abort?.abort();
      } catch {
        // swallow
      }
      setConnState('closed');
    },
  };
}
