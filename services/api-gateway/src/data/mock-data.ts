/**
 * mock-data.ts — Hard-fail stub.
 *
 * The original 1061-line in-memory demo store was a production-leak vector:
 * its kill-switch (`RUNTIME_DEMO_DATA_ALLOWED = NODE_ENV === 'test'`) was
 * inverted, so demo records were active in dev/staging/prod whenever
 * NODE_ENV was anything other than the literal string 'test'.
 *
 * The fixtures themselves now live at
 *   services/api-gateway/src/__tests__/fixtures/demo-data.ts
 * where the test runner can import them but production builds of `src/`
 * cannot reach them.
 *
 * If anything in production code paths imports this module, it throws at
 * load time so the failure is loud — never silent demo data again.
 */

if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    'services/api-gateway/src/data/mock-data.ts has been retired. ' +
      'Production code must talk to the live database via repositories — ' +
      'demo fixtures live under __tests__/fixtures/demo-data.ts (test-only).'
  );
}

export {};
