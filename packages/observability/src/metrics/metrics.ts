/**
 * Metrics Service
 * 
 * OpenTelemetry-based metrics collection for BORJIE platform.
 * Provides counters, gauges, and histograms with multi-tenant labeling.
 */

import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import {
  metrics,
  Counter,
  Histogram,
  ObservableGauge,
  Meter,
  Attributes,
} from '@opentelemetry/api';
import type { TelemetryConfig, MetricDefinition } from '../types/telemetry.types.js';
import { PLATFORM_METRICS } from '../types/telemetry.types.js';

let meterProvider: MeterProvider | null = null;

/**
 * Initialize the metrics SDK
 */
export function initMetrics(config: TelemetryConfig): MeterProvider {
  if (meterProvider) {
    return meterProvider;
  }

  if (!config.enabled) {
    // Return default meter provider
    meterProvider = new MeterProvider();
    return meterProvider;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.service.name,
    [ATTR_SERVICE_VERSION]: config.service.version,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.service.environment,
  });

  const readers = [];

  if (config.metricsExporter) {
    const exporter = new OTLPMetricExporter({
      url: config.metricsExporter.endpoint,
      headers: config.metricsExporter.headers,
      timeoutMillis: config.metricsExporter.timeoutMs,
    });

    readers.push(
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: config.metricsIntervalMs,
      })
    );
  }

  meterProvider = new MeterProvider({
    resource,
    readers,
  });

  metrics.setGlobalMeterProvider(meterProvider);

  return meterProvider;
}

/**
 * Shutdown metrics SDK
 */
export async function shutdownMetrics(): Promise<void> {
  if (meterProvider) {
    await meterProvider.shutdown();
    meterProvider = null;
  }
}

/**
 * Get a meter for a service
 */
export function getMeter(name: string, version?: string): Meter {
  return metrics.getMeter(name, version);
}

/**
 * Platform metrics collector
 * 
 * Provides pre-configured metrics for common platform operations.
 */
export class PlatformMetrics {
  private readonly meter: Meter;
  private readonly counters: Map<string, Counter> = new Map();
  private readonly histograms: Map<string, Histogram> = new Map();
  private readonly gauges: Map<string, ObservableGauge> = new Map();
  private readonly gaugeValues: Map<string, Map<string, number>> = new Map();

  constructor(serviceName: string, version?: string) {
    this.meter = getMeter(serviceName, version);
    this.initializePlatformMetrics();
  }

  private initializePlatformMetrics(): void {
    // Initialize standard platform metrics
    for (const [key, def] of Object.entries(PLATFORM_METRICS)) {
      this.createMetric(key, def);
    }
  }

  private createMetric(key: string, def: MetricDefinition): void {
    switch (def.type) {
      case 'counter':
        this.counters.set(
          key,
          this.meter.createCounter(def.name, {
            description: def.description,
            unit: def.unit,
          })
        );
        break;
      case 'histogram':
        this.histograms.set(
          key,
          this.meter.createHistogram(def.name, {
            description: def.description,
            unit: def.unit,
          })
        );
        break;
      case 'gauge': {
        this.gaugeValues.set(key, new Map());
        this.gauges.set(
          key,
          this.meter.createObservableGauge(def.name, {
            description: def.description,
            unit: def.unit,
          })
        );
        // Register callback for gauge
        const gaugeMap = this.gaugeValues.get(key);
        const gauge = this.gauges.get(key);
        if (gauge && gaugeMap) {
          this.meter.addBatchObservableCallback(
            (result) => {
              for (const [labelsKey, value] of gaugeMap.entries()) {
                const labels = JSON.parse(labelsKey) as Attributes;
                result.observe(gauge, value, labels);
              }
            },
            [gauge]
          );
        }
        break;
      }
    }
  }

  /**
   * Record an HTTP request
   */
  recordHttpRequest(
    method: string,
    path: string,
    status: number,
    durationMs: number,
    tenantId?: string
  ): void {
    const labels: Attributes = {
      method,
      path,
      status: status.toString(),
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('HTTP_REQUESTS_TOTAL')?.add(1, labels);
    this.histograms.get('HTTP_REQUEST_DURATION')?.record(durationMs, labels);
  }

  /**
   * Record a payment transaction
   */
  recordPayment(
    type: string,
    status: string,
    amount: number,
    currency: string,
    tenantId?: string
  ): void {
    const countLabels: Attributes = {
      type,
      status,
      ...(tenantId && { tenant: tenantId }),
    };
    const amountLabels: Attributes = {
      type,
      currency,
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('PAYMENTS_TOTAL')?.add(1, countLabels);
    this.histograms.get('PAYMENT_AMOUNT')?.record(amount, amountLabels);
  }

  /**
   * Record a maintenance request
   */
  recordMaintenanceRequest(
    priority: string,
    status: string,
    tenantId?: string
  ): void {
    const labels: Attributes = {
      priority,
      status,
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('MAINTENANCE_REQUESTS')?.add(1, labels);
  }

  /**
   * Record maintenance resolution time
   */
  recordMaintenanceResolution(
    priority: string,
    resolutionTimeMs: number,
    tenantId?: string
  ): void {
    const labels: Attributes = {
      priority,
      ...(tenantId && { tenant: tenantId }),
    };

    this.histograms.get('MAINTENANCE_RESOLUTION_TIME')?.record(
      resolutionTimeMs,
      labels
    );
  }

  /**
   * Record an authentication attempt
   */
  recordAuthAttempt(
    method: string,
    outcome: 'success' | 'failure' | 'blocked',
    tenantId?: string
  ): void {
    const labels: Attributes = {
      method,
      outcome,
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('AUTH_ATTEMPTS')?.add(1, labels);
  }

  /**
   * Set active session count
   */
  setActiveSessions(count: number, tenantId?: string): void {
    const labels: Attributes = {
      ...(tenantId && { tenant: tenantId }),
    };
    const key = JSON.stringify(labels);
    this.gaugeValues.get('ACTIVE_SESSIONS')?.set(key, count);
  }

  /**
   * Record an audit event
   */
  recordAuditEvent(
    category: string,
    outcome: string,
    tenantId?: string
  ): void {
    const labels: Attributes = {
      category,
      outcome,
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('AUDIT_EVENTS')?.add(1, labels);
  }

  /**
   * Record an application error
   */
  recordError(
    type: string,
    service: string,
    tenantId?: string
  ): void {
    const labels: Attributes = {
      type,
      service,
      ...(tenantId && { tenant: tenantId }),
    };

    this.counters.get('ERROR_COUNT')?.add(1, labels);
  }

  /**
   * Create a custom counter
   */
  createCounter(
    name: string,
    description: string,
    unit?: string
  ): Counter {
    return this.meter.createCounter(name, { description, unit });
  }

  /**
   * Create a custom histogram
   */
  createHistogram(
    name: string,
    description: string,
    unit?: string
  ): Histogram {
    return this.meter.createHistogram(name, { description, unit });
  }

  /**
   * Get the underlying meter
   */
  getMeter(): Meter {
    return this.meter;
  }
}
