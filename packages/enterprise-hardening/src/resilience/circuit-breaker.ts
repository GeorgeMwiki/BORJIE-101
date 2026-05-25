/**
 * Circuit Breaker Pattern Implementation
 * 
 * Protects services from cascading failures by detecting failures and
 * preventing requests to unhealthy dependencies. Implements the three-state
 * model: Closed (normal), Open (failing), Half-Open (testing recovery).
 */

/**
 * Circuit Breaker States
 */
export const CircuitState = {
  CLOSED: 'CLOSED',     // Normal operation, requests pass through
  OPEN: 'OPEN',         // Failure detected, requests blocked
  HALF_OPEN: 'HALF_OPEN', // Testing recovery, limited requests allowed
} as const;

export type CircuitState = typeof CircuitState[keyof typeof CircuitState];

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Unique identifier for this circuit */
  readonly name: string;
  /** Number of failures before opening circuit */
  readonly failureThreshold: number;
  /** Time window in ms for counting failures */
  readonly failureCountWindow: number;
  /** Duration in ms to keep circuit open before testing */
  readonly resetTimeout: number;
  /** Number of successful calls in half-open to close circuit */
  readonly successThreshold: number;
  /** Timeout in ms for individual calls */
  readonly callTimeout: number;
  /** Whether to include slow calls as failures */
  readonly slowCallThreshold?: number;
  /** Percentage of slow calls to trigger open (0-100) */
  readonly slowCallRateThreshold?: number;
}

/**
 * Circuit Breaker Metrics
 */
export interface CircuitMetrics {
  readonly totalCalls: number;
  readonly successfulCalls: number;
  readonly failedCalls: number;
  readonly slowCalls: number;
  readonly rejectedCalls: number;
  readonly lastFailureTime?: number;
  readonly lastSuccessTime?: number;
  readonly stateChanges: number;
  readonly currentState: CircuitState;
  readonly timeInCurrentState: number;
}

/**
 * Circuit Breaker Event
 */
export interface CircuitEvent {
  readonly circuitName: string;
  readonly eventType: 'state_change' | 'call_success' | 'call_failure' | 'call_rejected' | 'call_timeout';
  readonly timestamp: number;
  readonly previousState?: CircuitState;
  readonly newState?: CircuitState;
  readonly error?: Error;
  readonly duration?: number;
}

/**
 * Event listener type
 */
