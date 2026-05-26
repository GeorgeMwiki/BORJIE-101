/**
 * `@borjie/agent-security-guard` — SEC-4 (Mr. Mwikila persona).
 *
 * Public package surface. See Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md
 * for the full threat model and defense matrix.
 *
 * Modules:
 *   - detect/         direct + indirect prompt-injection detectors
 *   - jailbreak/      many-shot / DAN / GCG suffix detection
 *   - sandbox/        tool-use validator + argument sanitiser + registry
 *   - filter/         output filter (markdown-image, PII, leak, JS, code-exec)
 *   - redteam/        30+ built-in scenarios + scenario runner
 *   - repositories/   ports + in-memory implementations
 *   - audit/          tamper-evident hash chain
 *   - logging/        package-local structured logger
 */

// --- Types -----------------------------------------------------------------
export * from './types.js';

// --- Detectors -------------------------------------------------------------
export {
  DIRECT_INJECTION_PATTERNS,
  INDIRECT_INJECTION_PATTERNS,
  ZERO_WIDTH_REGEX,
  type PromptInjectionPattern,
} from './detect/prompt-injection-patterns.js';

export {
  createPromptInjectionDetector,
  type DetectionMatch,
  type LlmJudgePort,
  type LlmJudgeVerdict,
  type PromptInjectionDetectionResult,
  type PromptInjectionDetector,
  type PromptInjectionDetectorDeps,
} from './detect/prompt-injection-detector.js';

export {
  createIndirectInjectionDetector,
  type IndirectInjectionDetector,
  type IndirectInjectionScanInput,
} from './detect/indirect-injection-detector.js';

// --- Jailbreak -------------------------------------------------------------
export {
  createJailbreakDetector,
  type JailbreakDetectionResult,
  type JailbreakDetector,
  type JailbreakSignal,
} from './jailbreak/jailbreak-detector.js';

// --- Sandbox ---------------------------------------------------------------
export {
  createInMemoryToolRegistry,
  type ToolDefinition,
  type ToolRegistry,
} from './sandbox/tool-registry.js';

export {
  sanitizeToolArgs,
  type SanitizeResult,
  z,
} from './sandbox/argument-sanitizer.js';

export {
  createToolUseValidator,
  type ToolCallAttempt,
  type ToolUseValidator,
  type ToolUseValidatorDeps,
} from './sandbox/tool-use-validator.js';

// --- Output filter ---------------------------------------------------------
export {
  createOutputFilter,
  type DataProtectionPort,
  type OutputFilter,
  type OutputFilterDeps,
} from './filter/output-filter.js';

// --- Red-team --------------------------------------------------------------
export {
  BUILTIN_SCENARIOS,
  BUILTIN_SCENARIO_MAP,
} from './redteam/builtin-scenarios.js';

export {
  createRedTeamRunner,
  createToolUseCallbackFromValidator,
  findCriticalFailures,
  type RedTeamRunner,
  type RedTeamRunnerDeps,
  type RedTeamRunnerResult,
  type ToolUseScenarioCallback,
} from './redteam/red-team-runner.js';

// --- Repositories ----------------------------------------------------------
export type {
  AgentSecuritySignalRepository,
  OutputFilterBlockRepository,
  PromptInjectionAttemptRepository,
  RedTeamRunRepository,
  ToolUseViolationRepository,
} from './repositories/types.js';

export {
  createInMemoryOutputFilterRepo,
  createInMemoryPromptInjectionRepo,
  createInMemoryRedTeamRepo,
  createInMemorySignalRepo,
  createInMemoryToolUseRepo,
} from './repositories/in-memory.js';

// --- Audit -----------------------------------------------------------------
export { chainHash, genesisHash, rowHash } from './audit/hash-chain.js';

// --- Logging ---------------------------------------------------------------
export {
  createLogger,
  type CreateLoggerDeps,
  type LogEmitter,
  type LogLevel,
  type Logger,
  type ServiceIdentity,
  type TelemetryConfig,
} from './logging/logger.js';
