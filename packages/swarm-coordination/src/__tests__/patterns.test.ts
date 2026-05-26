import { describe, it, expect } from 'vitest';
import { createActiveAgentsRegistry } from '../registry/active-agents-registry.js';
import { createA2ASender } from '../messaging/a2a-sender.js';
import { createBlackboardPoster } from '../blackboard/blackboard-poster.js';
import { createBlackboardReader } from '../blackboard/blackboard-reader.js';
import {
  createConsensus,
  type ConsensusVoter,
} from '../patterns/consensus.js';
import {
  createPeerDebate,
  type DebaterExecutor,
} from '../patterns/peer-debate.js';
import {
  createPipeline,
  type PipelineStage,
} from '../patterns/pipeline.js';
import {
  createSupervisorWorker,
  type WorkerExecutor,
} from '../patterns/supervisor-worker.js';
import { createInMemoryActiveAgentsRepository } from '../storage/active-agents-repository.js';
import { createInMemoryAgentMessagesRepository } from '../storage/agent-messages-repository.js';
import { createInMemoryBlackboardRepository } from '../storage/blackboard-repository.js';

const stubWorkerExecutor: WorkerExecutor = {
  async execute({ workerAgentId }) {
    return { byWorker: workerAgentId, finding: 'ok' };
  },
};

const stubDebater: DebaterExecutor = {
  async argue({ debaterAgentId, roundNumber }) {
    return { debater: debaterAgentId, round: roundNumber, claim: 'point' };
  },
};

const yesVoter: ConsensusVoter = {
  async vote({ voterAgentId }) {
    return { agentId: voterAgentId, approved: true };
  },
};

const noVoter: ConsensusVoter = {
  async vote({ voterAgentId }) {
    return { agentId: voterAgentId, approved: false, rationale: 'risk' };
  },
};

const stubStage = (id: string): PipelineStage => ({
  stageAgentId: id,
  async execute({ incomingPayload }) {
    return { ...incomingPayload, lastStage: id };
  },
});

describe('supervisor-worker pattern', () => {
  it('posts a plan and aggregates worker results', async () => {
    const blackboardRepo = createInMemoryBlackboardRepository();
    const activeRepo = createInMemoryActiveAgentsRepository();
    const pattern = createSupervisorWorker({
      registry: createActiveAgentsRegistry(activeRepo),
      blackboardPoster: createBlackboardPoster(blackboardRepo),
      blackboardReader: createBlackboardReader(blackboardRepo),
      executor: stubWorkerExecutor,
    });
    const result = await pattern.run({
      tenantId: 't1',
      supervisorAgentId: 'mr-mwikila',
      subject: { kind: 'campaign', id: 'cmp-1' },
      workerAgentIds: ['safety', 'fleet'],
      planPayload: { goal: 'launch' },
    });
    expect(result.planPosting.contributionKind).toBe('plan');
    expect(result.workerResults.length).toBe(2);
  });
});

describe('peer-debate pattern', () => {
  it('runs N rounds across all debaters', async () => {
    const blackboardRepo = createInMemoryBlackboardRepository();
    const pattern = createPeerDebate({
      blackboardPoster: createBlackboardPoster(blackboardRepo),
      executor: stubDebater,
    });
    const result = await pattern.run({
      tenantId: 't1',
      supervisorAgentId: 'mr-mwikila',
      subject: { kind: 'plan', id: 'pl-1' },
      debaterAgentIds: ['safety', 'throughput'],
      rounds: 2,
    });
    expect(result.hypotheses.length).toBe(4);
  });

  it('rejects a single-debater debate', async () => {
    const blackboardRepo = createInMemoryBlackboardRepository();
    const pattern = createPeerDebate({
      blackboardPoster: createBlackboardPoster(blackboardRepo),
      executor: stubDebater,
    });
    await expect(
      pattern.run({
        tenantId: 't1',
        supervisorAgentId: 'mr-mwikila',
        subject: { kind: 'plan', id: 'pl-1' },
        debaterAgentIds: ['only-one'],
      }),
    ).rejects.toThrow();
  });
});

describe('consensus pattern', () => {
  it('reaches consensus when all required voters approve', async () => {
    const activeRepo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(activeRepo);
    await registry.register({
      tenantId: 't1',
      agentId: 'safety',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    await registry.register({
      tenantId: 't1',
      agentId: 'fleet',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    const pattern = createConsensus({ registry, voter: yesVoter });
    const result = await pattern.run({
      tenantId: 't1',
      subject: { kind: 'parcel', id: 'P1' },
      requiredVoterAgentIds: ['safety', 'fleet'],
      proposalPayload: { action: 'terminate' },
    });
    expect(result.consensusReached).toBe(true);
  });

  it('fails consensus when a voter is not running', async () => {
    const activeRepo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(activeRepo);
    const pattern = createConsensus({ registry, voter: yesVoter });
    const result = await pattern.run({
      tenantId: 't1',
      subject: { kind: 'parcel', id: 'P1' },
      requiredVoterAgentIds: ['absent'],
      proposalPayload: {},
    });
    expect(result.consensusReached).toBe(false);
    expect(result.missingVoters).toContain('absent');
  });

  it('fails consensus when a voter rejects', async () => {
    const activeRepo = createInMemoryActiveAgentsRepository();
    const registry = createActiveAgentsRegistry(activeRepo);
    await registry.register({
      tenantId: 't1',
      agentId: 'safety',
      agentKind: 'specialisation',
      subject: { kind: 'parcel', id: 'P1' },
    });
    const pattern = createConsensus({ registry, voter: noVoter });
    const result = await pattern.run({
      tenantId: 't1',
      subject: { kind: 'parcel', id: 'P1' },
      requiredVoterAgentIds: ['safety'],
      proposalPayload: {},
    });
    expect(result.consensusReached).toBe(false);
  });
});

describe('pipeline pattern', () => {
  it('runs stages sequentially and emits handoff messages', async () => {
    const messagesRepo = createInMemoryAgentMessagesRepository();
    const pattern = createPipeline({
      a2aSender: createA2ASender(messagesRepo),
    });
    const result = await pattern.run({
      tenantId: 't1',
      originAgentId: 'mr-mwikila',
      subject: { kind: 'campaign', id: 'cmp-1' },
      stages: [stubStage('research'), stubStage('compose'), stubStage('publish')],
      initialPayload: { intent: 'launch' },
    });
    expect(result.handoffs.length).toBe(3);
    expect(result.finalPayload['lastStage']).toBe('publish');
  });

  it('rejects an empty pipeline', async () => {
    const messagesRepo = createInMemoryAgentMessagesRepository();
    const pattern = createPipeline({
      a2aSender: createA2ASender(messagesRepo),
    });
    await expect(
      pattern.run({
        tenantId: 't1',
        originAgentId: 'mr-mwikila',
        subject: { kind: 'campaign', id: 'cmp-1' },
        stages: [],
        initialPayload: {},
      }),
    ).rejects.toThrow();
  });
});
