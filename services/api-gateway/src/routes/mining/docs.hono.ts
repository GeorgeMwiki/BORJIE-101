/**
 * /api/v1/mining/docs + /api/v1/mining/openapi.yaml
 *
 * Serves the static OpenAPI 3.1 spec for the mining sub-API plus a
 * Swagger UI page mounted on top of it.
 *
 * The spec itself is generated out-of-band by
 * `scripts/generate-openapi-spec.mjs` (Option B — regex over source).
 * This route just reads the YAML off disk at boot, caches it, and
 * serves it untouched. If the file is missing (e.g. nobody ran the
 * generator yet) every endpoint returns 503 with a helpful pointer.
 *
 * Why mounted under `/mining/docs` and not `/api/v1/docs`?
 *   The existing global OpenAPI router (services/api-gateway/src/openapi.ts)
 *   already owns `/api/v1/docs` + `/api/v1/openapi.json` for the full
 *   gateway spec. Mounting the mining-specific docs under the mining
 *   sub-tree keeps the two surfaces from colliding.
 */

import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { logger } from '../../utils/logger.js';

// Candidate paths for the generated spec. `process.cwd()` differs across
// `pnpm dev` (services/api-gateway), `node dist/index.js` (services/api-gateway),
// and `node services/api-gateway/dist/index.js` (repo root). We try a
// short ordered list of likely locations and serve the first that exists.
const SPEC_CANDIDATES = [
  // From repo root (`node services/api-gateway/dist/index.js`).
  resolve(process.cwd(), 'docs/openapi/borjie-mining.yaml'),
  // From `services/api-gateway` (`pnpm dev`, `node dist/index.js`).
  resolve(process.cwd(), '../../docs/openapi/borjie-mining.yaml'),
  // Defensive — relative to the dist/index.js location at runtime.
  // tsup bundles to services/api-gateway/dist/, so 3 levels up reaches repo root.
  resolve(__dirname, '../../../docs/openapi/borjie-mining.yaml'),
];

let cachedYaml: string | null = null;
let cachedPath: string | null = null;
let loadError: string | null = null;

async function loadSpec(): Promise<{ yaml: string | null; path: string | null; error: string | null }> {
  if (cachedYaml !== null) return { yaml: cachedYaml, path: cachedPath, error: null };
  if (loadError !== null) return { yaml: null, path: null, error: loadError };
  for (const candidate of SPEC_CANDIDATES) {
    try {
      const s = await stat(candidate);
      if (!s.isFile()) continue;
      cachedYaml = await readFile(candidate, 'utf8');
      cachedPath = candidate;
      logger.info({ specPath: candidate, bytes: cachedYaml.length }, 'mining-openapi: spec loaded');
      return { yaml: cachedYaml, path: candidate, error: null };
    } catch {
      // Try the next candidate.
    }
  }
  loadError =
    'borjie-mining.yaml not found in any of the expected locations. ' +
    'Run `node scripts/generate-openapi-spec.mjs` (or `pnpm openapi:generate`) ' +
    'from the repo root, then restart the api-gateway.';
  logger.warn({ candidates: SPEC_CANDIDATES }, 'mining-openapi: spec missing');
  return { yaml: null, path: null, error: loadError };
}

const app = new Hono();

// Raw spec as text/yaml. Swagger UI fetches this via the `url` option.
app.get('/openapi.yaml', async (c) => {
  const { yaml, error } = await loadSpec();
  if (!yaml) {
    return c.json(
      { success: false, error: { code: 'SPEC_UNAVAILABLE', message: error ?? 'spec not loaded' } },
      503,
    );
  }
  return c.body(yaml, 200, {
    'content-type': 'application/yaml; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
});

// Swagger UI shell. `@hono/swagger-ui` returns a middleware that emits
// the HTML page wired to fetch the spec URL we give it. The url here
// is relative so it works under any host the gateway is fronted by.
app.get(
  '/docs',
  swaggerUI({
    url: './openapi.yaml',
    title: 'Borjie Mining API',
    persistAuthorization: true,
  }),
);

export const miningDocsRouter = app;
