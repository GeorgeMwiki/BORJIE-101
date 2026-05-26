/**
 * Delta applier — applies a typed `LegibilityDelta` to a public map.
 *
 * Wave M6. The fast path of the dual refresh model (§16). Deltas
 * are typed by the SQL CHECK constraint in `legibility_deltas`. The
 * applier is pure: `(map, delta) → nextMap`. Internal-axis deltas
 * (junior.*) are routed to the internal variant only.
 */

import { computeLegibilityAuditHash } from '../audit/audit-chain-link.js';
import type {
  CapabilityRef,
  InternalLegibilityMap,
  JuniorAssignment,
  JuniorRouteEdge,
  LegibilityDelta,
  LegibilityDeltaKind,
  PersonNode,
  PublicLegibilityMap,
  RoleEdge,
  ScopeNode,
  WorkItem,
} from '../types.js';

export class DeltaApplyError extends Error {
  public readonly kind: LegibilityDeltaKind;
  public readonly reason: string;
  constructor(kind: LegibilityDeltaKind, reason: string) {
    super(`legibility: cannot apply ${kind}: ${reason}`);
    this.name = 'DeltaApplyError';
    this.kind = kind;
    this.reason = reason;
  }
}

/**
 * Apply a single delta to the public map. Throws if the delta payload
 * is malformed. Returns a frozen new map with a refreshed audit hash.
 */
export function applyPublicDelta(
  map: PublicLegibilityMap,
  delta: LegibilityDelta,
  now: Date,
): PublicLegibilityMap {
  let next: PublicLegibilityMap = map;
  switch (delta.deltaKind) {
    case 'person.added': {
      const person = readPerson(delta);
      next = { ...next, people: [...next.people, person] };
      break;
    }
    case 'person.removed': {
      const personId = String(delta.payload['personId'] ?? '');
      next = {
        ...next,
        people: next.people.filter((p) => p.personId !== personId),
        roles: next.roles.filter((r) => r.personId !== personId),
      };
      break;
    }
    case 'role.granted': {
      const edge = readRole(delta);
      next = { ...next, roles: [...next.roles, edge] };
      break;
    }
    case 'role.revoked': {
      const personId = String(delta.payload['personId'] ?? '');
      const role = String(delta.payload['role'] ?? '');
      const scopeId = String(delta.payload['scopeId'] ?? '');
      next = {
        ...next,
        roles: next.roles.filter(
          (r) => !(r.personId === personId && r.role === role && r.scopeId === scopeId),
        ),
      };
      break;
    }
    case 'scope.added': {
      const scope = readScope(delta);
      next = { ...next, scopes: [...next.scopes, scope] };
      break;
    }
    case 'scope.archived': {
      const scopeId = String(delta.payload['scopeId'] ?? '');
      next = {
        ...next,
        scopes: next.scopes.filter((s) => s.scopeId !== scopeId),
      };
      break;
    }
    case 'capability.activated': {
      const cap = readCapability(delta);
      next = { ...next, capabilities: [...next.capabilities, cap] };
      break;
    }
    case 'capability.retired': {
      const capabilityId = String(delta.payload['capabilityId'] ?? '');
      next = {
        ...next,
        capabilities: next.capabilities.filter(
          (c) => c.capabilityId !== capabilityId,
        ),
      };
      break;
    }
    case 'work.started': {
      const item = readWork(delta);
      next = { ...next, currentWork: [...next.currentWork, item] };
      break;
    }
    case 'work.blocked': {
      const subject = readSubject(delta);
      const blocker = String(delta.payload['blocker'] ?? '');
      next = {
        ...next,
        currentWork: next.currentWork.map((w) =>
          w.subject.kind === subject.kind && w.subject.id === subject.id
            ? { ...w, blocker }
            : w,
        ),
      };
      break;
    }
    case 'work.completed': {
      const subject = readSubject(delta);
      next = {
        ...next,
        currentWork: next.currentWork.filter(
          (w) => !(w.subject.kind === subject.kind && w.subject.id === subject.id),
        ),
      };
      break;
    }
    case 'reconciliation.divergence':
      // No-op on the public map; the divergence is logged but the
      // canonical state comes from the slow path snapshot.
      break;
    case 'junior.assigned':
    case 'junior.released':
      // Internal-only delta — must not appear on the public path.
      throw new DeltaApplyError(
        delta.deltaKind,
        'junior deltas are internal-only — call applyInternalDelta instead',
      );
    default: {
      const exhaustive: never = delta.deltaKind;
      throw new DeltaApplyError(
        delta.deltaKind,
        `unknown delta kind ${String(exhaustive)}`,
      );
    }
  }

  return Object.freeze({
    ...next,
    assembledAt: now.toISOString(),
    auditHash: computeLegibilityAuditHash(
      {
        op: 'legibility.delta.public',
        deltaKind: delta.deltaKind,
        prevHash: map.auditHash,
        atMs: now.getTime(),
      },
      map.auditHash,
    ),
  });
}

/**
 * Apply a delta to the internal variant. Accepts both public-axis
 * deltas (delegated to `applyPublicDelta`) and the two junior-only
 * kinds.
 */
