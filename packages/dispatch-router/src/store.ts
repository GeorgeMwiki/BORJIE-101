/**
 * Piece L — Persistence ports + in-memory test store.
 *
 * The dispatcher writes to four tables (conversation_capture,
 * module_update_proposals, tab_subscriptions, tab_event_log). To keep
 * the package free of a hard `@borjie/database` dep, those writes
 * route through small port interfaces. Production wires Drizzle
 * adapters at the api-gateway composition root; unit tests use the
 * in-memory implementations here.
 */

import type {
  ConversationCapture,
  ModuleUpdateProposal,
  TabEventLogEntry,
} from './types.js';

// ─── Port interfaces ───────────────────────────────────────────────────

export interface ConversationCaptureStore {
  insert(row: ConversationCapture): Promise<void>;
  findById(tenant_id: string, id: string): Promise<ConversationCapture | null>;
  findByHash(
    tenant_id: string,
    hash: string,
  ): Promise<ConversationCapture | null>;
  listByTenant(
    tenant_id: string,
    limit?: number,
  ): Promise<ReadonlyArray<ConversationCapture>>;
}

export interface ModuleUpdateProposalStore {
  insert(row: ModuleUpdateProposal): Promise<void>;
  update(
    tenant_id: string,
    id: string,
    patch: Partial<ModuleUpdateProposal>,
  ): Promise<ModuleUpdateProposal>;
  findById(
    tenant_id: string,
    id: string,
  ): Promise<ModuleUpdateProposal | null>;
  listByTenant(
    tenant_id: string,
    filter?: {
      readonly status?: string;
      readonly module_template_id?: string;
      readonly persona_id?: string;
    },
  ): Promise<ReadonlyArray<ModuleUpdateProposal>>;
}

export interface TabEventLogStore {
  append(row: TabEventLogEntry): Promise<void>;
  listByProposal(
    tenant_id: string,
    proposal_id: string,
  ): Promise<ReadonlyArray<TabEventLogEntry>>;
  listByTenant(
    tenant_id: string,
    limit?: number,
  ): Promise<ReadonlyArray<TabEventLogEntry>>;
}

// ─── In-memory implementations (tests + demo) ────────────────────────

export function createInMemoryCaptureStore(): ConversationCaptureStore & {
  readonly snapshot: () => ReadonlyArray<ConversationCapture>;
} {
  const rows: ConversationCapture[] = [];
  return {
    async insert(row) {
      rows.push(row);
    },
    async findById(tenant_id, id) {
      return rows.find((r) => r.tenant_id === tenant_id && r.id === id) ?? null;
    },
    async findByHash(tenant_id, hash) {
      return (
        rows.find(
          (r) => r.tenant_id === tenant_id && r.exchange_hash === hash,
        ) ?? null
      );
    },
    async listByTenant(tenant_id, limit) {
      const filtered = rows.filter((r) => r.tenant_id === tenant_id);
      return limit ? filtered.slice(-limit) : filtered;
    },
    snapshot() {
      return [...rows];
    },
  };
}

export function createInMemoryProposalStore(): ModuleUpdateProposalStore & {
  readonly snapshot: () => ReadonlyArray<ModuleUpdateProposal>;
} {
  const rows: ModuleUpdateProposal[] = [];
  return {
    async insert(row) {
      rows.push(row);
    },
    async update(tenant_id, id, patch) {
      const idx = rows.findIndex(
        (r) => r.tenant_id === tenant_id && r.id === id,
      );
      if (idx < 0) {
        throw new Error(
          `proposal ${id} not found for tenant ${tenant_id}`,
        );
      }
      const existing = rows[idx];
      if (!existing) {
        throw new Error(
          `proposal ${id} not found for tenant ${tenant_id}`,
        );
      }
      const merged: ModuleUpdateProposal = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      rows[idx] = merged;
      return merged;
    },
    async findById(tenant_id, id) {
      return (
        rows.find((r) => r.tenant_id === tenant_id && r.id === id) ?? null
      );
    },
    async listByTenant(tenant_id, filter) {
      return rows.filter((r) => {
        if (r.tenant_id !== tenant_id) return false;
        if (filter?.status && r.status !== filter.status) return false;
        if (
          filter?.module_template_id &&
          r.module_template_id !== filter.module_template_id
        )
          return false;
        if (filter?.persona_id && r.persona_id !== filter.persona_id)
          return false;
        return true;
      });
    },
    snapshot() {
      return [...rows];
    },
  };
}

export function createInMemoryEventLogStore(): TabEventLogStore & {
  readonly snapshot: () => ReadonlyArray<TabEventLogEntry>;
} {
  const rows: TabEventLogEntry[] = [];
  return {
    async append(row) {
      rows.push(row);
    },
    async listByProposal(tenant_id, proposal_id) {
      return rows
        .filter(
          (r) => r.tenant_id === tenant_id && r.proposal_id === proposal_id,
        )
        .sort((a, b) => a.sequence - b.sequence);
    },
    async listByTenant(tenant_id, limit) {
      const filtered = rows.filter((r) => r.tenant_id === tenant_id);
      return limit ? filtered.slice(-limit) : filtered;
    },
    snapshot() {
      return [...rows];
    },
  };
}
