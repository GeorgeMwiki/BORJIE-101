/**
 * Structured Logger
 * 
 * Pino-based structured logger with OpenTelemetry trace context integration.
 * Provides consistent logging across all BORJIE services.
 */

import pino, { Logger as PinoLogger } from 'pino';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import type { LogLevel, ServiceIdentity, TelemetryConfig } from '../types/telemetry.types.js';

/**
 * Logger context for multi-tenant and request scoping
 */
export interface LoggerContext {
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
  /** User ID for user-scoped operations */
  userId?: string;
  /** Request ID from API gateway */
  requestId?: string;
  /** Session ID */
  sessionId?: string;
  /** Additional context attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Service identity */
  service: ServiceIdentity;
  /** Log level */
  level: LogLevel;
  /** Pretty print for development */
  pretty?: boolean;
  /** Fields to redact */
  redactFields?: string[];
  /** Base context */
  baseContext?: LoggerContext;
}

// Scale-hardening: expanded to cover the full set of sensitive headers /
// fields the BORJIE platform handles. Names are de-duplicated by Pino,
// so adding the snake_case and camelCase variants is safe and
// belt-and-suspenders against the rapid mix of conventions across the
// brain / payments / auth services.
//
// - `authorization` (header), `cookie` (header) — request headers.
// - `password`, `passwordHash` — auth flows.
// - `token`, `tokenHash`, `refreshToken`, `jwt`, `bearer` — auth tokens.
// - `secret`, `mfaSecret`, `apiKey`, `api_key`, `webhookSecret` — secrets.
// - `creditCard`, `ssn`, `bankAccount`, `iban`, `nationalId` — PII.
const DEFAULT_REDACT_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'refreshToken',
  'jwt',
  'bearer',
  'secret',
  'mfaSecret',
  'apiKey',
  'api_key',
  'webhookSecret',
  'authorization',
  'cookie',
  'creditCard',
  'ssn',
  'bankAccount',
  'iban',
  'nationalId',
];

/**
 * Create the base Pino logger instance
 */
function createPinoLogger(config: LoggerConfig): PinoLogger {
  const redactPaths = [
    ...(config.redactFields ?? DEFAULT_REDACT_FIELDS).map(f => f),
    ...(config.redactFields ?? DEFAULT_REDACT_FIELDS).map(f => `*.${f}`),
    ...(config.redactFields ?? DEFAULT_REDACT_FIELDS).map(f => `*.*.${f}`),
  ];

  const options: pino.LoggerOptions = {
    level: config.level,
    base: {
      service: config.service.name,
      version: config.service.version,
      environment: config.service.environment,
      ...(config.service.instanceId && { instance: config.service.instanceId }),
    },
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (config.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(options);
}

/**
 * Get current trace context from OpenTelemetry
 */
function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

/**
 * Structured Logger for BORJIE platform
 */
export class Logger {
  private readonly pino: PinoLogger;
  private readonly baseContext: LoggerContext;

  constructor(
    private readonly config: LoggerConfig,
    parentLogger?: PinoLogger
  ) {
    this.pino = parentLogger ?? createPinoLogger(config);
    this.baseContext = config.baseContext ?? {};
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LoggerContext): Logger {
    const mergedContext = {
      ...this.baseContext,
      ...context,
      attributes: {
        ...this.baseContext.attributes,
        ...context.attributes,
      },
    };
    return new Logger(
      { ...this.config, baseContext: mergedContext },
      this.pino
    );
  }

  /**
   * Create a child logger scoped to a tenant
   */
  forTenant(tenantId: string): Logger {
    return this.child({ tenantId });
  }

  /**
   * Create a child logger scoped to a user
   */
  forUser(userId: string): Logger {
    return this.child({ userId });
  }

  /**
   * Create a child logger scoped to a request
   */
  forRequest(requestId: string, sessionId?: string): Logger {
    return this.child({ requestId, sessionId });
  }

  /**
   * Build log object with context
   */
  private buildLogObj(
    data?: Record<string, unknown>
  ): Record<string, unknown> {
    const traceContext = getTraceContext();
    
    return {
      ...(this.baseContext.tenantId && { tenantId: this.baseContext.tenantId }),
      ...(this.baseContext.userId && { userId: this.baseContext.userId }),
      ...(this.baseContext.requestId && { requestId: this.baseContext.requestId }),
      ...(this.baseContext.sessionId && { sessionId: this.baseContext.sessionId }),
      ...traceContext,
      ...this.baseContext.attributes,
      ...data,
    };
  }

  /** Log at trace level */
  trace(message: string, data?: Record<string, unknown>): void {
    this.pino.trace(this.buildLogObj(data), message);
  }

  /** Log at debug level */
  debug(message: string, data?: Record<string, unknown>): void {
    this.pino.debug(this.buildLogObj(data), message);
  }

  /** Log at info level */
  info(message: string, data?: Record<string, unknown>): void {
    this.pino.info(this.buildLogObj(data), message);
  }

  /** Log at warn level */
  warn(message: string, data?: Record<string, unknown>): void {
    this.pino.warn(this.buildLogObj(data), message);
  }

  /** Log at error level */
  error(message: string, error?: Error | Record<string, unknown>, data?: Record<string, unknown>): void {
    let logData = this.buildLogObj(data);
    
    if (error instanceof Error) {
      logData = {
        ...logData,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };
      
      // Also record error on current span if available
      const span = trace.getSpan(context.active());
      if (span) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      }
    } else if (error) {
      logData = { ...logData, ...error };
    }
    
    this.pino.error(logData, message);
  }

  /** Log at fatal level */
  fatal(message: string, error?: Error | Record<string, unknown>, data?: Record<string, unknown>): void {
    let logData = this.buildLogObj(data);
    
    if (error instanceof Error) {
      logData = {
        ...logData,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };
    } else if (error) {
      logData = { ...logData, ...error };
    }
    
    this.pino.fatal(logData, message);
  }

  /**
   * Get the underlying Pino logger (for advanced use)
   */
  getPino(): PinoLogger {
    return this.pino;
  }
}

/**
 * Create a logger from telemetry config
 */
export function createLogger(config: TelemetryConfig): Logger {
  return new Logger({
    service: config.service,
    level: config.logLevel,
    pretty: config.consoleExport,
    redactFields: config.redactFields,
  });
}
