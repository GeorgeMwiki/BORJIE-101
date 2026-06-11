/**
 * Canonical corpus-root resolution for the Borjie first-boot ingest.
 *
 * ---------------------------------------------------------------------
 * Why this module exists (KI-01 / KI-02)
 * ---------------------------------------------------------------------
 * The original CLI defaulted `DEFAULT_DOCS_ROOT` to a machine-local path
 * (`…/Claude Projects/Boji project/Docs`) that does NOT exist in any
 * deployment, so `walkMarkdown` swallowed the ENOENT and the ingest
 * completed with `filesScanned: 0` and exit-0 — ZERO global knowledge
 * ever reached `intelligence_corpus_chunks`. Worse, the docs/CLAUDE.md
 * advertise the env var `BORJIE_MINING_CORPUS_PATH` while the code read
 * `BORJIE_DOCS_ROOT`, so even an operator override was inert.
 *
 * This module fixes both:
 *   1. The default now points at the IN-REPO, git-tracked mining corpus
 *      under `Docs/_BOJI_PROJECT_INTAKE_2026_05_27/Docs` (the original
 *      `primary_sources/ · research/ · research/minerals/` tree) PLUS the
 *      in-repo SOTA dossiers under `Docs/research`. Both ship with the
 *      repo, so a fresh checkout / container always has ground truth.
 *   2. `BORJIE_MINING_CORPUS_PATH` is the canonical env override, with
 *      the legacy `BORJIE_DOCS_ROOT` honoured as an alias for one
 *      release so existing deploy manifests keep working.
 *
 * The repo root is derived from THIS module's location (`__dirname`) so it
 * resolves identically whether the worker runs from `src/` (tsx) or
 * `dist/` (node) — never from `process.cwd()`, which differs between
 * container, CI, and local invocation. The package compiles to CommonJS
 * (no `"type":"module"`), so `__dirname` is the portable anchor here
 * (vitest also provides it under its ESM transform).
 */

import { join, resolve } from 'node:path';

/**
 * Walk up from this file's directory to the monorepo root. This module
 * lives at `services/consolidation-worker/{src,dist}/tasks/corpus-roots`,
 * so the repo root is four levels up from the `tasks` dir.
 */
function repoRootDir(): string {
  // .../services/consolidation-worker/<src|dist>/tasks  →  repo root
  return resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Canonical in-repo corpus base directory (the intake of the original
 * Boji `Docs/` tree, now tracked inside this repo).
 */
function inRepoIntakeDocsRoot(): string {
  return join(repoRootDir(), 'Docs', '_BOJI_PROJECT_INTAKE_2026_05_27', 'Docs');
}

/**
 * In-repo SOTA dossiers + regulator research the brain should also
 * inherit as ground truth.
 */
function inRepoResearchRoot(): string {
  return join(repoRootDir(), 'Docs', 'research');
}

/**
 * Resolve the operator-configured docs base, falling back to the in-repo
 * intake corpus. Reads `BORJIE_MINING_CORPUS_PATH` (canonical) then
 * `BORJIE_DOCS_ROOT` (legacy alias, one-release deprecation).
 *
 * `env` is injected for testability (defaults to `process.env`); this is
 * a composition-root module so a direct `process.env` read is in-bounds.
 */
export function resolveDocsRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const canonical = env.BORJIE_MINING_CORPUS_PATH?.trim();
  if (canonical && canonical.length > 0) return canonical;
  const legacy = env.BORJIE_DOCS_ROOT?.trim();
  if (legacy && legacy.length > 0) return legacy;
  return inRepoIntakeDocsRoot();
}

/**
 * Build the ordered list of corpus roots to ingest. When the operator
 * points at a custom docs base we honour the historical
 * `primary_sources/ · research/ · research/minerals/` sub-tree under it.
 * When falling back to the in-repo default we ALSO append the repo's
 * `Docs/research` SOTA dossiers so the brain inherits both corpora.
 */
export function resolveCorpusRoots(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlyArray<string> {
  const docsRoot = resolveDocsRoot(env);
  const subTree = [
    join(docsRoot, 'primary_sources'),
    join(docsRoot, 'research'),
    join(docsRoot, 'research', 'minerals'),
  ];
  const usingInRepoDefault =
    !env.BORJIE_MINING_CORPUS_PATH?.trim() && !env.BORJIE_DOCS_ROOT?.trim();
  if (usingInRepoDefault) {
    // Dedup-safe: the intake `research` dir and the repo-root `research`
    // dir are distinct paths; both are appended intentionally.
    return [...subTree, inRepoResearchRoot()];
  }
  return subTree;
}
