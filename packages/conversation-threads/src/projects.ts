/**
 * Project CRUD — MD-tier folders.
 *
 * Hard rule: only personas with power_tier ≤ 3 may own a project.
 * Customers and field staff get a single thread per channel instead.
 * The check is *here* (not in the database) because the schema permits
 * any persona — that lets a future expansion (e.g. T4 receiving a
 * temporary "project owner" promotion) work without a migration.
 *
 * I/O is delegated to a `ProjectRepository` port so the module remains
 * pure for unit tests.
 */

import type { Project } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Repository port
// ─────────────────────────────────────────────────────────────────────

export interface ProjectRepository {
  insert(args: { readonly tenantId: string; readonly row: Project }): Promise<Project>;
  update(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly patch: Partial<Omit<Project, 'id' | 'tenantId' | 'createdAt'>>;
  }): Promise<Project>;
  findById(args: {
    readonly tenantId: string;
    readonly id: string;
  }): Promise<Project | null>;
  listForOwner(args: {
    readonly tenantId: string;
    readonly ownerUserId: string;
    readonly ownerPersonaId: string;
    readonly includeArchived?: boolean;
  }): Promise<ReadonlyArray<Project>>;
  archive(args: {
    readonly tenantId: string;
    readonly id: string;
    readonly at: Date;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Tier gate
// ─────────────────────────────────────────────────────────────────────

export const MAX_TIER_FOR_PROJECTS = 3;

export class ProjectTierError extends Error {
  public override readonly name = 'ProjectTierError';
  public readonly personaTier: number;
  constructor(personaTier: number) {
    super(
      `personas with power_tier > ${MAX_TIER_FOR_PROJECTS} cannot own projects (got ${personaTier})`,
    );
    this.personaTier = personaTier;
  }
}

export interface CreateProjectArgs {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerPersonaId: string;
  /** Persona's power_tier — checked against MAX_TIER_FOR_PROJECTS. */
  readonly ownerPersonaTier: number;
  readonly name: string;
  readonly description?: string;
  readonly moduleScope?: ReadonlyArray<string>;
  readonly customInstructions?: string;
  readonly memoryScopeId?: string;
  readonly pinned?: boolean;
  readonly idGenerator: () => string;
  readonly now?: () => Date;
  readonly repository: ProjectRepository;
}

/**
 * Create a new project. Throws `ProjectTierError` when the persona's
 * tier is > MAX_TIER_FOR_PROJECTS.
 */
export async function createProject(
  args: CreateProjectArgs,
): Promise<Project> {
  if (args.ownerPersonaTier > MAX_TIER_FOR_PROJECTS) {
    throw new ProjectTierError(args.ownerPersonaTier);
  }

  const now = args.now?.() ?? new Date();
  const row: Project = {
    id: args.idGenerator(),
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    ownerPersonaId: args.ownerPersonaId,
    name: args.name,
    moduleScope: args.moduleScope ? [...args.moduleScope] : [],
    pinned: args.pinned ?? false,
    createdAt: now,
    updatedAt: now,
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.customInstructions !== undefined
      ? { customInstructions: args.customInstructions }
      : {}),
    ...(args.memoryScopeId !== undefined ? { memoryScopeId: args.memoryScopeId } : {}),
  };
  return args.repository.insert({ tenantId: args.tenantId, row });
}

/**
 * Update mutable fields on a project. Tenant- and owner-scoping must
 * be enforced upstream by the caller / repository RLS.
 */
export async function updateProject(args: {
  readonly tenantId: string;
  readonly id: string;
  readonly patch: Partial<Omit<Project, 'id' | 'tenantId' | 'ownerUserId' | 'ownerPersonaId' | 'createdAt'>>;
  readonly repository: ProjectRepository;
}): Promise<Project> {
  return args.repository.update({
    tenantId: args.tenantId,
    id: args.id,
    patch: args.patch,
  });
}

/**
 * Archive a project. The thread retention sweep eventually hard-deletes
 * archived rows older than the tenant's policy.
 */
export async function archiveProject(args: {
  readonly tenantId: string;
  readonly id: string;
  readonly now?: () => Date;
  readonly repository: ProjectRepository;
}): Promise<void> {
  const at = args.now?.() ?? new Date();
  await args.repository.archive({
    tenantId: args.tenantId,
    id: args.id,
    at,
  });
}

export async function getProject(args: {
  readonly tenantId: string;
  readonly id: string;
  readonly repository: ProjectRepository;
}): Promise<Project | null> {
  return args.repository.findById({
    tenantId: args.tenantId,
    id: args.id,
  });
}

export async function listProjects(args: {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly ownerPersonaId: string;
  readonly includeArchived?: boolean;
  readonly repository: ProjectRepository;
}): Promise<ReadonlyArray<Project>> {
  return args.repository.listForOwner({
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    ownerPersonaId: args.ownerPersonaId,
    ...(args.includeArchived !== undefined
      ? { includeArchived: args.includeArchived }
      : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────
// In-memory repository for tests + dev
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryProjectRepository(): ProjectRepository {
  const byTenant = new Map<string, Map<string, Project>>();

  function getBucket(tenantId: string): Map<string, Project> {
    let m = byTenant.get(tenantId);
    if (!m) {
      m = new Map();
      byTenant.set(tenantId, m);
    }
    return m;
  }

  return {
    async insert({ tenantId, row }) {
      getBucket(tenantId).set(row.id, row);
      return row;
    },
    async update({ tenantId, id, patch }) {
      const bucket = getBucket(tenantId);
      const existing = bucket.get(id);
      if (!existing) {
        throw new Error(`project ${id} not found in tenant ${tenantId}`);
      }
      const next: Project = {
        ...existing,
        ...patch,
        updatedAt: patch.updatedAt ?? new Date(),
      };
      bucket.set(id, next);
      return next;
    },
    async findById({ tenantId, id }) {
      return getBucket(tenantId).get(id) ?? null;
    },
    async listForOwner({ tenantId, ownerUserId, ownerPersonaId, includeArchived }) {
      const out: Project[] = [];
      for (const p of getBucket(tenantId).values()) {
        if (p.ownerUserId !== ownerUserId) continue;
        if (p.ownerPersonaId !== ownerPersonaId) continue;
        if (p.archivedAt && !includeArchived) continue;
        out.push(p);
      }
      return out;
    },
    async archive({ tenantId, id, at }) {
      const bucket = getBucket(tenantId);
      const existing = bucket.get(id);
      if (!existing) {
        throw new Error(`project ${id} not found in tenant ${tenantId}`);
      }
      bucket.set(id, { ...existing, archivedAt: at, updatedAt: at });
    },
  };
}
