/**
 * @borjie/open-coding-agent-patterns — public barrel.
 *
 * See `Docs/OPEN_CODING_AGENTS_RESEARCH_2026-05-24.md` for the source
 * survey + rationale. Each subsystem is a port of a pattern from a
 * leading 2026 open-source coding agent (Aider, Cursor, Cline,
 * OpenHands, SWE-agent, Plandex, Browser-use, Anthropic CUA).
 */

export * from './types.js';
export * from './repository-map/index.js';
export * from './minimal-diff-editing/index.js';
export * from './sandbox-execution/index.js';
export * from './tdd-loop/index.js';
export * from './plan-persistence/index.js';
export * from './browser-agent/index.js';
export * from './trajectory/index.js';

// Re-exported factory below — concrete types live in `./types.ts`.
import type {
  BrainPort,
  BrowserPort,
  ComputerActionPort,
  RuntimeLogger,
  SandboxPort,
} from './types.js';
import { noopLogger } from './types.js';

export interface OpenCodingAgentDeps {
  readonly brain: BrainPort;
  readonly sandbox?: SandboxPort;
  readonly browser?: BrowserPort;
  readonly computer?: ComputerActionPort;
  readonly logger?: RuntimeLogger;
}

export interface OpenCodingAgent {
  readonly brain: BrainPort;
  readonly sandbox: SandboxPort | undefined;
  readonly browser: BrowserPort | undefined;
  readonly computer: ComputerActionPort | undefined;
  readonly logger: RuntimeLogger;
}

/**
 * Aggregate factory. Wires the user-provided ports together. Each
 * subsystem is also exported standalone for callers who want to mix
 * and match.
 */
export function createOpenCodingAgent(deps: OpenCodingAgentDeps): OpenCodingAgent {
  return Object.freeze({
    brain: deps.brain,
    sandbox: deps.sandbox,
    browser: deps.browser,
    computer: deps.computer,
    logger: deps.logger ?? noopLogger,
  });
}
