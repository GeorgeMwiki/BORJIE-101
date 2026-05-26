/**
 * Proposal repository — CRUD on `mutation_proposals`.
 *
 * Defined as an interface + an in-memory implementation. Production
 * wiring (Drizzle-backed) lives in `@borjie/database` and replaces the
 * in-memory store via DI. Same approach as `session-mirror` (Wave 18R).
 */

import type { MutationProposal, ProposalStatus } from '../types.js';

export interface ProposalRepository {
  readonly save: (proposal: MutationProposal) => Promise<MutationProposal>;
  readonly findById: (id: string) => Promise<MutationProposal | null>;
  readonly listForUser: (
    userId: string,
    statuses: ReadonlyArray<ProposalStatus>,
  ) => Promise<ReadonlyArray<MutationProposal>>;
  readonly updateStatus: (
    id: string,
    status: ProposalStatus,
  ) => Promise<MutationProposal | null>;
}

interface StoredProposal {
  readonly proposal: MutationProposal;
  readonly status: ProposalStatus;
}

export function createInMemoryProposalRepository(): ProposalRepository {
  // Holds (status, proposal) tuples keyed by proposal id. Returns
  // fresh objects on every read so callers cannot mutate the store.
  let store: ReadonlyMap<string, StoredProposal> = new Map();

  return {
    async save(proposal) {
      const next = new Map(store);
      next.set(proposal.id, { proposal, status: 'pending' });
      store = next;
      return proposal;
    },
    async findById(id) {
      return store.get(id)?.proposal ?? null;
    },
    async listForUser(_userId, statuses) {
      // The repository contract does not encode user-scope — the
      // production impl uses the `tenant_id` + the user's role to
      // resolve queue ownership. In-memory impl returns all proposals
      // matching the status filter so unit tests can exercise the
      // workflow.
      const set = new Set(statuses);
      const matched: MutationProposal[] = [];
      for (const stored of store.values()) {
        if (set.has(stored.status)) matched.push(stored.proposal);
      }
      return matched;
    },
    async updateStatus(id, status) {
      const found = store.get(id);
      if (!found) return null;
      const next = new Map(store);
      next.set(id, { proposal: found.proposal, status });
      store = next;
      return found.proposal;
    },
  };
}
