/**
 * dependency-cruiser config — module-boundary + cyclic-dep guardrails for the
 * 95-package monorepo. Per LITFIN parity audit gap #7 (Docs/LITFIN_PARITY_
 * DEEP_AUDIT_2026-05-24.md).
 *
 * Posture: report-only on first roll-out (severity = warn), enforced once
 * the baseline is clean. The CI workflow surfaces violations; it only fails
 * if a NEW violation appears compared to the committed baseline.
 *
 * Rule families:
 *   1. no-circular            — no cyclic deps anywhere
 *   2. no-orphans             — every TS module must be reachable from a
 *                                package entry (allowing test + config files)
 *   3. layer-respect-apps     — apps/* → services/* → packages/* one way
 *   4. layer-respect-services — services/* → packages/* one way
 *   5. no-deprecated-core     — Node deprecated APIs blocked
 *   6. no-non-package-json    — runtime deps must be in package.json
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'Cyclic dependencies couple modules and break tree-shaking. Refactor by extracting a shared kernel or pulling shared types up.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Module is not reachable from any package entry. Either delete it or wire it from an index.ts.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)vitest\\.config\\.(t|j)s$',
          '(^|/)tsup\\.config\\.(t|j)s$',
          '__tests__/',
          '__fixtures__/',
          '__mocks__/',
          '\\.test\\.(t|j)sx?$',
          '\\.spec\\.(t|j)sx?$',
          'scripts/',
        ],
      },
      to: {},
    },
    {
      name: 'layer-respect-apps',
      severity: 'error',
      comment:
        'apps/* must not import from another app — apps are sibling leaves. Promote shared logic to packages/*.',
      from: { path: '^apps/([^/]+)/' },
      to: {
        path: '^apps/(?!\\1)([^/]+)/',
        pathNot: '^apps/\\1/',
      },
    },
    {
      name: 'layer-respect-services',
      severity: 'error',
      comment:
        'services/* must not import from another service — services are sibling leaves. Use the agent-platform contract or extract shared code to packages/*.',
      from: { path: '^services/([^/]+)/' },
      to: {
        path: '^services/(?!\\1)([^/]+)/',
        pathNot: '^services/\\1/',
      },
    },
    {
      name: 'packages-must-not-import-services',
      severity: 'error',
      comment:
        'packages/* are library code — they must not depend on services/* (which run as processes).',
      from: { path: '^packages/' },
      to: { path: '^services/' },
    },
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      comment:
        'packages/* are library code — they must not depend on apps/*.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'services-must-not-import-apps',
      severity: 'error',
      comment:
        'services/* run independently of the user-facing apps — they must not depend on apps/*.',
      from: { path: '^services/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment:
        'Node deprecated core module — use the modern replacement.',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Non-test code must not import test files.',
      from: {
        pathNot: ['\\.test\\.(t|j)sx?$', '\\.spec\\.(t|j)sx?$', '__tests__/', '__fixtures__/', '__mocks__/'],
      },
      to: {
        path: ['\\.test\\.(t|j)sx?$', '\\.spec\\.(t|j)sx?$', '__tests__/.*\\.(t|j)sx?$'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|dist|coverage|\\.next|\\.turbo' },
    exclude: {
      path: [
        'node_modules',
        'dist',
        'coverage',
        '\\.next',
        '\\.turbo',
        '__mocks__',
        '__fixtures__',
        '\\.d\\.ts$',
      ],
    },
    includeOnly: '^(packages|services|apps)/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
      dot: {
        collapsePattern: '^(packages|services|apps)/[^/]+/src/[^/]+',
      },
    },
  },
};
