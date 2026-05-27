/**
 * Minimal ambient module declarations for the bits of k6 we touch.
 *
 * The full `@types/k6` package would pull a new pnpm dep; the load
 * tests do not need full fidelity — they just need `tsc --noEmit` to
 * succeed and the k6 binary to do the actual execution at runtime.
 *
 * If the type surface needs to grow, extend the interfaces in place
 * rather than installing `@types/k6` (per the CLAUDE.md "no new
 * deps" constraint on the load-test workstream).
 */

declare module 'k6' {
  /**
   * Sleep the current VU for `seconds`. k6 pauses the script body;
   * does not block other VUs.
   */
  export function sleep(seconds: number): void;

  /**
   * Run a set of named checks against a value. Each check is a
   * boolean predicate. The return value indicates whether all checks
   * passed; the per-check pass/fail is recorded on the metric stream.
   */
  export function check<T>(
    value: T,
    checks: Readonly<Record<string, (value: T) => boolean>>,
  ): boolean;
}

declare module 'k6/http' {
  /** k6 HTTP response — subset of fields we read. */
  export interface Response {
    readonly status: number;
    readonly body: string | ArrayBuffer | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly timings: {
      readonly duration: number;
      readonly waiting: number;
      readonly connecting: number;
      readonly sending: number;
      readonly receiving: number;
    };
    /** Convenience JSON parser. Returns parsed payload or null. */
    json(): unknown;
  }

  /** Per-request params accepted by the k6 http module. */
  export interface Params {
    readonly headers?: Readonly<Record<string, string>>;
    readonly tags?: Readonly<Record<string, string>>;
    readonly timeout?: string;
    readonly responseType?: 'text' | 'binary' | 'none';
  }

  export function get(url: string, params?: Params): Response;
  export function post(
    url: string,
    body?: string | ArrayBuffer | null,
    params?: Params,
  ): Response;
  export function put(
    url: string,
    body?: string | ArrayBuffer | null,
    params?: Params,
  ): Response;
  export function del(url: string, params?: Params): Response;

  const _default: {
    get: typeof get;
    post: typeof post;
    put: typeof put;
    del: typeof del;
  };
  export default _default;
}
