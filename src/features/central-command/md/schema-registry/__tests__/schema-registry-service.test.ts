/**
 * Tests — Schema-registry service. Uses an in-memory fake Supabase
 * that mimics the query-chain shape the service expects.
 */

import { describe, expect, it, beforeEach } from "vitest";

import {
  makeSchemaRegistryService,
  type SchemaRegistrySupabaseLike,
} from "../schema-registry-service";
import type { FieldProposalInput } from "../types";

const ORG = "00000000-0000-0000-0000-00000000000a";
const APPROVER = "00000000-0000-0000-0000-0000000000aa";

interface Row {
  [k: string]: unknown;
}

/**
 * Tiny chainable fake — supports the subset of supabase-js v2 calls
 * the service actually uses: from().select(...).eq().eq().limit() etc.
 */
function makeFakeSupabase() {
  const tables = new Map<string, Row[]>();
  tables.set("field_proposals", []);
  tables.set("org_field_schemas", []);

  function chain(table: string, filters: Array<[string, unknown]> = []) {
    const get = () => {
      const rows = (tables.get(table) ?? []).filter((r) =>
        filters.every(([k, v]) => r[k] === v),
      );
      return Promise.resolve({ data: rows, error: null });
    };
    const builder = {
      eq(col: string, val: unknown) {
        return chain(table, [...filters, [col, val]]);
      },
      is(col: string, val: unknown) {
        return chain(table, [...filters, [col, val]]);
      },
      order() {
        return builder;
      },
      limit() {
        return get();
      },
      maybeSingle() {
        return get().then((r) => ({ data: r.data?.[0] ?? null, error: null }));
      },
      then(resolve: (v: unknown) => unknown) {
        return get().then(resolve);
      },
    };
    return builder;
  }

  const api: SchemaRegistrySupabaseLike = {
    from(table: string) {
      const rows = tables.get(table) ?? [];
      tables.set(table, rows);
      return {
        select() {
          return chain(table);
        },
        insert(input: unknown) {
          const incoming = Array.isArray(input) ? input : [input];
          const stamped = incoming.map((r) => ({
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            executed: false,
            status: "pending",
            ...(r as Row),
          }));
          for (const s of stamped) rows.push(s);
          return Promise.resolve({ data: stamped, error: null });
        },
        update(values: Row) {
          // Chainable .update().eq().eq()....eq() of arbitrary depth.
          // Each .eq() appends a filter and returns the same builder so
          // the await falls through `.then` whenever the consumer is
          // done chaining. Mirrors the real Supabase client shape.
          const makeUpdBuilder = (filters: Array<[string, unknown]>) => {
            const apply = () =>
              Promise.resolve({
                data: applyUpdate(rows, filters, values),
                error: null,
              });
            const builder = {
              eq(col: string, val: unknown) {
                return makeUpdBuilder([...filters, [col, val]]);
              },
              then(resolve: (v: unknown) => unknown) {
                return apply().then(resolve);
              },
            };
            return builder;
          };
          return makeUpdBuilder([]);
        },
      };
    },
  };
  return { api, tables };
}

function applyUpdate(
  rows: Row[],
  filters: ReadonlyArray<[string, unknown]>,
  values: Row,
): Row[] {
  const updated: Row[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (filters.every(([k, v]) => r[k] === v)) {
      const next = { ...r, ...values };
      rows[i] = next;
      updated.push(next);
    }
  }
  return updated;
}

function proposalInput(
  overrides: Partial<FieldProposalInput> = {},
): FieldProposalInput {
  return {
    orgId: ORG,
    tableKey: "employees",
    fieldKey: "shift_pattern",
    fieldLabel: "Shift pattern",
    fieldKind: "enum",
    enumValues: ["morning", "evening"],
    required: false,
    proposerKind: "junior",
    proposerId: "hr-csv-ingest",
    rationale:
      "New column detected in employees-2026-05.csv that the org's schema doesn't track.",
    sampleValues: ["morning", "evening"],
    ...overrides,
  };
}

describe("schema-registry-service", () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    fake = makeFakeSupabase();
  });

  it("rejects invalid proposal", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const r = await svc.proposeField({
      proposal: { ...proposalInput(), fieldKey: "1bad-key" },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_proposal/);
  });

  it("inserts a new proposal and is idempotent on pending key", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const first = await svc.proposeField({ proposal: proposalInput() });
    const second = await svc.proposeField({ proposal: proposalInput() });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.proposalId).toBe(first.proposalId);
    expect(fake.tables.get("field_proposals")!.length).toBe(1);
  });

  it("approve materialises a LiveField + flips executed", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const filed = await svc.proposeField({ proposal: proposalInput() });
    expect(filed.proposalId).toBeDefined();
    const ap = await svc.approveField({
      orgId: ORG,
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
    });
    expect(ap.ok).toBe(true);
    expect(ap.fieldId).toBeDefined();
    expect(fake.tables.get("org_field_schemas")!.length).toBe(1);
    const stored = fake.tables.get("field_proposals")![0]! as Record<
      string,
      unknown
    >;
    expect(stored.executed).toBe(true);
    expect(stored.status).toBe("approved");
  });

  it("C-1: approve from a foreign org returns not_found", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const filed = await svc.proposeField({ proposal: proposalInput() });
    const ap = await svc.approveField({
      orgId: "99999999-9999-9999-9999-999999999999",
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
    });
    expect(ap.ok).toBe(false);
    expect(ap.error).toBe("not_found");
    expect(fake.tables.get("org_field_schemas")!.length).toBe(0);
  });

  it("M-7: human self-approval is blocked", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const ownerProposal = proposalInput({
      proposerKind: "owner",
      proposerId: APPROVER, // same as the approver below
    });
    const filed = await svc.proposeField({ proposal: ownerProposal });
    const ap = await svc.approveField({
      orgId: ORG,
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
    });
    expect(ap.ok).toBe(false);
    expect(ap.error).toBe("self_approval_forbidden");
  });

  it("one-shot guard: second approve returns alreadyExecuted", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const filed = await svc.proposeField({ proposal: proposalInput() });
    await svc.approveField({
      orgId: ORG,
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
    });
    const replay = await svc.approveField({
      orgId: ORG,
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
    });
    expect(replay.alreadyExecuted).toBe(true);
    expect(fake.tables.get("org_field_schemas")!.length).toBe(1);
  });

  it("reject flips the proposal", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const filed = await svc.proposeField({ proposal: proposalInput() });
    const r = await svc.rejectField({
      orgId: ORG,
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
      reason: "not in scope for now",
    });
    expect(r.ok).toBe(true);
    const stored = fake.tables.get("field_proposals")![0]! as Record<
      string,
      unknown
    >;
    expect(stored.status).toBe("rejected");
    expect(stored.reject_reason).toBe("not in scope for now");
  });

  it("C-1: reject from a foreign org silently no-ops", async () => {
    const svc = makeSchemaRegistryService(fake.api);
    const filed = await svc.proposeField({ proposal: proposalInput() });
    const r = await svc.rejectField({
      orgId: "99999999-9999-9999-9999-999999999999",
      proposalId: filed.proposalId!,
      approverUserId: APPROVER,
      reason: "trying to reject another org's proposal",
    });
    // `ok: true` because the update query matched 0 rows successfully.
    // The important assertion: the proposal in the OTHER tenant is
    // still pending.
    expect(r.ok).toBe(true);
    const stored = fake.tables.get("field_proposals")![0]! as Record<
      string,
      unknown
    >;
    expect(stored.status).toBe("pending");
  });
});
