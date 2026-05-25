/**
 * In-memory implementation of the AgentRegistry port — suitable for
 * tests and the default development experience. Real deployments wire
 * a database-backed registry via the same port.
 */

import type {
  AgentDomain,
  AgentRegistry,
  AgentSpec,
  AutonomyLevel,
} from '../types.js';

interface AutonomyLevelKey {
  readonly agentId: string;
  readonly domainId: string;
  readonly tenantId?: string;
}

function autonomyKey(args: AutonomyLevelKey): string {
  return `${args.agentId}::${args.domainId}::${args.tenantId ?? '*'}`;
}

export class InMemoryAgentRegistry implements AgentRegistry {
  readonly #agents = new Map<string, AgentSpec>();
  readonly #domains = new Map<string, AgentDomain>();
  readonly #autonomy = new Map<string, AutonomyLevel>();
  readonly #autonomyAudit: Array<{
    readonly agentId: string;
    readonly domainId: string;
    readonly tenantId?: string;
    readonly level: AutonomyLevel;
    readonly justification: string;
    readonly setBy: string;
    readonly setAt: string;
  }> = [];

  async registerAgent(spec: AgentSpec): Promise<void> {
    this.#agents.set(spec.agentId, spec);
  }

  async getAgent(agentId: string): Promise<AgentSpec | null> {
    return this.#agents.get(agentId) ?? null;
  }

  async listAgents(): Promise<ReadonlyArray<AgentSpec>> {
    return Array.from(this.#agents.values());
  }

  async registerDomain(domain: AgentDomain): Promise<void> {
    this.#domains.set(domain.id, domain);
  }

  async getDomain(domainId: string): Promise<AgentDomain | null> {
    return this.#domains.get(domainId) ?? null;
  }

  async listDomains(): Promise<ReadonlyArray<AgentDomain>> {
    return Array.from(this.#domains.values());
  }

  async setAutonomyLevel(args: {
    agentId: string;
    domainId: string;
    tenantId?: string;
    level: AutonomyLevel;
    justification: string;
    setBy: string;
  }): Promise<void> {
    this.#autonomy.set(autonomyKey(args), args.level);
    this.#autonomyAudit.push({
      agentId: args.agentId,
      domainId: args.domainId,
      ...(args.tenantId !== undefined && { tenantId: args.tenantId }),
      level: args.level,
      justification: args.justification,
      setBy: args.setBy,
      setAt: new Date().toISOString(),
    });
  }

  async getAutonomyLevel(args: {
    agentId: string;
    domainId: string;
    tenantId?: string;
  }): Promise<AutonomyLevel | null> {
    // Prefer tenant-scoped override, fall back to global
    const tenantScoped = this.#autonomy.get(autonomyKey(args));
    if (tenantScoped) return tenantScoped;
    if (args.tenantId !== undefined) {
      const global = this.#autonomy.get(
        autonomyKey({ agentId: args.agentId, domainId: args.domainId }),
      );
      if (global) return global;
    }
    const domain = this.#domains.get(args.domainId);
    return domain?.defaultAutonomyLevel ?? null;
  }

  /** Test helper — read the in-memory autonomy-change audit trail. */
  getAutonomyAuditTrail(): ReadonlyArray<{
    readonly agentId: string;
    readonly domainId: string;
    readonly tenantId?: string;
    readonly level: AutonomyLevel;
    readonly justification: string;
    readonly setBy: string;
    readonly setAt: string;
  }> {
    return [...this.#autonomyAudit];
  }
}
