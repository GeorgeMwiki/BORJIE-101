/**
 * Health Check System
 * 
 * Implements comprehensive health checking for services, dependencies,
 * and infrastructure. Supports liveness, readiness, and startup probes
 * for Kubernetes-style deployments.
 */

/**
 * Health Check Status
 */
export const HealthStatus = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY',
  UNKNOWN: 'UNKNOWN',
} as const;

export type HealthStatus = typeof HealthStatus[keyof typeof HealthStatus];

/**
 * Health Check Type
 */
export const HealthCheckType = {
  LIVENESS: 'LIVENESS',     // Is the service alive?
  READINESS: 'READINESS',   // Is the service ready to accept traffic?
  STARTUP: 'STARTUP',       // Has the service started successfully?
  DEPENDENCY: 'DEPENDENCY', // Is a dependency healthy?
} as const;

export type HealthCheckType = typeof HealthCheckType[keyof typeof HealthCheckType];

/**
 * Dependency Type
 */
export const DependencyType = {
  DATABASE: 'DATABASE',
  CACHE: 'CACHE',
  MESSAGE_QUEUE: 'MESSAGE_QUEUE',
  EXTERNAL_API: 'EXTERNAL_API',
  INTERNAL_SERVICE: 'INTERNAL_SERVICE',
  FILE_STORAGE: 'FILE_STORAGE',
  SEARCH_INDEX: 'SEARCH_INDEX',
} as const;

export type DependencyType = typeof DependencyType[keyof typeof DependencyType];

/**
 * Individual Health Check Result
 */
export interface HealthCheckResult {
  readonly name: string;
  readonly type: HealthCheckType;
  readonly status: HealthStatus;
  readonly message?: string;
  readonly duration: number;
  readonly timestamp: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Aggregate Health Response
 */
export interface HealthResponse {
  readonly status: HealthStatus;
  readonly version: string;
  readonly uptime: number;
  readonly timestamp: string;
  readonly checks: readonly HealthCheckResult[];
  readonly details?: {
    readonly environment?: string;
    readonly region?: string;
    readonly instanceId?: string;
    readonly commitSha?: string;
  };
}

/**
 * Health Check Definition
 */
export interface HealthCheckDefinition {
  readonly name: string;
  readonly type: HealthCheckType;
  readonly dependencyType?: DependencyType;
  readonly critical: boolean;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly failureThreshold: number;
  readonly successThreshold: number;
  check: () => Promise<{ healthy: boolean; message?: string; details?: Record<string, unknown> }>;
}

/**
 * Health Check Configuration
 */
export interface HealthCheckConfig {
  readonly serviceName: string;
  readonly version: string;
  readonly environment: string;
  readonly region?: string;
  readonly instanceId?: string;
  readonly commitSha?: string;
  readonly checks: readonly HealthCheckDefinition[];
}

/**
 * Check state tracking
 */
interface CheckState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastStatus: HealthStatus;
  lastCheck: number;
  lastResult?: HealthCheckResult;
}

/**
 * Health Check Manager
 */
export class HealthCheckManager {
  private readonly startTime: number = Date.now();
  private checkStates: Map<string, CheckState> = new Map();
  private intervalIds: Map<string, NodeJS.Timeout> = new Map();
  private isStarted: boolean = false;

  constructor(private readonly config: HealthCheckConfig) {
    // Initialize check states
    for (const check of config.checks) {
      this.checkStates.set(check.name, {
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastStatus: HealthStatus.UNKNOWN,
        lastCheck: 0,
      });
    }
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    for (const check of this.config.checks) {
      // Run immediately
      this.runCheck(check);
      
      // Then run periodically
      const intervalId = setInterval(() => {
        this.runCheck(check);
      }, check.intervalMs);
      
      this.intervalIds.set(check.name, intervalId);
    }
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    for (const intervalId of this.intervalIds.values()) {
      clearInterval(intervalId);
    }
    this.intervalIds.clear();
    this.isStarted = false;
  }

  /**
   * Run a single health check
   */
  private async runCheck(check: HealthCheckDefinition): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const state = this.checkStates.get(check.name)!;

