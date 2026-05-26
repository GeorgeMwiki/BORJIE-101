#!/usr/bin/env node
// =============================================================================
// audit-security-route-coverage.mjs
// =============================================================================
// Counts HTTP-method declarations (.get|.post|.put|.patch|.delete) under
// services/api-gateway/src/routes/ and compares against the number of routes
// covered by .semgrep/*.yml rules. Fails CI if coverage < 90%.
//
// CURRENT STATE: prints the raw counts and exits 0. The 90% gate will be
// enabled in a follow-up phase once we have the route<->rule mapping wired.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const ROUTES_DIR = join(REPO_ROOT, 'services', 'api-gateway', 'src', 'routes');
const SEMGREP_DIR = join(REPO_ROOT, '.semgrep');

const HTTP_METHOD_RE = /\.(get|post|put|patch|delete)\s*\(/g;

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) return walk(full);
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) return [full];
    return [];
  });
};

const countHttpMethods = (files) =>
  files.reduce((total, file) => {
    const matches = readFileSync(file, 'utf8').match(HTTP_METHOD_RE);
    return total + (matches ? matches.length : 0);
  }, 0);

const countSemgrepRules = () => {
  if (!existsSync(SEMGREP_DIR)) return 0;
  const ymls = readdirSync(SEMGREP_DIR).filter((name) => /\.ya?ml$/.test(name));
  return ymls.reduce((total, name) => {
    const matches = readFileSync(join(SEMGREP_DIR, name), 'utf8').match(/^\s*-\s+id:\s+/gm);
    return total + (matches ? matches.length : 0);
  }, 0);
};

const main = () => {
  const routeFiles = walk(ROUTES_DIR);
  const httpMethods = countHttpMethods(routeFiles);
  const semgrepRules = countSemgrepRules();
  const coverage = httpMethods === 0 ? 1 : semgrepRules / httpMethods;

  const summary = {
    routesDirExists: existsSync(ROUTES_DIR),
    routeFiles: routeFiles.length,
    httpMethodCount: httpMethods,
    semgrepRuleCount: semgrepRules,
    coverage: Number(coverage.toFixed(3)),
    target: 0.9,
  };

  console.log('[security-route-coverage] PLACEHOLDER scan:');
  console.log(`[security-route-coverage] summary=${JSON.stringify(summary)}`);
  console.log('[security-route-coverage] 90% gate NOT yet enforced; exit 0.');
  process.exit(0);
};

main();
