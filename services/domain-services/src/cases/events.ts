/**
 * Case domain events (state-machine + SLA additions).
 *
 * Additive: existing events (CaseCreated, CaseEscalated, CaseResolved, NoticeSent)
 * continue to live in ./index.ts. This file adds the new event shapes
 * introduced by the state-machine + SLA worker.
 */

import type { TenantId, UserId } from '@borjie/domain-models';
import type { CaseId } from './index.js';
import type { CaseStatusValue } from './state-machine.js';

export interface CaseStatusChangedEvent {
  eventId: string;
  eventType: 'CaseStatusChanged';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    caseId: CaseId;
    caseNumber: string;
    from: CaseStatusValue;
    to: CaseStatusValue;
    reason: string;
    actor: UserId;
  };
}

export interface CaseSLABreachedEvent {
  eventId: string;
  eventType: 'CaseSLABreached';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    caseId: CaseId;
    caseNumber: string;
    breachedAt: string;
    escalationLevel: number;
    slaHours: number | null;
  };
}