export function applyInternalDelta(
  map: InternalLegibilityMap,
  delta: LegibilityDelta,
  now: Date,
): InternalLegibilityMap {
  if (delta.deltaKind === 'junior.assigned') {
    const assignment = readJuniorAssignment(delta);
    return Object.freeze({
      ...map,
      juniors: [...map.juniors, assignment],
      assembledAt: now.toISOString(),
    });
  }
  if (delta.deltaKind === 'junior.released') {
    const juniorId = String(delta.payload['juniorId'] ?? '');
    return Object.freeze({
      ...map,
      juniors: map.juniors.filter((j) => j.juniorId !== juniorId),
      assembledAt: now.toISOString(),
    });
  }
  // Delegate to the public reducer; the internal axis stays untouched.
  const publicNext = applyPublicDelta(map, delta, now);
  return Object.freeze({
    ...publicNext,
    juniors: map.juniors,
    juniorRoutes: map.juniorRoutes,
  });
}

// ---------------------------------------------------------------------------
// Payload readers — throw `DeltaApplyError` on malformed input.
// ---------------------------------------------------------------------------

function readPerson(delta: LegibilityDelta): PersonNode {
  const personId = delta.payload['personId'];
  const displayName = delta.payload['displayName'];
  const primaryRole = delta.payload['primaryRole'];
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'payload.personId required');
  }
  if (typeof displayName !== 'string') {
    throw new DeltaApplyError(delta.deltaKind, 'payload.displayName required');
  }
  if (typeof primaryRole !== 'string') {
    throw new DeltaApplyError(delta.deltaKind, 'payload.primaryRole required');
  }
  return {
    personId,
    displayName,
    primaryRole: primaryRole as PersonNode['primaryRole'],
  };
}

function readRole(delta: LegibilityDelta): RoleEdge {
  const personId = String(delta.payload['personId'] ?? '');
  const role = String(delta.payload['role'] ?? '');
  const scopeId = String(delta.payload['scopeId'] ?? '');
  const since = String(delta.payload['since'] ?? new Date(0).toISOString());
  if (personId.length === 0 || role.length === 0 || scopeId.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'role edge fields required');
  }
  return { personId, role: role as RoleEdge['role'], scopeId, since };
}

function readScope(delta: LegibilityDelta): ScopeNode {
  const scopeId = String(delta.payload['scopeId'] ?? '');
  const kind = String(delta.payload['kind'] ?? '');
  const displayName = String(delta.payload['displayName'] ?? '');
  const parentScopeId = delta.payload['parentScopeId'];
  if (scopeId.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'scope.scopeId required');
  }
  return {
    scopeId,
    kind,
    parentScopeId: typeof parentScopeId === 'string' ? parentScopeId : null,
    displayName,
  };
}

function readCapability(delta: LegibilityDelta): CapabilityRef {
  const capabilityId = String(delta.payload['capabilityId'] ?? '');
  const version = Number(delta.payload['version'] ?? 0);
  const status = String(delta.payload['status'] ?? 'live') as CapabilityRef['status'];
  const owner = delta.payload['owner'];
  if (capabilityId.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'capability.capabilityId required');
  }
  return {
    capabilityId,
    version,
    status,
    owner: typeof owner === 'string' ? owner : null,
  };
}

function readWork(delta: LegibilityDelta): WorkItem {
  const subject = readSubject(delta);
  const kind = String(delta.payload['kind'] ?? 'work');
  const owner = delta.payload['owner'];
  const startedAt = String(delta.payload['startedAt'] ?? new Date(0).toISOString());
  const blocker = delta.payload['blocker'];
  return {
    subject,
    kind,
    owner: typeof owner === 'string' ? owner : null,
    startedAt,
    blocker: typeof blocker === 'string' ? blocker : null,
  };
}

function readSubject(delta: LegibilityDelta): { kind: string; id: string } {
  const sub = delta.payload['subject'];
  if (sub === null || typeof sub !== 'object') {
    throw new DeltaApplyError(delta.deltaKind, 'payload.subject required');
  }
  const kind = String((sub as Record<string, unknown>)['kind'] ?? '');
  const id = String((sub as Record<string, unknown>)['id'] ?? '');
  if (kind.length === 0 || id.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'subject.kind + subject.id required');
  }
  return { kind, id };
}

function readJuniorAssignment(delta: LegibilityDelta): JuniorAssignment {
  const juniorId = String(delta.payload['juniorId'] ?? '');
  const capabilityId = String(delta.payload['capabilityId'] ?? '');
  const scopeId = String(delta.payload['scopeId'] ?? '');
  const subject = readSubject(delta);
  const assignedAt = String(delta.payload['assignedAt'] ?? new Date(0).toISOString());
  if (juniorId.length === 0) {
    throw new DeltaApplyError(delta.deltaKind, 'junior.juniorId required');
  }
  return { juniorId, subject, scopeId, capabilityId, assignedAt };
}

// keep JuniorRouteEdge type referenced for downstream
void (null as unknown as JuniorRouteEdge);
