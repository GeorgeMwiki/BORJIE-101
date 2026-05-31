/**
 * Fallback to the server-side brain router when on-device routing is
 * unavailable OR low-confidence. Posts to `/brain/turn` exactly as the
 * UI would, so the caller doesn't need a special low-confidence code
 * path.
 *
 * The shape mirrors `services/api-gateway/src/routes/brain.hono.ts`.
 * We intentionally keep this dependency-free (just `fetch`) so the
 * package can drop into a React Native / Expo bundle as well as a
 * Node service.
 */

export interface FallbackServerOptions {
  /** Base URL for the brain endpoint, e.g. `https://api.borjie.tz`. */
  readonly baseUrl: string;
  /** Caller-supplied JWT — passed through as `Authorization: Bearer …`. */
  readonly authToken?: string;
  /** Override `fetch` for tests. */
  readonly fetcher?: typeof fetch;
  /** Optional Pino-compatible logger. The package never calls `console`. */
  readonly logger?: {
    readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
    readonly info: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export interface FallbackRequest {
  readonly prompt: string;
  readonly language?: 'sw' | 'en' | undefined;
  readonly tenantId?: string | undefined;
  readonly teamId?: string | undefined;
  /** Hint from a low-confidence on-device decision (purely informational). */
  readonly routerHint?:
    | { toolId: string | null; confidence: number }
    | undefined;
}

export interface FallbackResponse {
  readonly toolId: string | null;
  readonly source: 'server' | 'cache' | 'error';
  readonly latencyMs: number;
  readonly raw?: unknown;
}

/**
 * Call the server router. Returns a normalised envelope; never throws.
 */
export async function callFallbackServer(
  request: FallbackRequest,
  options: FallbackServerOptions,
): Promise<FallbackResponse> {
  const started = Date.now();
  const fetcher = options.fetcher ?? fetch;
  const url = joinUrl(options.baseUrl, '/api/v1/brain/turn');
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.authToken) {
      headers.Authorization = `Bearer ${options.authToken}`;
    }
    const body = JSON.stringify({
      prompt: request.prompt,
      // English default per CLAUDE.md (flipped 2026-05).
      language: request.language ?? 'en',
      tenantId: request.tenantId,
      teamId: request.teamId,
      routerHint: request.routerHint,
    });
    const res = await fetcher(url, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      options.logger?.warn(
        { url, status: res.status },
        'on-device-router fallback non-2xx',
      );
      return {
        toolId: null,
        source: 'error',
        latencyMs: Date.now() - started,
      };
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: { toolId?: string | null; source?: 'server' | 'cache' };
    };
    return {
      toolId: json.data?.toolId ?? null,
      source: json.data?.source ?? 'server',
      latencyMs: Date.now() - started,
      raw: json,
    };
  } catch (err) {
    options.logger?.warn(
      { url, error: (err as Error).message },
      'on-device-router fallback exception',
    );
    return {
      toolId: null,
      source: 'error',
      latencyMs: Date.now() - started,
    };
  }
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
