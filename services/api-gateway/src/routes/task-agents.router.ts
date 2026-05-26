/**
 * Task-Agents router — Phase B Wave 30.
 *
 * Exposes the uniform registry of narrow-scope task agents so operators can:
 *   GET  /api/v1/task-agents                — list all registered agents
 *   GET  /api/v1/task-agents/:id            — per-agent metadata
 *   POST /api/v1/task-agents/:id/run        — manual trigger (validates payload
 *                                              through the agent's zod schema)
 *   GET  /api/v1/task-agents/runs?…         — recent runs (from audit_events)
 *
 * The executor is resolved from the service registry (`services.taskAgentExecutor`).
 * When the composition root hasn't wired it (degraded mode / tests), every
 * endpoint 503s cleanly — we never crash the gateway.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  TASK_AGENT_REGISTRY,
  TASK_AGENTS,
} from '@borjie/ai-copilot/task-agents';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function resolveExecutor(c: any) {
  const services = c.get('services') ?? {};
  return services.taskAgentExecutor ?? null;
}

function notWired(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'TASK_AGENT_EXECUTOR_NOT_WIRED',
        message:
          'Task-agent executor not configured — set services.taskAgentExecutor in composition root.',
      },
    },
    503,
  );
}

function summariseAgent(agent: (typeof TASK_AGENTS)[number]) {
  return {
    id: agent.id,
    title: agent.title,
    description: agent.description,
    trigger: agent.trigger,
    guardrails: {
      autonomyDomain: agent.guardrails.autonomyDomain,
      autonomyAction: agent.guardrails.autonomyAction,
      description: agent.guardrails.description,
      invokesLLM: agent.guardrails.invokesLLM,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /  — list all registered agents
// ---------------------------------------------------------------------------
app.get('/', async (c: any) => {
  return c.json({
    success: true,
    data: {
      agents: TASK_AGENTS.map(summariseAgent),
      total: TASK_AGENTS.length,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /runs — query recent runs from audit_events (REGISTERED BEFORE :id so
// the literal path wins over the wildcard).
// ---------------------------------------------------------------------------
app.get('/runs', async (c: any) => {
  const services = c.get('services') ?? {};
  const audit = services.audit;
  const auth = c.get('auth') ?? {};
  if (!audit) return notWired(c);

  const agentId = c.req.query('agent_id') ?? undefined;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(500, Math.max(1, Number(limitParam))) : 50;

  try {
    const query = {
      tenantId: auth.tenantId,
      entityType: 'task_agent_run',
      limit,
      offset: 0,
    };
    const result = await audit.getAuditLog(query);
    const items = (result.items ?? []).filter((row: any) => {
      if (!agentId) return true;
      const meta = row.metadata?.taskAgentRun;
      return meta?.agentId === agentId;
    });
    return c.json({
      success: true,
      data: {
        items,
        total: items.length,
        limit,
        agentId: agentId ?? null,
      },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'TASK_AGENT_RUNS_FETCH_FAILED',
      status: 500,
      fallback: 'Failed to fetch task-agent runs',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — per-agent metadata
// ---------------------------------------------------------------------------
app.get('/:id', async (c: any) => {
  const id = c.req.param('id');
  const agent = TASK_AGENT_REGISTRY[id];
  if (!agent) {
    return c.json(
      {
        success: false,
        error: { code: 'AGENT_NOT_FOUND', message: `Unknown agent: ${id}` },
      },
      404,
    );
  }
  return c.json({ success: true, data: summariseAgent(agent) });
});

// ---------------------------------------------------------------------------
// POST /:id/run — manual trigger
// ---------------------------------------------------------------------------
// We intentionally DO NOT pre-validate via `zValidator` here because every
// agent has its own zod schema and the executor already parses the payload
// against `agent.payloadSchema`. We just accept any JSON body and delegate.
const RunBodySchema = z
  .object({
    payload: z.unknown().optional(),
  })
  .passthrough();

app.post('/:id/run', zValidator('json', RunBodySchema), withSecurityEvents({ action: 'task-agent.create', resource: 'task-agent', severity: 'info' }, async (c: any) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const auth = c.get('auth') ?? {};
  const executor = resolveExecutor(c);

  if (!TASK_AGENT_REGISTRY[id]) {
    return c.json(
      {
        success: false,
        error: { code: 'AGENT_NOT_FOUND', message: `Unknown agent: ${id}` },
      },
      404,
    );
  }
  if (!executor) return notWired(c);

  try {
    const out = await executor.execute({
      tenantId: auth.tenantId,
      agentId: id,
      payload: body?.payload ?? {},
      trigger: { kind: 'manual', userId: auth.userId ?? 'unknown' },
    });
    // Map internal outcome → HTTP code. Error is 500; all others are 200.
    const status = out.outcome === 'error' ? 500 : 200;
    return c.json({ success: out.outcome !== 'error', data: out }, status);
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'TASK_AGENT_RUN_FAILED',
      status: 500,
      fallback: 'Task-agent run failed',
    });
  }
}));

export default app;
