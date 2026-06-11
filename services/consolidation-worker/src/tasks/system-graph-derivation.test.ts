/**
 * System-graph derivation task — FS walkers + orchestration + listChanged.
 *
 * Builds a throwaway fixture repo tree under os.tmpdir() so the impure
 * walkers have something to walk, then asserts the derived body schema +
 * the listChanged-on-revision-change contract.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemGraph } from '@borjie/system-graph';
import {
  deriveSystemGraph,
  walkPackages,
  walkRoutes,
  walkScreens,
  walkSchemas,
  type SystemGraphSink,
} from './system-graph-derivation.js';

let repoRoot: string;

async function write(rel: string, content: string): Promise<void> {
  const full = join(repoRoot, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'sysgraph-'));

  // Packages + services with @borjie deps.
  await write(
    'packages/central-intelligence/package.json',
    JSON.stringify({
      name: '@borjie/central-intelligence',
      dependencies: { '@borjie/system-graph': 'workspace:*', zod: '^3' },
    }),
  );
  await write(
    'packages/system-graph/package.json',
    JSON.stringify({ name: '@borjie/system-graph', dependencies: {} }),
  );
  await write(
    'services/api-gateway/package.json',
    JSON.stringify({ name: '@borjie/api-gateway', dependencies: {} }),
  );

  // Hono routes.
  await write('services/api-gateway/src/routes/mining/bids.hono.ts', 'export const x = 1;');
  await write('services/api-gateway/src/routes/users.hono.ts', 'export const x = 1;');

  // App screens (Expo-style app/ dir, including a route group).
  await write('apps/owner-web/app/royalties.tsx', 'export default function S() {}');
  await write('apps/buyer-mobile/app/(tabs)/index.tsx', 'export default function S() {}');
  await write('apps/buyer-mobile/app/_layout.tsx', 'export default function L() {}');

  // Drizzle schema with pgTable.
  await write(
    'packages/database/src/schemas/marketplace-bids.schema.ts',
    `export const bids = pgTable('marketplace_bids', {});\nexport const negotiations = pgTable("bid_negotiations", {});`,
  );
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('walkPackages', () => {
  it('finds @borjie packages + services and their @borjie deps', async () => {
    const pkgs = await walkPackages(repoRoot);
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toContain('@borjie/central-intelligence');
    expect(names).toContain('@borjie/api-gateway');
    const ci = pkgs.find((p) => p.name === '@borjie/central-intelligence')!;
    expect(ci.deps).toEqual(['@borjie/system-graph']);
  });
});

describe('walkRoutes', () => {
  it('collects nested + top-level hono routes', async () => {
    const routes = await walkRoutes(repoRoot);
    const groups = routes.map((r) => r.group).sort();
    expect(groups).toContain('mining/bids');
    expect(groups).toContain('users');
    expect(routes.every((r) => r.service === 'api-gateway')).toBe(true);
  });
});

describe('walkScreens', () => {
  it('finds screens across surfaces, strips route-group parens, skips _layout', async () => {
    const screens = await walkScreens(repoRoot);
    const bySurface = new Map(screens.map((s) => [`${s.surface}/${s.screen}`, s]));
    expect(bySurface.has('owner-web/royalties')).toBe(true);
    expect(bySurface.has('buyer-mobile/tabs')).toBe(true);
    expect([...bySurface.keys()].some((k) => k.includes('_layout'))).toBe(false);
  });
});

describe('walkSchemas', () => {
  it('extracts every pgTable name', async () => {
    const schemas = await walkSchemas(repoRoot);
    const tables = schemas.map((s) => s.table).sort();
    expect(tables).toEqual(['bid_negotiations', 'marketplace_bids']);
  });
});

describe('deriveSystemGraph', () => {
  const now = () => new Date('2026-06-08T00:00:00.000Z');

  it('composes a body schema with the LAYER-0 self + derived organs', async () => {
    const result = await deriveSystemGraph({ repoRoot, now });
    const kinds = new Set(result.graph.nodes.map((n) => n.kind));
    expect(kinds.has('org')).toBe(true);
    expect(kinds.has('package')).toBe(true);
    expect(kinds.has('service')).toBe(true);
    expect(kinds.has('surface')).toBe(true);
    expect(kinds.has('screen')).toBe(true);
    expect(kinds.has('schema')).toBe(true);
    expect(result.nodeCount).toBeGreaterThan(0);
  });

  it('merges injected dynamic registries (capabilities / mcp / juniors)', async () => {
    const result = await deriveSystemGraph({
      repoRoot,
      now,
      registries: {
        listCapabilities: async () => [
          { id: 'offtake', label: 'Offtake', lifecycle: 'live', governedBy: 'four_eye' },
        ],
        listMcpTools: async () => [{ tool: 'mining.bids.list', service: 'api-gateway' }],
        listJuniors: async () => [
          { id: 'metallurgy', label: 'Metallurgy', serves: ['offtake'] },
        ],
      },
    });
    const ids = new Set(result.graph.nodes.map((n) => n.id));
    expect(ids.has('capability:offtake')).toBe(true);
    expect(ids.has('mcp:mining.bids.list')).toBe(true);
    expect(ids.has('junior:metallurgy')).toBe(true);
    // junior serves capability — the serves edge survives (both endpoints exist).
    const serves = result.graph.edges.find((e) => e.edgeType === 'serves');
    expect(serves?.dstId).toBe('capability:offtake');
  });

  it('fires listChanged only when the body actually changed', async () => {
    let stored: SystemGraph | null = null;
    const changedRevisions: string[] = [];
    const sink: SystemGraphSink = {
      loadLatest: async () => stored,
      persist: async (g) => {
        stored = g;
      },
      emitListChanged: async (rev) => {
        changedRevisions.push(rev);
      },
    };

    // First derivation — body is new, listChanged fires.
    const first = await deriveSystemGraph({ repoRoot, now, sink });
    expect(first.changed).toBe(true);
    expect(changedRevisions).toHaveLength(1);

    // Second derivation with identical inputs — no change, no listChanged.
    const second = await deriveSystemGraph({ repoRoot, now, sink });
    expect(second.changed).toBe(false);
    expect(changedRevisions).toHaveLength(1);
    expect(second.graph.revision).toBe(first.graph.revision);
  });

  it('is resilient to a missing repo (empty body, no throw)', async () => {
    const result = await deriveSystemGraph({
      repoRoot: join(repoRoot, 'does-not-exist'),
      now,
    });
    // Only the LAYER-0 self survives when nothing else is walkable.
    expect(result.graph.nodes.map((n) => n.kind)).toEqual(['org']);
  });
});
