/**
 * Minimal in-memory Drizzle-shaped fake for the four-eye ApprovalStore
 * tests. Backs `oauth_action_approvals` writes/reads with a plain Map so
 * the REAL `createPgApprovalStore` code path (insert/update/returning +
 * conditional compare-and-set on `status`) is exercised without a live
 * Postgres, and rows PERSIST across "requests" (a fresh store built over
 * the same fake proves durability / restart survival).
 *
 * It supports exactly the query shapes the store + the mcp-public route
 * emit:
 *   - db.select().from().where(eq(id)).limit(1)            (getRow)
 *   - db.select({..}).from().where().limit(1)              (auth / tenant)
 *   - db.insert(table).values(v).returning()               (create)
 *   - db.update(table).set(s).where(and(eq(id),eq(status))).returning()
 *
 * The `where` predicate is decoded structurally from the drizzle SQL
 * object (column refs + bound params) so we do not depend on drizzle's
 * internal AST beyond the two operators the store uses (`eq`, `and`).
 */

export interface ApprovalRow {
  id: string;
  token_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: string;
  requested_at: Date;
  expires_at: Date;
  initiated_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  denied_at: Date | null;
  consumed_at: Date | null;
}

// Camel-cased row shape drizzle returns for `oauth_action_approvals`
// (the store's pgTable maps snake DB columns to camel JS keys).
function toCamel(r: ApprovalRow): Record<string, unknown> {
  return {
    id: r.id,
    tokenId: r.token_id,
    toolName: r.tool_name,
    arguments: r.arguments,
    status: r.status,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
    initiatedBy: r.initiated_by,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    deniedAt: r.denied_at,
    consumedAt: r.consumed_at,
  };
}

let seq = 0;

/**
 * A shared store of approval rows. Passing the SAME store instance into
 * two `makeFakeApprovalDb` calls simulates two gateway processes /
 * requests over one durable table (restart survival).
 */
export function makeApprovalRowStore(): Map<string, ApprovalRow> {
  return new Map<string, ApprovalRow>();
}

interface FakeDbDeps {
  readonly rows: Map<string, ApprovalRow>;
  /** Answers the agent-token + tenant reads the mcp-public route makes. */
  readonly authRow?: Record<string, unknown> | null;
  readonly tenantRow?: Record<string, unknown> | null;
}

// Decode `{ id?, status? }` filters out of a drizzle where() object by
// walking its bound query chunks. `eq(col, val)` and `and(...)` are the
// only operators the store uses. The chunk list interleaves column refs
// (which carry a `name`) and bound `Param` nodes (which carry `value`),
// in order; we pair each column name with the next literal value we see.
// A visited-set guards the walk against drizzle's circular SQL objects.
function decodeFilter(where: unknown): { id?: string; status?: string } {
  const out: { id?: string; status?: string } = {};
  const ordered: Array<{ kind: 'col'; name: string } | { kind: 'val'; value: unknown }> = [];
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    const anyNode = node as Record<string, unknown>;
    // A drizzle Column carries a string `name` + `columnType`. Record it
    // and do NOT recurse — a column's `.table` back-reference holds EVERY
    // sibling column, which would corrupt the interleaved col/val order.
    if (typeof anyNode['name'] === 'string' && 'columnType' in anyNode) {
      ordered.push({ kind: 'col', name: anyNode['name'] as string });
      return;
    }
    // A drizzle Param carries `value` + `encoder` (not a column). Record
    // the bound literal and do not recurse into it.
    if ('value' in anyNode && 'encoder' in anyNode) {
      ordered.push({ kind: 'val', value: anyNode['value'] });
      return;
    }
    for (const key of Object.keys(anyNode)) {
      const v = anyNode[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(where);
  // Pair each column with the next value chunk after it.
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i];
    if (node.kind !== 'col') continue;
    const next = ordered[i + 1];
    if (!next || next.kind !== 'val') continue;
    if (node.name === 'id' && typeof next.value === 'string') out.id = next.value;
    if (node.name === 'status' && typeof next.value === 'string') out.status = next.value;
  }
  return out;
}

export function makeFakeApprovalDb(deps: FakeDbDeps) {
  const { rows } = deps;

  return {
    // ── reads ────────────────────────────────────────────────────────
    select(selector?: Record<string, unknown>) {
      const keys = selector ? Object.keys(selector) : [];
      return {
        from() {
          return {
            where(where: unknown) {
              return {
                async limit(_n: number) {
                  // Projected reads the mcp-public route makes.
                  if (keys.includes('clientLabel')) {
                    return deps.authRow ? [deps.authRow] : [];
                  }
                  if (keys.includes('level')) return [];
                  if (keys.length === 1 && keys[0] === 'tenantId') {
                    return deps.tenantRow ? [deps.tenantRow] : [];
                  }
                  // Full-row select().from().where(eq(id)).limit(1) — getRow.
                  const f = decodeFilter(where);
                  if (f.id) {
                    const row = rows.get(f.id);
                    return row ? [toCamel(row)] : [];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },

    // ── create ───────────────────────────────────────────────────────
    insert(_table: unknown) {
      return {
        values(v: Record<string, unknown>) {
          return {
            async returning() {
              const id = (v['id'] as string) ?? `appr-${++seq}`;
              const row: ApprovalRow = {
                id,
                token_id: v['tokenId'] as string,
                tool_name: v['toolName'] as string,
                arguments: (v['arguments'] as Record<string, unknown>) ?? {},
                status: (v['status'] as string) ?? 'pending',
                requested_at: (v['requestedAt'] as Date) ?? new Date(),
                expires_at: v['expiresAt'] as Date,
                initiated_by: (v['initiatedBy'] as string) ?? null,
                approved_at: null,
                approved_by: null,
                denied_at: null,
                consumed_at: null,
              };
              rows.set(id, row);
              return [toCamel(row)];
            },
          };
        },
      };
    },

    // ── conditional update (compare-and-set) ─────────────────────────
    update(_table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(where: unknown) {
              const applyPatch = (): ApprovalRow[] => {
                const f = decodeFilter(where);
                if (!f.id) return [];
                const row = rows.get(f.id);
                if (!row) return [];
                // Compare-and-set: the `status` predicate must match the
                // CURRENT row status or the update matches zero rows.
                if (f.status && row.status !== f.status) return [];
                const next: ApprovalRow = { ...row };
                if ('status' in patch) next.status = patch['status'] as string;
                if ('approvedAt' in patch) next.approved_at = patch['approvedAt'] as Date;
                if ('approvedBy' in patch) next.approved_by = patch['approvedBy'] as string;
                if ('deniedAt' in patch) next.denied_at = patch['deniedAt'] as Date;
                if ('consumedAt' in patch) next.consumed_at = patch['consumedAt'] as Date;
                rows.set(next.id, next);
                return [next];
              };
              return {
                async returning() {
                  return applyPatch().map(toCamel);
                },
                // Non-returning update (the expiry flip) — still applies.
                then(resolve: (v: unknown) => void) {
                  applyPatch();
                  resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
  };
}
