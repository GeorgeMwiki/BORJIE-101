/**
 * System-graph derivation task — regenerate the MD's LIVE body schema.
 *
 * Walks the actual repository morphology (packages, services, app screens,
 * Hono routes, Drizzle schema files) plus injected dynamic registries
 * (capability-catalogue, MCP discovery, sub-MD registry), feeds each
 * substrate through the PURE derivation sources in `@borjie/system-graph`,
 * composes the body schema, and emits it with `listChanged` invalidation
 * on revision change (deploy/migration/flag-flip).
 *
 * The MD's `central-intelligence` self-awareness reads the persisted
 * graph instead of the static `BRAIN_MODULES` list. This task is what
 * keeps that self-model honest.
 *
 * ---------------------------------------------------------------------
 * Architecture
 * ---------------------------------------------------------------------
 *   - The FS walkers are the ONLY impure part. They build manifest
 *     entries (plain shapes). All graph logic is the pure system-graph
 *     package, tested with fixtures.
 *   - Dynamic registries (capabilities / MCP tools / juniors) are read
 *     through injected ports so this task compiles + tests without the
 *     heavy packages, and the registries can be live at runtime.
 *   - Persistence + listChanged are injected sinks (port pattern, mirrors
 *     borjie-corpus-ingest.ts CorpusSink). The graph is content-addressed
 *     so the sink only fires listChanged when the revision actually
 *     changed.
 *
 * See Docs/research/MD_AS_BODY_ARCHITECTURE.md §bodyModel DERIVATION.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  composeFragments,
  hasBodyChanged,
  deriveSelf,
  deriveRoutes,
  deriveScreens,
  derivePackages,
  deriveSchemas,
  deriveMcpTools,
  deriveCapabilities,
  deriveJuniors,
  type SystemGraph,
  type GraphFragment,
  type RouteManifestEntry,
  type ScreenManifestEntry,
  type PackageManifestEntry,
  type SchemaManifestEntry,
  type McpManifestEntry,
  type CapabilityManifestEntry,
  type JuniorManifestEntry,
} from '@borjie/system-graph';
import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Ports — dynamic registries + persistence + listChanged.
// ─────────────────────────────────────────────────────────────────────

/** Reads live dynamic registries the FS cannot enumerate statically. */
export interface RegistryPorts {
  readonly listCapabilities?: () => Promise<ReadonlyArray<CapabilityManifestEntry>>;
  readonly listMcpTools?: () => Promise<ReadonlyArray<McpManifestEntry>>;
  readonly listJuniors?: () => Promise<ReadonlyArray<JuniorManifestEntry>>;
}

/** Persists the derived graph + signals listChanged on revision change. */
export interface SystemGraphSink {
  /** Returns the previously persisted graph (for listChanged compare). */
  readonly loadLatest: () => Promise<SystemGraph | null>;
  /** Persist the new graph. */
  readonly persist: (graph: SystemGraph) => Promise<void>;
  /** Fire listChanged — invalidates paged context downstream. */
  readonly emitListChanged: (revision: string) => Promise<void>;
}

export interface DerivationOptions {
  /** Absolute repo root. */
  readonly repoRoot: string;
  readonly registries?: RegistryPorts;
  readonly sink?: SystemGraphSink;
  /** Injected clock for deterministic tests. */
  readonly now?: () => Date;
}

