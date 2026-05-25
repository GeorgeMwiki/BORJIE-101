/**
 * Connector Orchestrator — single dispatch surface for every external
 * call that crosses the Borjie boundary. Mirrors LITFIN's
 * `src/core/connectors/connector-orchestrator.ts`, scoped to property-
 * management adapters (Mpesa B2C, GePG, KRA MRI, RERA, OpenSearch).
 *
 * Closes Gap C from `.planning/parity-litfin/09-tools-connectors-kg.md`.
 *
 * Responsibilities:
 *   1. Look the connector up in the registry by id.
 *   2. Apply orchestrator-level retry-with-jitter on retryable outcomes.
 *   3. Honour the per-connector `dispatchTimeoutMs` ceiling.
 *   4. Fall over to `policy.backupConnectorId` when the primary keeps
 *      returning `circuit-open` or exhausts retries.
 *   5. Roll the resulting `CircuitHealth` back into the registry cache
 *      so dashboards see fresh state without polling each connector.
 *
 * The orchestrator does NOT touch the base-connector's own retry /
 * rate-limit / circuit-breaker — those are transport-layer. Orchestrator
 * retries are policy-layer: "M-Pesa returned circuit-open, fall over
 * to backup gateway." Different concern, different layer.
 */

import type {
  BaseConnector,
  ConnectorOutcome,
  ConnectorRequest,
} from './base-connector.js';
import type { ConnectorEntry, ConnectorRegistry } from './registry.js';

// ---------- Public types ----------

export interface DispatchResult<O> {
  readonly outcome: ConnectorOutcome<O>;
  /** Connector that ultimately produced the outcome — may be the backup. */
  readonly servedBy: string;
  /** Orchestrator-level retry attempts consumed (1 = no retry). */
  readonly attemptsUsed: number;
  /** Whether the primary connector failed over to the backup. */
  readonly failedOver: boolean;
  /** Total wall-clock time the orchestrator spent including retries. */
  readonly totalMs: number;
}

export interface ConnectorOrchestrator {
  dispatch<I, O>(
    connectorId: string,
    request: ConnectorRequest<I>,
  ): Promise<DispatchResult<O>>;
}

export interface ConnectorOrchestratorDeps {
  readonly registry: ConnectorRegistry;
  readonly clock?: () => number;
  /** Custom sleeper — defaults to setTimeout. Useful in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Random source in [0,1) — defaults to Math.random. */
  readonly random?: () => number;
}

// ---------- Helpers ----------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function jitter(baseMs: number, rand: () => number): number {
  // +/- 20% jitter — matches base-connector retry jitter.
  const spread = baseMs * 0.2;
  return Math.max(0, baseMs + (rand() * 2 - 1) * spread);
}

function isRetryable<O>(outcome: ConnectorOutcome<O>): boolean {
  // Retry-eligible at the orchestrator layer:
  //   - transport-error: network blip
  //   - upstream-error with 5xx: upstream still alive but flaky
  //   - rate-limited: caller may want to wait it out at the orchestrator
  //   - circuit-open: only useful so we can fall over to backup
  switch (outcome.kind) {
    case 'transport-error':
      return true;
    case 'upstream-error':
      return outcome.status >= 500;
    case 'rate-limited':
      return true;
    case 'circuit-open':
      return true;
    default:
      return false;
  }
}

function shouldFailover<O>(outcome: ConnectorOutcome<O>): boolean {
  // Fall over once the primary has clearly entered a dead-zone:
  // open circuit OR sustained 5xx / transport.
  if (outcome.kind === 'circuit-open') return true;
  if (outcome.kind === 'transport-error') return true;
  if (outcome.kind === 'upstream-error' && outcome.status >= 500) return true;
  return false;
}

function buildTimeoutOutcome<O>(timeoutMs: number): ConnectorOutcome<O> {
  return Object.freeze({
    kind: 'transport-error',
    message: `orchestrator dispatch timed out after ${timeoutMs}ms`,
  }) as ConnectorOutcome<O>;
}

