/**
 * routing-config/in-memory-adapter.ts — in-memory `RoutingConfigPort` for
 * tests + standalone bootstrap. Production wires a Drizzle adapter against
 * the `platform_llm_routing_config` table (api-gateway composition).
 */

import type { ConfigScope, LlmRoutingConfig } from './config-model.js';
import type { RoutingConfigPort } from './config-port.js';

export class InMemoryRoutingConfigAdapter implements RoutingConfigPort {
  private readonly store = new Map<ConfigScope, LlmRoutingConfig>();

  async readForScope(scope: ConfigScope): Promise<LlmRoutingConfig | null> {
    return this.store.get(scope) ?? null;
  }

  async upsertForScope(
    scope: ConfigScope,
    config: LlmRoutingConfig,
  ): Promise<void> {
    this.store.set(scope, config);
  }

  /** Sync read for wiring a `RoutingConfigReader` directly off this store. */
  readSync(scope: ConfigScope): LlmRoutingConfig | null {
    return this.store.get(scope) ?? null;
  }

  /** Test hook. */
  clear(): void {
    this.store.clear();
  }
}
