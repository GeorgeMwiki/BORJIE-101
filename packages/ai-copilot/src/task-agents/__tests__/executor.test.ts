import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { TaskAgentExecutor } from '../executor.js';
import type { TaskAgent, TaskAgentRanEvent } from '../types.js';
import {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
} from '../../autonomy/autonomy-policy-service.js';

const TENANT = 'tenant_exec_1';

// Minimal stand-in agent under test. Emits two affected refs and returns
// `executed` so we can assert audit + event emission.
const EchoSchema = z.object({ say: z.string().default('hi') });
const echoAgent: TaskAgent<typeof EchoSchema> = {
  id: 'echo_agent',
  title: 'Echo Agent',
  description: 'Test-only echo.',
  trigger: { kind: 'manual', description: 'manual only' },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_routine_update',
    description: 'gated on comms.autoSendRoutineUpdates',
    invokesLLM: false,
  },
  payloadSchema: EchoSchema,
  async execute(ctx) {
    return {
      outcome: 'executed',
      summary: `said: ${ctx.payload.say}`,
      data: { said: ctx.payload.say },
      affected: [
        { kind: 'echo', id: 'e1' },
        { kind: 'echo', id: 'e2' },
      ],
    };
  },
};

const throwsAgent: TaskAgent<typeof EchoSchema> = {
  ...echoAgent,
  id: 'throws_agent',
  async execute() {
    throw new Error('boom');
  },
};

const registry = {
  [echoAgent.id]: echoAgent,
  [throwsAgent.id]: throwsAgent,
};

describe('TaskAgentExecutor', () => {
  let auditSpy: ReturnType<typeof vi.fn>;
  let eventSpy: ReturnType<typeof vi.fn>;
  let events: TaskAgentRanEvent[];

  beforeEach(() => {
    auditSpy = vi.fn().mockResolvedValue({ id: 'audit_1' });
    events = [];
    eventSpy = vi.fn().mockImplementation(async (ev: TaskAgentRanEvent) => {
      events.push(ev);
    });
  });

  function makeExecutor(overrides?: Partial<ConstructorParameters<typeof TaskAgentExecutor>[0]>) {
    return new TaskAgentExecutor({
      registry,
      services: {},
      audit: { logAudit: auditSpy },
      eventPublisher: { publish: eventSpy },
      ...overrides,
    });
  }

  it('executes a registered agent, writes audit, emits TaskAgentRan', async () => {
    const exec = makeExecutor();
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'echo_agent',
      payload: { say: 'hello' },
      trigger: { kind: 'manual', userId: 'user_1' },
    });
    expect(out.outcome).toBe('executed');
    expect(out.summary).toBe('said: hello');
    expect(out.affected).toHaveLength(2);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('TaskAgentRan');
    expect(events[0].agentId).toBe('echo_agent');
    expect(events[0].outcome).toBe('executed');
  });

  it('unknown agent resolves to outcome=error without throwing', async () => {
    const exec = makeExecutor();
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'does_not_exist',
      payload: {},
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('error');
    expect(out.summary).toMatch(/Unknown agent/);
  });

  it('captures thrown agent errors as outcome=error', async () => {
    const exec = makeExecutor();
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'throws_agent',
      payload: {},
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('error');
    expect(out.summary).toMatch(/boom/);
  });

  it('invalid payload yields outcome=error with zod issues', async () => {
    const exec = makeExecutor();
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'echo_agent',
      payload: { say: 42 }, // invalid — must be string
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('error');
    expect(out.summary).toMatch(/Invalid payload/);
  });

  it('skips when autonomy policy denies the action', async () => {
    const repo = new InMemoryAutonomyPolicyRepository();
    const autonomy = new AutonomyPolicyService({ repository: repo });
    // default policy has autonomousModeEnabled=false — everything is denied.
    const exec = makeExecutor({ autonomy });
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'echo_agent',
      payload: { say: 'x' },
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('skipped_policy');
    expect(out.summary).toMatch(/Autonomous mode disabled/);
    // Event still emitted so observability sees the skip.
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('skipped_policy');
  });

  it('budget-guard skip only applies when the agent declares invokesLLM=true', async () => {
    const exec = makeExecutor({
      costLedger: {
        async assertWithinBudget() {
          throw new Error('over budget');
        },
      } as any,
    });
    // echoAgent has invokesLLM=false → budget-guard should not trigger.
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'echo_agent',
      payload: {},
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('executed');
  });

  it('listAgents + getAgent expose registry contents', () => {
    const exec = makeExecutor();
    expect(exec.listAgents().length).toBe(2);
    expect(exec.getAgent('echo_agent')?.id).toBe('echo_agent');
    expect(exec.getAgent('nope')).toBeNull();
  });
});
