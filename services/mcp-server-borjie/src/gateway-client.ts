/**
 * Thin HTTP client that translates an MCP tool call into the
 * corresponding api-gateway REST call. The mapping table lives here so
 * the tool-catalog stays declarative (no transport code) and the
 * gateway routes stay unaware that an MCP server exists.
 *
 * Every request carries:
 *   - Authorization: Bearer <agent access token>
 *   - X-Borjie-Agent-Token-Id: <agent_tokens.id>  (for audit attribution)
 *   - X-Borjie-Idempotency-Key: <client-supplied key>
 *   - X-Borjie-MCP-Tool: <tool name>  (audit attribution)
 *
 * The gateway middleware:
 *   1. Validates the bearer token, resolves the tenant.
 *   2. Sets `app.current_tenant_id` GUC.
 *   3. Hash-chains the audit event including the MCP tool name.
 *   4. Returns the structured response.
 *
 * On any non-2xx, this client surfaces a `GatewayError` with the upstream
 * code so the MCP dispatcher can translate it into a JSON-RPC error.
 */

export interface GatewayClientConfig {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface GatewayCallInput {
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly accessToken: string;
  readonly agentTokenId: string;
  readonly mcpToolName: string;
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly idempotencyKey?: string;
}

export class GatewayError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly correlationId: string | undefined;
  constructor(args: {
    status: number;
    code: string;
    message: string;
    correlationId?: string | undefined;
  }) {
    super(args.message);
    this.name = 'GatewayError';
    this.status = args.status;
    this.code = args.code;
    this.correlationId = args.correlationId;
  }
}

export function buildGatewayUrl(
  baseUrl: string,
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${trimmed}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    const sorted = Object.keys(query).sort();
    for (const key of sorted) {
      const v = query[key];
      if (v === undefined) continue;
      url.searchParams.set(key, String(v));
    }
  }
  return url.toString();
}

export interface GatewayClient {
  call<T = unknown>(input: GatewayCallInput): Promise<T>;
}

export function createGatewayClient(
  config: GatewayClientConfig,
): GatewayClient {
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 30_000;

  return Object.freeze({
    async call<T>(input: GatewayCallInput): Promise<T> {
      const url = buildGatewayUrl(config.baseUrl, input.path, input.query);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${input.accessToken}`,
        'X-Borjie-Agent-Token-Id': input.agentTokenId,
        'X-Borjie-MCP-Tool': input.mcpToolName,
        Accept: 'application/json',
      };
      if (input.idempotencyKey) {
        headers['Idempotency-Key'] = input.idempotencyKey;
      }
      if (input.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(url, {
          method: input.method,
          headers,
          ...(input.body !== undefined
            ? { body: JSON.stringify(input.body) }
            : {}),
          signal: controller.signal,
        });
        const correlationId =
          res.headers.get('x-request-id') ??
          res.headers.get('x-correlation-id') ??
          undefined;
        const text = await res.text();
        const parsed = text ? safeJsonParse(text) : undefined;
        if (!res.ok) {
          const code = pickErrorCode(parsed, res.status);
          const message = pickErrorMessage(parsed, res.statusText);
          throw new GatewayError({
            status: res.status,
            code,
            message,
            ...(correlationId !== undefined ? { correlationId } : {}),
          });
        }
        return parsed as T;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function pickErrorCode(parsed: unknown, fallback: number): string {
  if (parsed && typeof parsed === 'object') {
    const v = parsed as Record<string, unknown>;
    if (typeof v['code'] === 'string') return v['code'];
    if (typeof v['error_code'] === 'string') return v['error_code'];
  }
  return `HTTP_${fallback}`;
}

function pickErrorMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const v = parsed as Record<string, unknown>;
    if (typeof v['message'] === 'string') return v['message'];
    if (typeof v['error'] === 'string') return v['error'];
  }
  return fallback;
}