export interface DerivationResult {
  readonly graph: SystemGraph;
  readonly changed: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

const SURFACE_DIRS: ReadonlyArray<string> = [
  'owner-web',
  'admin-web',
  'workforce-mobile',
  'buyer-mobile',
  'marketing',
];

const IGNORED_SCREEN_DIRS = new Set([
  'node_modules',
  '.expo',
  '.next',
  'dist',
  'build',
  'assets',
  'components',
]);

// ─────────────────────────────────────────────────────────────────────
// FS walkers (the only impure code). Each is defensive: a missing dir or
// unreadable file yields an empty manifest, never a throw — a half-derived
// body is prediction error the next pass reconciles, not a crash.
// ─────────────────────────────────────────────────────────────────────

async function safeReaddir(dir: string): Promise<ReadonlyArray<string>> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal repo-introspection path (repoRoot + the repo's own dir tree), never user input
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal repo-introspection path (repoRoot + the repo's own dir tree), never user input
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Walk packages/* and services/* for package.json name + @borjie deps. */
export async function walkPackages(
  repoRoot: string,
): Promise<ReadonlyArray<PackageManifestEntry>> {
  const roots = ['packages', 'services'];
  const out: PackageManifestEntry[] = [];
  for (const root of roots) {
    const base = join(repoRoot, root);
    for (const name of await safeReaddir(base)) {
      const pkgJsonPath = join(base, name, 'package.json');
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal repo-introspection path (repoRoot + the repo's own dir tree), never user input
        const raw = await readFile(pkgJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as {
          name?: string;
          dependencies?: Record<string, string>;
        };
        if (!parsed.name) continue;
        const deps = Object.keys(parsed.dependencies ?? {}).filter((d) =>
          d.startsWith('@borjie/'),
        );
        out.push({ name: parsed.name, deps });
      } catch {
        // Not a package dir / unreadable — skip.
      }
    }
  }
  return out;
}

/** Walk Hono route files under each service's src/routes. */
export async function walkRoutes(
  repoRoot: string,
): Promise<ReadonlyArray<RouteManifestEntry>> {
  const servicesBase = join(repoRoot, 'services');
  const out: RouteManifestEntry[] = [];
  for (const service of await safeReaddir(servicesBase)) {
    const routesBase = join(servicesBase, service, 'src', 'routes');
    if (!(await isDir(routesBase))) continue;
    await collectHonoFiles(routesBase, service, '', out);
  }
  return out;
}

async function collectHonoFiles(
  dir: string,
  service: string,
  group: string,
  out: RouteManifestEntry[],
): Promise<void> {
  for (const entry of await safeReaddir(dir)) {
    const full = join(dir, entry);
    if (await isDir(full)) {
      const nextGroup = group ? `${group}/${entry}` : entry;
      await collectHonoFiles(full, service, nextGroup, out);
      continue;
    }
    if (entry.endsWith('.hono.ts')) {
      const base = entry.replace(/\.hono\.ts$/, '');
      const routeGroup = group ? `${group}/${base}` : base;
      out.push({ service, group: routeGroup, route: routeGroup });
    }
  }
}

/** Walk each app's `app/` directory for top-level screens. */
export async function walkScreens(
  repoRoot: string,
): Promise<ReadonlyArray<ScreenManifestEntry>> {
  const appsBase = join(repoRoot, 'apps');
  const out: ScreenManifestEntry[] = [];
  for (const surface of SURFACE_DIRS) {
    const appDir = join(appsBase, surface, 'app');
    const base = (await isDir(appDir)) ? appDir : join(appsBase, surface, 'src', 'app');
    if (!(await isDir(base))) continue;
    for (const entry of await safeReaddir(base)) {
      const screen = normaliseScreenName(entry);
      if (!screen || IGNORED_SCREEN_DIRS.has(screen)) continue;
      out.push({ surface, screen, label: humanise(screen) });
    }
  }
  return out;
}

function normaliseScreenName(entry: string): string | null {
  // Expo route-group dirs like "(tabs)" map to a screen; strip parens.
  const stripped = entry.replace(/^\(|\)$/g, '');
  const base = stripped.replace(/\.(t|j)sx?$/, '');
  if (base.startsWith('_') || base.startsWith('.')) return null;
  if (base.length === 0) return null;
  return base;
}

function humanise(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Walk Drizzle schema files for declared table names. */
export async function walkSchemas(
  repoRoot: string,
): Promise<ReadonlyArray<SchemaManifestEntry>> {
  const base = join(repoRoot, 'packages', 'database', 'src', 'schemas');
  const out: SchemaManifestEntry[] = [];
  const tableRe = /pgTable\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
  for (const file of await safeReaddir(base)) {
    if (!file.endsWith('.schema.ts')) continue;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal repo-introspection path (repoRoot + the repo's own dir tree), never user input
      const raw = await readFile(join(base, file), 'utf8');
      let m: RegExpExecArray | null;
      while ((m = tableRe.exec(raw)) !== null) {
        out.push({ table: m[1]!, file });
      }
    } catch {
      // Unreadable — skip.
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestration — walk substrates, derive fragments, compose, persist.
// ─────────────────────────────────────────────────────────────────────

async function readRegistry<T>(
  fn: (() => Promise<ReadonlyArray<T>>) | undefined,
): Promise<ReadonlyArray<T>> {
  if (!fn) return [];
  try {
    return await fn();
  } catch (error) {
    logger.warn('system-graph: registry read failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Derive the full body schema from the repo + injected registries.
 */
export async function deriveSystemGraph(
  options: DerivationOptions,
): Promise<DerivationResult> {
  const now = options.now ?? (() => new Date());
  const [packages, routes, screens, schemas, capabilities, mcpTools, juniors] =
    await Promise.all([
      walkPackages(options.repoRoot),
      walkRoutes(options.repoRoot),
      walkScreens(options.repoRoot),
      walkSchemas(options.repoRoot),
      readRegistry(options.registries?.listCapabilities),
      readRegistry(options.registries?.listMcpTools),
      readRegistry(options.registries?.listJuniors),
    ]);

  const fragments: ReadonlyArray<GraphFragment> = [
    deriveSelf(),
    derivePackages(packages),
    deriveRoutes(routes),
    deriveScreens(screens),
    deriveSchemas(schemas),
    deriveMcpTools(mcpTools),
    deriveCapabilities(capabilities),
    deriveJuniors(juniors),
  ];

  const graph = composeFragments(fragments, now().toISOString());

  let changed = true;
  if (options.sink) {
    const prev = await safeLoadLatest(options.sink);
    changed = hasBodyChanged(prev, graph);
    await options.sink.persist(graph);
    if (changed) {
      await options.sink.emitListChanged(graph.revision);
      logger.info('system-graph: body changed — listChanged fired', {
        revision: graph.revision,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      });
    } else {
      logger.debug('system-graph: body unchanged — no listChanged', {
        revision: graph.revision,
      });
    }
  }

  return {
    graph,
    changed,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

async function safeLoadLatest(sink: SystemGraphSink): Promise<SystemGraph | null> {
  try {
    return await sink.loadLatest();
  } catch (error) {
    logger.warn('system-graph: loadLatest failed — treating as first derivation', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
