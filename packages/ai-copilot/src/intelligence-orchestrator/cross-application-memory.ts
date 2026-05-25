/**
 * Cross-Persona Memory — shared memory across personae within a session.
 *
 * When Mr. Mwikila (Manager) switches to Owner-Advisor persona, the new
 * surface should already "know" what was discussed. This is a small,
 * in-process cache keyed by `sessionId` + `tenantId`, with an optional
 * repository backend for persistence.
 *
 * NOT a replacement for the Brain's long-term semantic memory — it's the
 * session-scoped scratch-pad so persona handoffs keep context.
 *
 * @module intelligence-orchestrator/cross-application-memory
 */

export interface MemoryFact {
  readonly key: string;
  readonly value: unknown;
  readonly sourcePersonaId: string;
  readonly confidence: number;
  readonly createdAt: string;
}

export interface CrossPersonaMemoryRepository {
  save(
    tenantId: string,
    sessionId: string,
    fact: MemoryFact,
  ): Promise<void>;
  load(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly MemoryFact[]>;
  clear(tenantId: string, sessionId: string): Promise<void>;
}

export class InMemoryCrossPersonaRepository
  implements CrossPersonaMemoryRepository
{
  private readonly store = new Map<string, MemoryFact[]>();

  private keyFor(tenantId: string, sessionId: string): string {
    return `${tenantId}::${sessionId}`;
  }

  async save(
    tenantId: string,
    sessionId: string,
    fact: MemoryFact,
  ): Promise<void> {
    const key = this.keyFor(tenantId, sessionId);
    const bucket = this.store.get(key) ?? [];
    // immutable replace if same key exists
    const filtered = bucket.filter((f) => f.key !== fact.key);
    this.store.set(key, [...filtered, fact]);
  }

  async load(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly MemoryFact[]> {
    return this.store.get(this.keyFor(tenantId, sessionId)) ?? [];
  }

  async clear(tenantId: string, sessionId: string): Promise<void> {
    this.store.delete(this.keyFor(tenantId, sessionId));
  }
}

export class CrossPersonaMemoryService {
  constructor(private readonly repo: CrossPersonaMemoryRepository) {}

  async remember(input: {
    tenantId: string;
    sessionId: string;
    personaId: string;
    key: string;
    value: unknown;
    confidence?: number;
  }): Promise<MemoryFact> {
    assertTenant(input.tenantId);
    const fact: MemoryFact = {
      key: input.key,
      value: input.value,
      sourcePersonaId: input.personaId,
      confidence: input.confidence ?? 0.9,
      createdAt: new Date().toISOString(),
    };
    await this.repo.save(input.tenantId, input.sessionId, fact);
    return fact;
  }

  async recall(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly MemoryFact[]> {
    assertTenant(tenantId);
    return this.repo.load(tenantId, sessionId);
  }

  /**
   * Build a compact text summary of the cross-persona memory to inject into
   * the next persona's system prompt.
   */
  async generateHandoffContext(
    tenantId: string,
    sessionId: string,
    targetPersonaId: string,
  ): Promise<string> {
    const facts = await this.recall(tenantId, sessionId);
    if (facts.length === 0) return '';
    const lines = [
      `# Prior-persona memory (for ${targetPersonaId})`,
      ...facts.map(
        (f) =>
          `- [${f.sourcePersonaId}] ${f.key}: ${formatValue(f.value)} (conf=${f.confidence.toFixed(2)})`,
      ),
    ];
    return lines.join('\n');
  }

  async forget(tenantId: string, sessionId: string): Promise<void> {
    assertTenant(tenantId);
    await this.repo.clear(tenantId, sessionId);
  }
}

function assertTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('cross-persona-memory: tenantId is required');
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v.slice(0, 200);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

export function createCrossPersonaMemoryService(
  repo: CrossPersonaMemoryRepository,
): CrossPersonaMemoryService {
  return new CrossPersonaMemoryService(repo);
}
