/**
 * `createOpenClawOperatingModel` — top-level composition root.
 *
 * Wires the supplied injection ports into a single operating-model
 * facade. The kernel composer (downstream) constructs this with the
 * production registry + audit + metering implementations; tests use the
 * in-memory ones.
 */

import type {
  AgentRegistry,
  AuditSink,
  DashboardSink,
  MeteringSink,
} from './types.js';
import { InMemoryAgentRegistry } from './agent-domains/index.js';
import { seedShippedDomains } from './agent-domains/index.js';
import {
  InMemoryAaaSEndpointStore,
  type AaaSEndpointStore,
} from './agent-as-a-service/index.js';
import {
  InMemoryKillSwitchStore,
  type KillSwitchStore,
} from './kill-switch/index.js';
import {
  InMemoryPolicyStore,
  type PolicyStore,
} from './policy-engine/index.js';

export interface CreateOpenClawOperatingModelArgs {
  readonly registry?: AgentRegistry;
  readonly policyStore?: PolicyStore;
  readonly killSwitchStore?: KillSwitchStore;
  readonly aaasEndpointStore?: AaaSEndpointStore;
  readonly auditSink?: AuditSink;
  readonly meteringSink?: MeteringSink;
  readonly dashboardSink?: DashboardSink;
  readonly autoSeedShippedDomains?: boolean;
}

export interface OpenClawOperatingModel {
  readonly registry: AgentRegistry;
  readonly policyStore: PolicyStore;
  readonly killSwitchStore: KillSwitchStore;
  readonly aaasEndpointStore: AaaSEndpointStore;
  readonly auditSink: AuditSink | null;
  readonly meteringSink: MeteringSink | null;
  readonly dashboardSink: DashboardSink | null;
}

export async function createOpenClawOperatingModel(
  args: CreateOpenClawOperatingModelArgs = {},
): Promise<OpenClawOperatingModel> {
  const registry = args.registry ?? new InMemoryAgentRegistry();
  if (args.autoSeedShippedDomains !== false) {
    await seedShippedDomains(registry);
  }

  return {
    registry,
    policyStore: args.policyStore ?? new InMemoryPolicyStore(),
    killSwitchStore: args.killSwitchStore ?? new InMemoryKillSwitchStore(),
    aaasEndpointStore: args.aaasEndpointStore ?? new InMemoryAaaSEndpointStore(),
    auditSink: args.auditSink ?? null,
    meteringSink: args.meteringSink ?? null,
    dashboardSink: args.dashboardSink ?? null,
  };
}
