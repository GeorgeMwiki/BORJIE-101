#!/usr/bin/env node
/**
 * build-pages-site.mjs — emit a static documentation site for the Borjie
 * mining OpenAPI spec, suitable for GitHub Pages.
 *
 * Output layout (relative to repo root):
 *
 *   dist/pages/
 *     index.html              — landing page with branding and three CTAs
 *     borjie-mining.yaml      — copy of docs/openapi/borjie-mining.yaml
 *     swagger-ui/
 *       index.html            — swagger-ui-dist with spec URL rewritten
 *       *.css *.js *.png      — swagger-ui-dist assets
 *     redoc/
 *       index.html            — ReDoc standalone (CDN bundle)
 *
 * Inputs
 *   - docs/openapi/borjie-mining.yaml  (regenerated upstream by
 *     scripts/generate-openapi-spec.mjs)
 *   - node_modules/swagger-ui-dist/    (npm dep)
 *
 * The output directory is wiped and recreated on every run so partial
 * stale assets cannot linger between builds.
 */
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SPEC_SOURCE = resolve(REPO_ROOT, "docs/openapi/borjie-mining.yaml");
const OUTPUT_DIR = resolve(REPO_ROOT, "dist/pages");
const SWAGGER_UI_SRC = resolve(REPO_ROOT, "node_modules/swagger-ui-dist");

const SWAGGER_UI_DEST = join(OUTPUT_DIR, "swagger-ui");
const REDOC_DEST = join(OUTPUT_DIR, "redoc");
const SPEC_DEST = join(OUTPUT_DIR, "borjie-mining.yaml");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Prepare output dir + ensure inputs exist
// ---------------------------------------------------------------------------

async function preflight() {
  if (!(await pathExists(SPEC_SOURCE))) {
    throw new Error(
      `Spec not found at ${SPEC_SOURCE}. Run scripts/generate-openapi-spec.mjs first.`,
    );
  }
  if (!(await pathExists(SWAGGER_UI_SRC))) {
    throw new Error(
      `swagger-ui-dist not installed at ${SWAGGER_UI_SRC}. Add it to package.json and run pnpm install.`,
    );
  }
  await ensureCleanDir(OUTPUT_DIR);
}

// ---------------------------------------------------------------------------
// 2. Copy the spec
// ---------------------------------------------------------------------------

async function copySpec() {
  await cp(SPEC_SOURCE, SPEC_DEST);
}

// ---------------------------------------------------------------------------
// 3. Copy swagger-ui-dist and rewrite the default spec URL
// ---------------------------------------------------------------------------

const SWAGGER_UI_ASSET_PATTERN = /\.(html|css|js|map|png|ico|json)$/;

async function copySwaggerUi() {
  await mkdir(SWAGGER_UI_DEST, { recursive: true });
  const entries = await readdir(SWAGGER_UI_SRC);
  await Promise.all(
    entries
      .filter((name) => SWAGGER_UI_ASSET_PATTERN.test(name))
      .map((name) =>
        cp(join(SWAGGER_UI_SRC, name), join(SWAGGER_UI_DEST, name), {
          force: true,
        }),
      ),
  );

  // Swap the swagger-ui-dist default Petstore spec URL for our spec.
  // The shipped initializer is `swagger-initializer.js`.
  const initializerPath = join(SWAGGER_UI_DEST, "swagger-initializer.js");
  if (await pathExists(initializerPath)) {
    const original = await readFile(initializerPath, "utf8");
    const rewritten = original.replace(
      /url:\s*"[^"]*"/,
      'url: "../borjie-mining.yaml"',
    );
    await writeFile(initializerPath, rewritten, "utf8");
  }

  // Replace the default page title.
  const indexPath = join(SWAGGER_UI_DEST, "index.html");
  if (await pathExists(indexPath)) {
    const original = await readFile(indexPath, "utf8");
    const rewritten = original.replace(
      /<title>[^<]*<\/title>/,
      "<title>Borjie Mining API — Swagger UI</title>",
    );
    await writeFile(indexPath, rewritten, "utf8");
  }
}

// ---------------------------------------------------------------------------
// 4. Write ReDoc standalone
// ---------------------------------------------------------------------------

const REDOC_VERSION = "2.5.1";
const REDOC_CDN = `https://cdn.jsdelivr.net/npm/redoc@${REDOC_VERSION}/bundles/redoc.standalone.js`;

