/**
 * Versioned artifacts inside a thread.
 *
 * Each "artifact" is identified by an `id` shared across versions. A
 * new revision is a NEW row with the same id and bumped `version`,
 * carrying `parent_version_id` set to the previous row's primary key
 * (we use a synthetic version-key string for `parent_version_id`).
 *
 * `branchArtifact` creates a divergent version from a non-latest
 * parent — useful when the user says "go back to version 2 and try a
 * different chart". The branched version reads the source's
 * `content_jsonb` as its starting point.
 */

import type { Artifact, ArtifactType } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Repository port
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactRepository {
  insert(args: {
    readonly tenantId: string;
    readonly row: Artifact;
  }): Promise<Artifact>;
  findHighestVersion(args: {
    readonly tenantId: string;
    readonly threadId: string;
    readonly id: string;
  }): Promise<Artifact | null>;
  findVersion(args: {
    readonly tenantId: string;
    readonly threadId: string;
    readonly id: string;
    readonly version: number;
  }): Promise<Artifact | null>;
  listVersions(args: {
    readonly tenantId: string;
    readonly threadId: string;
    readonly id: string;
  }): Promise<ReadonlyArray<Artifact>>;
}

// ─────────────────────────────────────────────────────────────────────
// Create v1
// ─────────────────────────────────────────────────────────────────────

export interface CreateArtifactArgs {
  readonly tenantId: string;
  readonly threadId: string;
  readonly artifactType: ArtifactType;
  readonly contentJsonb: Record<string, unknown>;
  readonly title?: string;
  readonly idGenerator: () => string;
  readonly now?: () => Date;
  readonly repository: ArtifactRepository;
}

export async function createArtifact(
  args: CreateArtifactArgs,
): Promise<Artifact> {
  const now = args.now?.() ?? new Date();
  const row: Artifact = {
    id: args.idGenerator(),
    threadId: args.threadId,
    tenantId: args.tenantId,
    artifactType: args.artifactType,
    version: 1,
    contentJsonb: args.contentJsonb,
    createdAt: now,
    ...(args.title !== undefined ? { title: args.title } : {}),
  };
  return args.repository.insert({ tenantId: args.tenantId, row });
}

// ─────────────────────────────────────────────────────────────────────
// Bump version (linear)
// ─────────────────────────────────────────────────────────────────────

export interface BumpVersionArgs {
  readonly tenantId: string;
  readonly threadId: string;
  readonly id: string;
  readonly contentJsonb: Record<string, unknown>;
  readonly title?: string;
  readonly now?: () => Date;
  readonly repository: ArtifactRepository;
}

export async function bumpArtifactVersion(
  args: BumpVersionArgs,
): Promise<Artifact> {
  const latest = await args.repository.findHighestVersion({
    tenantId: args.tenantId,
    threadId: args.threadId,
    id: args.id,
  });
  if (!latest) {
    throw new Error(
      `cannot bump: artifact ${args.id} not found in thread ${args.threadId}`,
    );
  }
  const now = args.now?.() ?? new Date();
  const next: Artifact = {
    id: args.id,
    threadId: args.threadId,
    tenantId: args.tenantId,
    artifactType: latest.artifactType,
    version: latest.version + 1,
    parentVersionId: artifactVersionKey({
      id: latest.id,
      version: latest.version,
    }),
    contentJsonb: args.contentJsonb,
    createdAt: now,
    ...(args.title !== undefined ? { title: args.title } : { title: latest.title }),
  };
  return args.repository.insert({ tenantId: args.tenantId, row: next });
}

// ─────────────────────────────────────────────────────────────────────
// Branch from a specific version (divergent)
// ─────────────────────────────────────────────────────────────────────

export interface BranchArtifactArgs {
  readonly tenantId: string;
  readonly threadId: string;
  readonly id: string;
  readonly fromVersion: number;
  /** Optional content override; defaults to the source version's content. */
  readonly contentJsonb?: Record<string, unknown>;
  readonly title?: string;
  readonly now?: () => Date;
  readonly repository: ArtifactRepository;
}

export async function branchArtifact(
  args: BranchArtifactArgs,
): Promise<Artifact> {
  const source = await args.repository.findVersion({
    tenantId: args.tenantId,
    threadId: args.threadId,
    id: args.id,
    version: args.fromVersion,
  });
  if (!source) {
    throw new Error(
      `cannot branch: ${args.id} v${args.fromVersion} not found in thread ${args.threadId}`,
    );
  }
  const latest = await args.repository.findHighestVersion({
    tenantId: args.tenantId,
    threadId: args.threadId,
    id: args.id,
  });
  const now = args.now?.() ?? new Date();
  const nextVersion = (latest?.version ?? source.version) + 1;
  const next: Artifact = {
    id: args.id,
    threadId: args.threadId,
    tenantId: args.tenantId,
    artifactType: source.artifactType,
    version: nextVersion,
    parentVersionId: artifactVersionKey({
      id: source.id,
      version: source.version,
    }),
    contentJsonb: args.contentJsonb ?? source.contentJsonb,
    createdAt: now,
    ...(args.title !== undefined ? { title: args.title } : { title: source.title }),
  };
  return args.repository.insert({ tenantId: args.tenantId, row: next });
}

// ─────────────────────────────────────────────────────────────────────
// Synthetic version key (id@version)
// ─────────────────────────────────────────────────────────────────────

export function artifactVersionKey(args: {
  readonly id: string;
  readonly version: number;
}): string {
  return `${args.id}@v${args.version}`;
}

export async function listArtifactVersions(args: {
  readonly tenantId: string;
  readonly threadId: string;
  readonly id: string;
  readonly repository: ArtifactRepository;
}): Promise<ReadonlyArray<Artifact>> {
  return args.repository.listVersions({
    tenantId: args.tenantId,
    threadId: args.threadId,
    id: args.id,
  });
}

// ─────────────────────────────────────────────────────────────────────
// In-memory repository
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryArtifactRepository(): ArtifactRepository {
  const byTenant = new Map<string, Map<string, Artifact[]>>();
  function key(threadId: string, id: string): string {
    return `${threadId}::${id}`;
  }
  function bucket(tenantId: string): Map<string, Artifact[]> {
    let m = byTenant.get(tenantId);
    if (!m) {
      m = new Map();
      byTenant.set(tenantId, m);
    }
    return m;
  }

  return {
    async insert({ tenantId, row }) {
      const b = bucket(tenantId);
      const k = key(row.threadId, row.id);
      let list = b.get(k);
      if (!list) {
        list = [];
        b.set(k, list);
      }
      list.push(row);
      return row;
    },
    async findHighestVersion({ tenantId, threadId, id }) {
      const list = bucket(tenantId).get(key(threadId, id));
      if (!list || list.length === 0) return null;
      let best: Artifact | null = null;
      for (const a of list) {
        if (!best || a.version > best.version) best = a;
      }
      return best;
    },
    async findVersion({ tenantId, threadId, id, version }) {
      const list = bucket(tenantId).get(key(threadId, id)) ?? [];
      return list.find((a) => a.version === version) ?? null;
    },
    async listVersions({ tenantId, threadId, id }) {
      return bucket(tenantId).get(key(threadId, id)) ?? [];
    },
  };
}