    try {
      const result = await Promise.race([
        check.check(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), check.timeoutMs)
        ),
      ]);

      const duration = Date.now() - startTime;
      
      if (result.healthy) {
        state.consecutiveSuccesses++;
        state.consecutiveFailures = 0;
        
        if (state.consecutiveSuccesses >= check.successThreshold) {
          state.lastStatus = HealthStatus.HEALTHY;
        }
      } else {
        state.consecutiveFailures++;
        state.consecutiveSuccesses = 0;
        
        if (state.consecutiveFailures >= check.failureThreshold) {
          state.lastStatus = HealthStatus.UNHEALTHY;
        } else {
          state.lastStatus = HealthStatus.DEGRADED;
        }
      }

      const checkResult: HealthCheckResult = {
        name: check.name,
        type: check.type,
        status: state.lastStatus,
        message: result.message,
        duration,
        timestamp: new Date().toISOString(),
        details: result.details,
      };

      state.lastCheck = Date.now();
      state.lastResult = checkResult;

      return checkResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      state.consecutiveFailures++;
      state.consecutiveSuccesses = 0;

      if (state.consecutiveFailures >= check.failureThreshold) {
        state.lastStatus = HealthStatus.UNHEALTHY;
      } else {
        state.lastStatus = HealthStatus.DEGRADED;
      }

      const checkResult: HealthCheckResult = {
        name: check.name,
        type: check.type,
        status: state.lastStatus,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration,
        timestamp: new Date().toISOString(),
      };

      state.lastCheck = Date.now();
      state.lastResult = checkResult;

      return checkResult;
    }
  }

  /**
   * Get liveness probe response
   */
  async getLiveness(): Promise<HealthResponse> {
    const livenessChecks = this.config.checks.filter(
      c => c.type === HealthCheckType.LIVENESS
    );
    
    return this.getHealthResponse(livenessChecks);
  }

  /**
   * Get readiness probe response
   */
  async getReadiness(): Promise<HealthResponse> {
    const readinessChecks = this.config.checks.filter(
      c => c.type === HealthCheckType.READINESS || c.type === HealthCheckType.DEPENDENCY
    );
    
    return this.getHealthResponse(readinessChecks);
  }

  /**
   * Get startup probe response
   */
  async getStartup(): Promise<HealthResponse> {
    const startupChecks = this.config.checks.filter(
      c => c.type === HealthCheckType.STARTUP
    );
    
    return this.getHealthResponse(startupChecks);
  }

  /**
   * Get full health status
   */
  async getHealth(): Promise<HealthResponse> {
    return this.getHealthResponse(this.config.checks);
  }

  /**
   * Get health response for specified checks
   */
  private async getHealthResponse(
    checks: readonly HealthCheckDefinition[]
  ): Promise<HealthResponse> {
    const results: HealthCheckResult[] = [];
    let overallStatus: HealthStatus = HealthStatus.HEALTHY;

    for (const check of checks) {
      const state = this.checkStates.get(check.name)!;
      
      // Use cached result if recent enough
      if (state.lastResult && Date.now() - state.lastCheck < check.intervalMs / 2) {
        results.push(state.lastResult);
      } else {
        const result = await this.runCheck(check);
        results.push(result);
      }

      // Update overall status
      const result = results[results.length - 1];
      if (check.critical) {
        if (result.status === HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.UNHEALTHY;
        } else if (result.status === HealthStatus.DEGRADED && overallStatus !== HealthStatus.UNHEALTHY) {
          overallStatus = HealthStatus.DEGRADED;
        }
      } else if (result.status !== HealthStatus.HEALTHY && overallStatus === HealthStatus.HEALTHY) {
        overallStatus = HealthStatus.DEGRADED;
      }
    }

    return {
      status: overallStatus,
      version: this.config.version,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
      checks: results,
      details: {
        environment: this.config.environment,
        region: this.config.region,
        instanceId: this.config.instanceId,
        commitSha: this.config.commitSha,
      },
    };
  }

  /**
   * Create a simple check function for common dependency types
   */
  static createDependencyCheck(
    name: string,
    type: DependencyType,
    pingFn: () => Promise<boolean>,
    critical: boolean = true
  ): HealthCheckDefinition {
    return {
      name,
      type: HealthCheckType.DEPENDENCY,
      dependencyType: type,
      critical,
      timeoutMs: 5000,
      intervalMs: 30000,
      failureThreshold: 3,
      successThreshold: 1,
      check: async () => {
        const healthy = await pingFn();
        return {
          healthy,
          message: healthy ? `${name} is reachable` : `${name} is not reachable`,
        };
      },
    };
  }
}

/**
 * Pre-built health check definitions for common dependencies
 */