const REDOC_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Borjie Mining API — ReDoc</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="ReDoc reference for the Borjie mining OpenAPI 3.1 spec." />
    <link rel="icon" href="data:," />
    <style>
      body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <redoc spec-url="../borjie-mining.yaml" theme='{"colors":{"primary":{"main":"#b45309"}}}'></redoc>
    <script src="${REDOC_CDN}"></script>
  </body>
</html>
`;

async function writeRedoc() {
  await mkdir(REDOC_DEST, { recursive: true });
  await writeFile(join(REDOC_DEST, "index.html"), REDOC_HTML, "utf8");
}

// ---------------------------------------------------------------------------
// 5. Write the landing page
// ---------------------------------------------------------------------------

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Borjie Mining API — Documentation</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="OpenAPI 3.1 documentation for the Borjie mining sub-API (/api/v1/mining/*)." />
    <meta name="theme-color" content="#1a1410" />
    <link rel="icon" href="data:," />
    <style>
      :root {
        --bg: #1a1410;
        --bg-elev: #221a14;
        --bg-card: #2a1f17;
        --border: #3a2c20;
        --border-strong: #4a3a2c;
        --text: #f5ecd9;
        --text-muted: #b8a890;
        --text-dim: #8a7860;
        --accent: #d97706;
        --accent-hover: #f59e0b;
        --copper: #b45309;
        --gold: #eab308;
        --ore: #92400e;
        --shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.2);
      }

      * { box-sizing: border-box; }

      html, body {
        margin: 0;
        padding: 0;
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", Roboto, sans-serif;
        font-size: 16px;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      body {
        background:
          radial-gradient(circle at 20% 0%, rgba(217, 119, 6, 0.08), transparent 50%),
          radial-gradient(circle at 80% 100%, rgba(180, 83, 9, 0.06), transparent 50%),
          var(--bg);
        min-height: 100vh;
      }

      .container {
        max-width: 960px;
        margin: 0 auto;
        padding: 64px 32px 96px;
      }

      header {
        margin-bottom: 64px;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 24px;
      }

      .brand-mark {
        display: inline-block;
        width: 32px;
        height: 32px;
        border-radius: 6px;
        background: linear-gradient(135deg, var(--copper), var(--gold));
        position: relative;
        box-shadow: 0 2px 8px rgba(217, 119, 6, 0.3);
      }

      .brand-mark::after {
        content: "B";
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-family: ui-serif, Georgia, serif;
        font-weight: 700;
        color: var(--bg);
        font-size: 18px;
      }

      h1 {
        font-size: clamp(36px, 5vw, 56px);
        line-height: 1.1;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0 0 16px;
        background: linear-gradient(180deg, var(--text) 0%, var(--text-muted) 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .tagline {
        font-size: 18px;
        color: var(--text-muted);
        max-width: 640px;
        margin: 0 0 12px;
      }

      .meta {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
        font-size: 13px;
        color: var(--text-dim);
      }

      .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: 999px;
      }

      .meta-item strong {
        color: var(--text);
        font-weight: 600;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
        margin-bottom: 56px;
      }

      .card {
        display: flex;
        flex-direction: column;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 28px;
        text-decoration: none;
        color: var(--text);
        transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        box-shadow: var(--shadow);
      }

      .card:hover {
        border-color: var(--border-strong);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.3);
      }

      .card-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--ore), var(--copper));
        display: grid;
        place-items: center;
        margin-bottom: 20px;
        font-size: 20px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--text);
        font-weight: 700;
      }

      .card h2 {
        font-size: 20px;
        font-weight: 600;
        margin: 0 0 8px;
        letter-spacing: -0.01em;
      }

      .card p {
        font-size: 14px;
        color: var(--text-muted);
        margin: 0 0 20px;
        flex: 1;
      }

      .card-cta {
        font-size: 13px;
        font-weight: 600;
        color: var(--accent);
        letter-spacing: 0.02em;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .card:hover .card-cta {
        color: var(--accent-hover);
      }

      .card-cta::after {
        content: "→";
        transition: transform 0.2s ease;
      }

      .card:hover .card-cta::after {
        transform: translateX(3px);
      }

      section.notes {
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 32px;
      }

      section.notes h3 {
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--accent);
        margin: 0 0 16px;
      }

      section.notes ul {
        margin: 0;
        padding-left: 20px;
        color: var(--text-muted);
        font-size: 14px;
      }

      section.notes li {
        margin-bottom: 8px;
      }

      section.notes code {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 1px 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12.5px;
        color: var(--text);
      }

      section.notes a {
        color: var(--accent);
        text-decoration: none;
      }

      section.notes a:hover {
        color: var(--accent-hover);
        text-decoration: underline;
      }

      footer {
        margin-top: 56px;
        padding-top: 32px;
        border-top: 1px solid var(--border);
        font-size: 13px;
        color: var(--text-dim);
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
      }

      footer a {
        color: var(--text-muted);
        text-decoration: none;
      }

      footer a:hover {
        color: var(--accent);
      }

      @media (max-width: 600px) {
        .container { padding: 40px 20px 64px; }
        header { margin-bottom: 40px; }
        section.notes { padding: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span>Borjie Mining</span>
        </div>
        <h1>Mining API Reference</h1>
        <p class="tagline">
          OpenAPI 3.1 documentation for the Borjie mining sub-API
          (<code>/api/v1/mining/*</code>). Pick the view that suits your
          workflow.
        </p>
        <div class="meta">
          <span class="meta-item"><strong>49</strong>&nbsp;paths</span>
          <span class="meta-item"><strong>34</strong>&nbsp;schemas</span>
          <span class="meta-item"><strong>OpenAPI</strong>&nbsp;3.1.0</span>
        </div>
      </header>

      <div class="grid">
        <a class="card" href="./swagger-ui/index.html">
          <div class="card-icon" aria-hidden="true">SW</div>
          <h2>Swagger UI</h2>
          <p>
            Interactive try-it-out console. Browse every endpoint, expand
            schemas inline, and fire requests against a bearer-authenticated
            server.
          </p>
          <span class="card-cta">Open Swagger UI</span>
        </a>

        <a class="card" href="./redoc/index.html">
          <div class="card-icon" aria-hidden="true">RD</div>
          <h2>ReDoc</h2>
          <p>
            Three-pane reference with rich schema rendering. Easier to read
            top-to-bottom; better for partner onboarding and review.
          </p>
          <span class="card-cta">Open ReDoc</span>
        </a>

        <a class="card" href="./borjie-mining.yaml" download>
          <div class="card-icon" aria-hidden="true">{ }</div>
          <h2>Raw YAML</h2>
          <p>
            Download the OpenAPI 3.1 source for codegen, Postman/Insomnia
            import, or your own renderer. Updated on every push to
            <code>main</code>.
          </p>
          <span class="card-cta">Download spec</span>
        </a>
      </div>

      <section class="notes">
        <h3>Notes</h3>
        <ul>
          <li>
            The spec is generated by
            <code>scripts/generate-openapi-spec.mjs</code> from the source
            of truth in
            <code>services/api-gateway/src/routes/mining/</code>.
          </li>
          <li>
            Response payload shapes are generic
            (<code>ApiSuccessEnvelope</code> /
            <code>ApiErrorEnvelope</code>). The full caveat list lives in
            <code>docs/openapi/README.md</code> in the repo.
          </li>
          <li>
            Bearer auth is declared globally; per-role gating and
            per-tenant RLS are not encoded here.
          </li>
        </ul>
      </section>

      <footer>
        <div>Borjie Mining Platform &middot; API Documentation</div>
        <div>
          <a href="https://github.com/GeorgeMwiki/BORJIE-101" rel="noopener">Source on GitHub</a>
        </div>
      </footer>
    </div>
  </body>
</html>
`;

async function writeLanding() {
  await writeFile(join(OUTPUT_DIR, "index.html"), LANDING_HTML, "utf8");
}

// ---------------------------------------------------------------------------
// 6. Add a Jekyll-bypass marker so GitHub Pages does not try to process
//    swagger-ui-dist assets that start with underscores.
// ---------------------------------------------------------------------------

async function writeNoJekyll() {
  await writeFile(join(OUTPUT_DIR, ".nojekyll"), "", "utf8");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await preflight();
  await Promise.all([copySpec(), copySwaggerUi(), writeRedoc(), writeLanding()]);
  await writeNoJekyll();

  const stats = {
    out: OUTPUT_DIR,
    spec: SPEC_DEST,
    swaggerUi: SWAGGER_UI_DEST,
    redoc: REDOC_DEST,
  };
  console.log("Pages site built:");
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key.padEnd(10)} ${value}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
