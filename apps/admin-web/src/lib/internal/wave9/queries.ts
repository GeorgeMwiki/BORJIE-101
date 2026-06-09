/**
 * react-query bindings for the five Wave 9 admin-web surfaces. Read hooks
 * hydrate each list; mutation hooks invalidate the relevant read so the
 * queue / registry re-hydrates after every write. Live-only: failures
 * propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPendingProposals,
  approveProposal,
  declineProposal,
  fetchJuniorAis,
  suspendJunior,
  revokeJunior,
  fetchTaskAgents,
  runTaskAgent,
  fetchPersonas,
  refreshPersonas,
  deletePersona,
  fetchMyWorkflowQueue,
  fetchFlowAutonomy,
  type Proposal,
  type ApproveProposalInput,
  type DeclineProposalInput,
  type JuniorAi,
  type SuspendJuniorInput,
  type TaskAgent,
  type RunTaskAgentInput,
  type Persona,
  type WorkflowRun,
  type FlowAutonomyPref,
} from './api';

// ─── Query keys ──────────────────────────────────────────────────────────────

const PROPOSALS_KEY = ['wave9', 'proposals', 'pending'] as const;
const JUNIOR_AI_KEY = ['wave9', 'junior-ai', 'mine'] as const;
const TASK_AGENTS_KEY = ['wave9', 'task-agents'] as const;
const PERSONAS_KEY = ['wave9', 'persona-registry'] as const;
const WORKFLOW_QUEUE_KEY = ['wave9', 'workflow', 'my-queue'] as const;
const flowAutonomyKey = (pending: boolean) =>
  ['wave9', 'workflow', 'flow-autonomy', pending ? 'pending' : 'all'] as const;

// ─── Proposals ───────────────────────────────────────────────────────────────

export function usePendingProposals() {
  return useQuery<ReadonlyArray<Proposal>>({
    queryKey: PROPOSALS_KEY,
    queryFn: fetchPendingProposals,
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation<{ readonly id: string; readonly status: string }, Error, ApproveProposalInput>({
    mutationFn: approveProposal,
    onSettled: () => qc.invalidateQueries({ queryKey: PROPOSALS_KEY }),
  });
}

export function useDeclineProposal() {
  const qc = useQueryClient();
  return useMutation<{ readonly id: string; readonly status: string }, Error, DeclineProposalInput>({
    mutationFn: declineProposal,
    onSettled: () => qc.invalidateQueries({ queryKey: PROPOSALS_KEY }),
  });
}

// ─── Junior-AI Factory ───────────────────────────────────────────────────────

export function useJuniorAis() {
  return useQuery<ReadonlyArray<JuniorAi>>({
    queryKey: JUNIOR_AI_KEY,
    queryFn: fetchJuniorAis,
  });
}

export function useSuspendJunior() {
  const qc = useQueryClient();
  return useMutation<JuniorAi, Error, SuspendJuniorInput>({
    mutationFn: suspendJunior,
    onSettled: () => qc.invalidateQueries({ queryKey: JUNIOR_AI_KEY }),
  });
}

export function useRevokeJunior() {
  const qc = useQueryClient();
  return useMutation<JuniorAi, Error, string>({
    mutationFn: revokeJunior,
    onSettled: () => qc.invalidateQueries({ queryKey: JUNIOR_AI_KEY }),
  });
}

// ─── Task-Agents ─────────────────────────────────────────────────────────────

export function useTaskAgents() {
  return useQuery({
    queryKey: TASK_AGENTS_KEY,
    queryFn: fetchTaskAgents,
  });
}

export function useRunTaskAgent() {
  return useMutation<unknown, Error, RunTaskAgentInput>({
    mutationFn: runTaskAgent,
  });
}

// ─── Persona Registry ────────────────────────────────────────────────────────

export function usePersonas() {
  return useQuery<ReadonlyArray<Persona>>({
    queryKey: PERSONAS_KEY,
    queryFn: fetchPersonas,
  });
}

export function useRefreshPersonas() {
  const qc = useQueryClient();
  return useMutation<{ readonly refreshed: boolean }, Error, void>({
    mutationFn: refreshPersonas,
    onSettled: () => qc.invalidateQueries({ queryKey: PERSONAS_KEY }),
  });
}

export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation<{ readonly id: string }, Error, string>({
    mutationFn: deletePersona,
    onSettled: () => qc.invalidateQueries({ queryKey: PERSONAS_KEY }),
  });
}

// ─── Workflow + flow-autonomy ────────────────────────────────────────────────

export function useMyWorkflowQueue() {
  return useQuery<ReadonlyArray<WorkflowRun>>({
    queryKey: WORKFLOW_QUEUE_KEY,
    queryFn: fetchMyWorkflowQueue,
  });
}

export function useFlowAutonomy(pending: boolean) {
  return useQuery<ReadonlyArray<FlowAutonomyPref>>({
    queryKey: flowAutonomyKey(pending),
    queryFn: () => fetchFlowAutonomy(pending),
  });
}