function callWithTimeout<I, O>(
  connector: BaseConnector,
  req: ConnectorRequest<I>,
  timeoutMs: number,
  clock: () => number,
): Promise<ConnectorOutcome<O>> {
  // Race the connector call against a deadline. We can't abort the
  // connector mid-flight (it owns its own AbortController inside
  // singleAttempt), so this is a soft timeout: we resolve early but the
  // connector keeps draining. That is preferable to hanging the caller.
  const start = clock();
  return new Promise<ConnectorOutcome<O>>((resolve) => {
    let settled = false;
    const handle = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(buildTimeoutOutcome<O>(timeoutMs));
    }, Math.max(1, timeoutMs));

    void connector.call<I, O>(req).then(
      (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        resolve(outcome);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        const message = err instanceof Error ? err.message : String(err);
        resolve(
          Object.freeze({
            kind: 'transport-error',
            message,
          }) as ConnectorOutcome<O>,
        );
      },
    );
    // Touch start so it isn't dead-code under noUnusedLocals. The value
    // is informational — actual elapsed time is tracked by the caller.
    void start;
  });
}

// ---------- Factory ----------

export function createConnectorOrchestrator(
  deps: ConnectorOrchestratorDeps,
): ConnectorOrchestrator {
  const { registry } = deps;
  const clock = deps.clock ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  async function dispatchOne<I, O>(
    entry: ConnectorEntry,
    request: ConnectorRequest<I>,
  ): Promise<{ outcome: ConnectorOutcome<O>; attempts: number }> {
    const maxAttempts = Math.max(1, entry.policy.maxRetryAttempts ?? 2);
    const initialDelayMs = Math.max(1, entry.policy.retryInitialDelayMs ?? 200);
    const timeoutMs = Math.max(1, entry.policy.dispatchTimeoutMs ?? 15_000);

    let lastOutcome: ConnectorOutcome<O> = buildTimeoutOutcome<O>(timeoutMs);
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      lastOutcome = await callWithTimeout<I, O>(
        entry.connector,
        request,
        timeoutMs,
        clock,
      );
      // Roll latest circuit health back into the registry cache.
      registry.refreshCircuit(entry.id);

      if (lastOutcome.kind === 'ok') {
        return { outcome: lastOutcome, attempts: attempt };
      }
      if (!isRetryable(lastOutcome)) {
        return { outcome: lastOutcome, attempts: attempt };
      }
      if (attempt < maxAttempts) {
        const base = initialDelayMs * 2 ** (attempt - 1);
        await sleep(jitter(base, random));
      }
    }
    return { outcome: lastOutcome, attempts: attempt };
  }

  async function dispatch<I, O>(
    connectorId: string,
    request: ConnectorRequest<I>,
  ): Promise<DispatchResult<O>> {
    const start = clock();
    const primary = registry.get(connectorId);
    if (!primary) {
      return {
        outcome: {
          kind: 'unconfigured',
          reason: `connector "${connectorId}" not registered`,
        } as ConnectorOutcome<O>,
        servedBy: connectorId,
        attemptsUsed: 0,
        failedOver: false,
        totalMs: clock() - start,
      };
    }

    const primaryResult = await dispatchOne<I, O>(primary, request);
    if (primaryResult.outcome.kind === 'ok') {
      return {
        outcome: primaryResult.outcome,
        servedBy: primary.id,
        attemptsUsed: primaryResult.attempts,
        failedOver: false,
        totalMs: clock() - start,
      };
    }

    const backupId = primary.policy.backupConnectorId;
    if (backupId && shouldFailover(primaryResult.outcome)) {
      const backup = registry.get(backupId);
      if (backup && backup.id !== primary.id) {
        const backupResult = await dispatchOne<I, O>(backup, request);
        return {
          outcome: backupResult.outcome,
          servedBy: backup.id,
          attemptsUsed: primaryResult.attempts + backupResult.attempts,
          failedOver: true,
          totalMs: clock() - start,
        };
      }
    }

    return {
      outcome: primaryResult.outcome,
      servedBy: primary.id,
      attemptsUsed: primaryResult.attempts,
      failedOver: false,
      totalMs: clock() - start,
    };
  }

  return { dispatch };
}
