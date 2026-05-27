/**
 * Ambient module shim for `@sentry/nextjs`.
 *
 * Admin-web does not ship the `@sentry/nextjs` runtime dependency —
 * `sentry.{client,edge,server}.config.ts` import the SDK lazily (the configs
 * are picked up by the Next.js Sentry webpack plugin at build time only when
 * the package is actually installed in a deploy target). At typecheck time
 * we provide this minimal shim so `tsc --noEmit` passes without a runtime
 * dep. If/when `@sentry/nextjs` is added to package.json the real types will
 * take precedence over this declaration.
 *
 * Surface area is limited to the named exports used by the three sentry
 * config files in this app (only `init`). Add new symbols here only when
 * the config files reference them.
 */
declare module '@sentry/nextjs' {
  export interface SentryInitOptions {
    readonly dsn?: string | undefined;
    readonly environment?: string | undefined;
    readonly release?: string | undefined;
    readonly tracesSampleRate?: number | undefined;
    readonly [key: string]: unknown;
  }
  export const init: (config: SentryInitOptions) => void;
  export const captureException: (err: unknown) => void;
  export const captureMessage: (msg: string) => void;
}
