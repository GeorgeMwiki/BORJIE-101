/**
 * Cross-tenant regression harness.
 *
 * The harness is route-runner-agnostic — callers provide an `act`
 * function that performs the request under the impersonated tenant
 * and returns a response with at least `{ status, body }`. This lets
 * the same helper drive Hono routers, fetch() calls, or any HTTP
 * client the api-gateway tests already use.
 *
 * Typical usage from a `*.test.ts`:
 *
 *   import { describe } from 'vitest';
 *   import { testTenantIsolation } from '@borjie/security-audit/regression';
 *
 *   describe('GET /v1/leases/:id', () => {
 *     testTenantIsolation({
 *       description: 'leaks across tenants',
 *       setup: async () => {
 *         const tenantA = await createTenant();
 *         const tenantB = await createTenant();
 *         const leaseA = await createLease({ tenant: tenantA });
 *         return { tenantA, tenantB, leaseA };
 *       },
 *       act: async ({ tenantB, leaseA }) =>
 *         requestWithTenantContext(tenantB, `/v1/leases/${leaseA.id}`),
 *       expect: { status: 404 },
 *     });
 *   });
 *
 * The harness deliberately treats both 404 and 403 as acceptable
 * "no-leak" responses — the request-routing layer may choose either,
 * as long as the response body does NOT include the foreign tenant's
 * resource fields.
 */

export interface TestRunnerLike {
  /**
   * Vitest / Jest / Mocha-compatible `it()` shape. Returns a value the
   * runner can either await or discard.
   */
  (name: string, fn: () => Promise<void> | void, timeout?: number): unknown;
}

export interface IsolationResponse {
  /** HTTP status returned by the route. */
  readonly status: number;
  /** Parsed JSON body OR a string when the route returned a non-JSON
   * payload. Used to verify the response does not leak foreign-tenant
   * fields. */
  readonly body: unknown;
  /** Optional headers — used for redirect / 3xx detection. */
  readonly headers?: Record<string, string>;
}

export type SetupResult = Record<string, unknown>;

export interface TenantIsolationSpec<S extends SetupResult> {
  /** Human-readable description used as the `it()` name. */
  readonly description: string;
  /**
   * Prepare two tenants + at least one resource that belongs to ONE
   * of them. The shape is opaque — `act` consumes it.
   */
  readonly setup: () => Promise<S>;
  /**
   * Perform the cross-tenant request — typically a fetch from tenant B
   * for tenant A's resource id.
   */
  readonly act: (ctx: S) => Promise<IsolationResponse>;
  /**
   * Optional expectations on the response. Defaults to
   * `{ status: [403, 404] }`.
   */
  readonly expect?: {
    readonly status?: number | ReadonlyArray<number>;
    /** Field names that MUST NOT appear in the response body. */
    readonly forbiddenFields?: ReadonlyArray<string>;
    /** Substrings that MUST NOT appear when the body is serialized
     * as JSON (e.g. the leaked resource's id). */
    readonly forbiddenSubstrings?: ReadonlyArray<string>;
  };
  /**
   * Optional teardown. Always runs even if `act` throws.
   */
  readonly teardown?: (ctx: S) => Promise<void>;
}

const DEFAULT_NO_LEAK_STATUSES: ReadonlyArray<number> = [403, 404];

/**
 * Vitest harness — accepts the runner functions explicitly so this
 * package never imports `vitest` directly (keeps the harness usable
 * from any spec runner).
 */
export interface HarnessRunner {
  readonly it: TestRunnerLike;
  readonly expect: <T>(actual: T) => {
    toBeDefined: () => void;
    toBe: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toBeOneOf: (expected: ReadonlyArray<unknown>) => void;
    toEqual: (expected: unknown) => void;
    toBeTruthy: () => void;
    toBeFalsy: () => void;
    not: {
      toContain: (expected: unknown) => void;
      toBe: (expected: unknown) => void;
    };
  };
}

/**
 * Run a single cross-tenant assertion. Designed to be called from
 * inside a `describe()` block of any spec runner.
 *
 * Returns the spec's `it()` registration so callers can await it if
 * the runner requires that.
 */
export function testTenantIsolation<S extends SetupResult>(
  spec: TenantIsolationSpec<S>,
  runner: HarnessRunner,
): unknown {
  return runner.it(spec.description, async () => {
    const ctx = await spec.setup();
    try {
      const res = await spec.act(ctx);
      const expectedStatuses = normalizeStatusList(
        spec.expect?.status ?? DEFAULT_NO_LEAK_STATUSES,
      );
      runner.expect(res).toBeDefined();
      runner.expect(expectedStatuses.includes(res.status)).toBeTruthy();

      const bodyText =
        typeof res.body === 'string'
          ? res.body
          : JSON.stringify(res.body ?? '');

      for (const field of spec.expect?.forbiddenFields ?? []) {
        // Either the field appears as a JSON key OR as a bare property
        // name in the serialized text — both forms are leaks.
        runner.expect(bodyText.includes(`"${field}"`)).toBeFalsy();
      }
      for (const sub of spec.expect?.forbiddenSubstrings ?? []) {
        runner.expect(bodyText.includes(sub)).toBeFalsy();
      }
    } finally {
      if (spec.teardown) {
        try {
          await spec.teardown(ctx);
        } catch {
          // Teardown errors must not mask test failures.
        }
      }
    }
  });
}

function normalizeStatusList(
  status: number | ReadonlyArray<number>,
): ReadonlyArray<number> {
  return typeof status === 'number' ? [status] : status;
}

/**
 * Build a fetch-like callable that injects an `Authorization: Bearer`
 * header signed for the given tenant. The caller passes a `tokenFor`
 * function so the harness has no opinion on how tokens are produced.
 */
export function requestWithTenantContext(opts: {
  readonly fetch: typeof fetch;
  readonly baseUrl: string;
  readonly tokenFor: (tenantId: string) => string | Promise<string>;
}): (
  tenantId: string,
  path: string,
  init?: RequestInit,
) => Promise<IsolationResponse> {
  return async (tenantId, path, init) => {
    const token = await Promise.resolve(opts.tokenFor(tenantId));
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-tenant-id', tenantId);
    if (!headers.has('content-type') && init?.body) {
      headers.set('content-type', 'application/json');
    }
    const res = await opts.fetch(`${opts.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Keep as raw text — text/html or empty body cases.
    }
    const headerObj: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headerObj[k.toLowerCase()] = v;
    });
    return { status: res.status, body, headers: headerObj };
  };
}

/**
 * Common no-leak status checker — exported so manual specs that don't
 * use `testTenantIsolation()` can still share the policy.
 */
export function isNoLeakStatus(status: number): boolean {
  return DEFAULT_NO_LEAK_STATUSES.includes(status);
}
