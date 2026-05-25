/**
 * @borjie/openclaw-operating-model
 *
 * Operating-model layer on top of the technical primitives produced by
 * P56 (agent-runtime), P57 (mcp), P58 (agent-orchestrator), P59 (open-
 * coding-agent-patterns). Implements Jensen Huang's GTC 2026 OpenClaw
 * three-pillar framing plus NemoClaw governance:
 *
 *   1. Context architecture   → src/context-architecture
 *   2. Agent task domains     → src/agent-domains   (10 pre-shipped)
 *   3. Autonomy ladders L0..5 → src/autonomy-ladders
 *   4. Per-tenant policy DSL  → src/policy-engine
 *   5. Kill switches          → src/kill-switch
 *   6. Agent-as-a-Service     → src/agent-as-a-service
 *   7. CAO dashboards         → src/chief-agent-officer
 */

export * from './types.js';
export * from './autonomy-ladders/index.js';
export * from './agent-domains/index.js';
export * from './context-architecture/index.js';
export * from './policy-engine/index.js';
export * from './kill-switch/index.js';
export * from './agent-as-a-service/index.js';
export * from './chief-agent-officer/index.js';
export * from './create.js';