export type CircuitEventListener = (event: CircuitEvent) => void;

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly remainingTime: number
  ) {
    super(`Circuit '${circuitName}' is OPEN. Retry after ${remainingTime}ms`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit Breaker Implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private successes: number = 0;
  private stateChangedAt: number = Date.now();
  private metrics: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    slowCalls: number;
    rejectedCalls: number;
    lastFailureTime?: number;
    lastSuccessTime?: number;
    stateChanges: number;
  } = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    slowCalls: 0,
    rejectedCalls: 0,
    stateChanges: 0,
  };
  private listeners: CircuitEventListener[] = [];

  constructor(private readonly config: CircuitBreakerConfig) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.allowRequest()) {
      this.metrics.rejectedCalls++;
      this.emitEvent({
        circuitName: this.config.name,
        eventType: 'call_rejected',
        timestamp: Date.now(),
      });
      throw new CircuitOpenError(
        this.config.name,
        this.getRemainingResetTime()
      );
    }

    this.metrics.totalCalls++;
    const startTime = Date.now();

    try {
      const result = await this.executeWithTimeout(fn);
      const duration = Date.now() - startTime;
      
      this.onSuccess(duration);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.onFailure(error as Error, duration);
      throw error;
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Circuit '${this.config.name}' call timeout after ${this.config.callTimeout}ms`));
      }, this.config.callTimeout);

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check if request should be allowed
   */
  private allowRequest(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if reset timeout has passed
        if (now - this.stateChangedAt >= this.config.resetTimeout) {
          this.transitionTo(CircuitState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited requests for testing
        return true;
    }
  }

  /**
   * Handle successful call
   */
  private onSuccess(duration: number): void {
    this.metrics.successfulCalls++;
    this.metrics.lastSuccessTime = Date.now();

    // Check for slow call
    if (this.config.slowCallThreshold && duration > this.config.slowCallThreshold) {
      this.metrics.slowCalls++;
    }

    this.emitEvent({
      circuitName: this.config.name,
      eventType: 'call_success',
      timestamp: Date.now(),
      duration,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed call
   */
  private onFailure(error: Error, duration: number): void {
    const now = Date.now();
    this.metrics.failedCalls++;
    this.metrics.lastFailureTime = now;

    this.emitEvent({
      circuitName: this.config.name,
      eventType: 'call_failure',
      timestamp: now,
      error,
      duration,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Single failure in half-open returns to open
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    if (this.state === CircuitState.CLOSED) {
      // Record failure within window
      this.failures = this.failures.filter(
        t => now - t < this.config.failureCountWindow
      );
      this.failures.push(now);

      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();
    this.metrics.stateChanges++;

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failures = [];
      this.successes = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successes = 0;
    }

    this.emitEvent({
      circuitName: this.config.name,
      eventType: 'state_change',
      timestamp: Date.now(),
      previousState,
      newState,
    });
  }

  /**
   * Get remaining time until reset attempt
   */
  private getRemainingResetTime(): number {
    if (this.state !== CircuitState.OPEN) return 0;
    const elapsed = Date.now() - this.stateChangedAt;
    return Math.max(0, this.config.resetTimeout - elapsed);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit metrics
   */
  getMetrics(): CircuitMetrics {
    return {
      ...this.metrics,
      currentState: this.state,
      timeInCurrentState: Date.now() - this.stateChangedAt,
    };
  }

  /**
   * Force circuit to specific state (for testing/recovery)
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.successes = 0;
    this.stateChangedAt = Date.now();
  }

  /**
   * Add event listener
   */
  addEventListener(listener: CircuitEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emitEvent(event: CircuitEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Circuit Breaker Registry - Manages multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private globalListeners: CircuitEventListener[] = [];

  /**
   * Create or get a circuit breaker
   */
  getOrCreate(config: CircuitBreakerConfig): CircuitBreaker {
    let breaker = this.breakers.get(config.name);
    if (!breaker) {
      breaker = new CircuitBreaker(config);
      // Forward events to global listeners
      breaker.addEventListener(event => {
        for (const listener of this.globalListeners) {
          try {
            listener(event);
          } catch {
            // Ignore
          }
        }
      });
      this.breakers.set(config.name, breaker);
    }
    return breaker;
  }

  /**
   * Get existing circuit breaker
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get metrics for all circuits
   */
  getAllMetrics(): Record<string, CircuitMetrics> {
    const metrics: Record<string, CircuitMetrics> = {};
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }
    return metrics;
  }

  /**
   * Get unhealthy circuits (open or half-open)
   */
  getUnhealthyCircuits(): string[] {
    return Array.from(this.breakers.entries())
      .filter(([_, breaker]) => breaker.getState() !== CircuitState.CLOSED)
      .map(([name]) => name);
  }

  /**
   * Add global event listener
   */
  addGlobalListener(listener: CircuitEventListener): () => void {
    this.globalListeners.push(listener);
    return () => {
      this.globalListeners = this.globalListeners.filter(l => l !== listener);
    };
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

/**
 * Default configurations for common scenarios
 */
export const CircuitBreakerPresets = {
  /** Default settings for database connections */
  DATABASE: {
    failureThreshold: 5,
    failureCountWindow: 60000, // 1 minute
    resetTimeout: 30000, // 30 seconds
    successThreshold: 3,
    callTimeout: 5000, // 5 seconds
  },

  /** Settings for external API calls */
  EXTERNAL_API: {
    failureThreshold: 3,
    failureCountWindow: 30000, // 30 seconds
    resetTimeout: 60000, // 1 minute
    successThreshold: 2,
    callTimeout: 10000, // 10 seconds
    slowCallThreshold: 5000, // 5 seconds
  },

  /** Settings for payment provider calls */
  PAYMENT_PROVIDER: {
    failureThreshold: 2,
    failureCountWindow: 30000,
    resetTimeout: 120000, // 2 minutes
    successThreshold: 3,
    callTimeout: 30000, // 30 seconds
  },

  /** Settings for internal service calls */
  INTERNAL_SERVICE: {
    failureThreshold: 10,
    failureCountWindow: 60000,
    resetTimeout: 15000, // 15 seconds
    successThreshold: 5,
    callTimeout: 3000, // 3 seconds
  },
} as const satisfies Record<string, Omit<CircuitBreakerConfig, 'name'>>;
