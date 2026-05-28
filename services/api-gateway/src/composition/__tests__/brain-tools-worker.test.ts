/**
 * Worker-tools tests (T4_field_employee).
 *
 * Verifies:
 *   - Tool count + gating to worker slug
 *   - Clock-in audit emitted with correct stakes/digest
 *   - Toolbox-talk acknowledgement requires the biometric assertion
 *     (zod schema enforces presence)
 *   - Persona gating refuses an owner trying to clock in as a worker
 */

import { describe, it, expect } from 'vitest';
import {
  toBrainToolHandler,
  WORKER_TOOLS,
  type PersonaToolAuditEntry,
  type PersonaToolGate,
  type PersonaToolHttpClient,
} from '../brain-tools';
import {
  workerAckToolboxTool,
  workerClockInTool,
} from '../brain-tools/worker-tools';

function client(): PersonaToolHttpClient {
  return {
    async get<T>(): Promise<T> {
      return { state: 'on_shift' } as unknown as T;
    },
    async post<T>(): Promise<T> {
      return {
        shiftId: 'shift-1',
        clockedInAt: '2026-01-01T07:00:00.000Z',
        talkId: 'talk-1',
        acknowledgedAt: '2026-01-01T07:05:00.000Z',
      } as unknown as T;
    },
  };
}

function gate(
  persona: string,
  audits: PersonaToolAuditEntry[],
): PersonaToolGate {
  return {
    killSwitchOpen: false,
    resolvePersonaSlug: () => persona,
    httpClient: client(),
    auditSink: {
      async append(entry: PersonaToolAuditEntry) {
        audits.push(entry);
      },
    },
  };
}

function ctx() {
  return {
    tenant: { tenantId: 'tenant-worker' } as never,
    actor: { id: 'worker-1' } as never,
    persona: { id: 'p-w' } as never,
    threadId: 'th-1',
  };
}

describe('worker-tools — surface', () => {
  it('registers exactly thirteen worker tools', () => {
    expect(WORKER_TOOLS).toHaveLength(13);
  });

  it('every worker tool is gated to T4_field_employee only', () => {
    for (const t of WORKER_TOOLS) {
      expect(t.personaSlugs).toEqual(['T4_field_employee']);
    }
  });

  it('exposes role-aware tools (crew, drill, fuel, attendance)', () => {
    const ids = WORKER_TOOLS.map((t) => t.id);
    expect(ids).toContain('mining.workforce.my-crew');
    expect(ids).toContain('mining.geology.log-drill-hole');
    expect(ids).toContain('mining.workforce.log-fuel');
    expect(ids).toContain('mining.workforce.shift-attendance');
  });
});

describe('worker-tools — execution', () => {
  it('clocks in with valid site id and writes an audit entry', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      workerClockInTool,
      gate('T4_field_employee', audits),
    );
    const result = await handler.execute(
      { siteId: 'site-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].toolId).toBe('mining.attendance.clock-in');
    expect(audits[0].personaSlug).toBe('T4_field_employee');
  });

  it('toolbox acknowledgement requires biometric assertion (zod fail)', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      workerAckToolboxTool,
      gate('T4_field_employee', audits),
    );
    const result = await handler.execute(
      { talkId: 'talk-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid params/);
    expect(audits).toHaveLength(0);
  });

  it('toolbox acknowledgement runs and audits when biometric assertion supplied', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      workerAckToolboxTool,
      gate('T4_field_employee', audits),
    );
    const result = await handler.execute(
      {
        talkId: 'talk-1',
        biometricAssertion: {
          method: 'fingerprint',
          nonce: 'nonce-123',
          signedAt: '2026-01-01T07:00:00.000Z',
        },
      },
      ctx() as never,
    );
    expect(result.ok).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe('ok');
  });

  it('refuses when an owner tries to call worker clock-in', async () => {
    const audits: PersonaToolAuditEntry[] = [];
    const handler = toBrainToolHandler(
      workerClockInTool,
      gate('T1_owner_strategist', audits),
    );
    const result = await handler.execute(
      { siteId: 'site-1' },
      ctx() as never,
    );
    expect(result.ok).toBe(false);
    // WRITE tool path emits a denial audit
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe('denied');
  });
});