export const HealthCheckBuilders = {
  /**
   * Database health check
   */
  database: (
    name: string,
    pingFn: () => Promise<boolean>,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name,
    type: HealthCheckType.DEPENDENCY,
    dependencyType: DependencyType.DATABASE,
    critical: true,
    timeoutMs: 5000,
    intervalMs: 30000,
    failureThreshold: 3,
    successThreshold: 1,
    ...options,
    check: async () => {
      const healthy = await pingFn();
      return { healthy, message: healthy ? 'Database connected' : 'Database connection failed' };
    },
  }),

  /**
   * Redis/cache health check
   */
  cache: (
    name: string,
    pingFn: () => Promise<boolean>,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name,
    type: HealthCheckType.DEPENDENCY,
    dependencyType: DependencyType.CACHE,
    critical: false, // Cache is typically not critical
    timeoutMs: 2000,
    intervalMs: 15000,
    failureThreshold: 5,
    successThreshold: 1,
    ...options,
    check: async () => {
      const healthy = await pingFn();
      return { healthy, message: healthy ? 'Cache connected' : 'Cache connection failed' };
    },
  }),

  /**
   * External API health check
   */
  externalApi: (
    name: string,
    healthEndpoint: string,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => {
    const effectiveTimeout = options?.timeoutMs ?? 10000;
    return {
      name,
      type: HealthCheckType.DEPENDENCY,
      dependencyType: DependencyType.EXTERNAL_API,
      critical: false,
      timeoutMs: effectiveTimeout,
      intervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 1,
      ...options,
      check: async () => {
        try {
          // Wire the configured timeoutMs to the network call so a hanging
          // upstream cannot stall the health probe scheduler.
          const response = await fetch(healthEndpoint, {
            method: 'HEAD',
            signal: AbortSignal.timeout(effectiveTimeout),
          });
          const healthy = response.ok;
          return {
            healthy,
            message: healthy ? `${name} is available` : `${name} returned ${response.status}`,
            details: { statusCode: response.status },
          };
        } catch (error) {
          return {
            healthy: false,
            message: `${name} is unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    };
  },

  /**
   * Memory usage check
   */
  memory: (
    maxHeapUsagePercent: number = 90,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name: 'memory',
    type: HealthCheckType.LIVENESS,
    critical: true,
    timeoutMs: 1000,
    intervalMs: 10000,
    failureThreshold: 3,
    successThreshold: 1,
    ...options,
    check: async () => {
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      const healthy = heapUsedPercent < maxHeapUsagePercent;
      return {
        healthy,
        message: `Heap usage: ${heapUsedPercent.toFixed(1)}%`,
        details: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          heapUsedPercent: heapUsedPercent.toFixed(1),
          rss: memUsage.rss,
          external: memUsage.external,
        },
      };
    },
  }),

  /**
   * Disk space check (requires fs operations)
   */
  diskSpace: (
    path: string,
    minFreePercent: number = 10,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name: 'disk-space',
    type: HealthCheckType.LIVENESS,
    critical: true,
    timeoutMs: 5000,
    intervalMs: 60000,
    failureThreshold: 2,
    successThreshold: 1,
    ...options,
    check: async () => {
      // This would need actual disk check implementation
      // Placeholder returning healthy
      return {
        healthy: true,
        message: `Disk space check for ${path}`,
        details: { path, minFreePercent },
      };
    },
  }),

  /**
   * Custom liveness check
   */
  liveness: (
    name: string,
    checkFn: () => Promise<{ healthy: boolean; message?: string; details?: Record<string, unknown> }>,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name,
    type: HealthCheckType.LIVENESS,
    critical: true,
    timeoutMs: 5000,
    intervalMs: 10000,
    failureThreshold: 3,
    successThreshold: 1,
    ...options,
    check: checkFn,
  }),

  /**
   * Custom readiness check
   */
  readiness: (
    name: string,
    checkFn: () => Promise<{ healthy: boolean; message?: string; details?: Record<string, unknown> }>,
    options?: Partial<HealthCheckDefinition>
  ): HealthCheckDefinition => ({
    name,
    type: HealthCheckType.READINESS,
    critical: true,
    timeoutMs: 5000,
    intervalMs: 15000,
    failureThreshold: 2,
    successThreshold: 1,
    ...options,
    check: checkFn,
  }),
};

/**
 * HTTP response codes for health endpoints
 */
export const HealthStatusCodes: Record<HealthStatus, number> = {
  [HealthStatus.HEALTHY]: 200,
  [HealthStatus.DEGRADED]: 200, // Still serving, but degraded
  [HealthStatus.UNHEALTHY]: 503,
  [HealthStatus.UNKNOWN]: 503,
};
