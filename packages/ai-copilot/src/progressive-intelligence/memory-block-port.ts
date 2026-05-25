/**
 * Duck-typed mirror of the `MemoryBlockStore` port defined in
 * `@borjie/central-intelligence/kernel/memory/types-amem`.
 *
 * Kept local to avoid an extra inter-package dependency from
 * `@borjie/ai-copilot` to `@borjie/central-intelligence` just
 * to satisfy a structural interface. The shapes MUST stay in sync —
 * a test in `__tests__/postgres-memory-block-store.test.ts` enforces
 * structural compatibility via a type-only assignment.
 */

export interface MemoryBlock {
  readonly id: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly kind: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemoryBlockUpsert {
  readonly id?: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly kind: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryBlockStore {
  list(args: {
    readonly tenantId: string | null;
    readonly sessionId: string;
  }): Promise<ReadonlyArray<MemoryBlock>>;
  upsert(block: MemoryBlockUpsert): Promise<MemoryBlock>;
  remove(args: {
    readonly tenantId: string | null;
    readonly id: string;
  }): Promise<void>;
}
