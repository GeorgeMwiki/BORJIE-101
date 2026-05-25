/**
 * Resource Monitor and FinOps Utilities
 * 
 * Implements resource monitoring, cost tracking, and optimization
 * recommendations for cloud-native SaaS operations.
 */

/**
 * Resource Type
 */
export const ResourceType = {
  COMPUTE: 'COMPUTE',           // CPU, containers, serverless
  MEMORY: 'MEMORY',             // RAM, heap
  STORAGE: 'STORAGE',           // Disk, object storage
  DATABASE: 'DATABASE',         // RDS, managed databases
  NETWORK: 'NETWORK',           // Bandwidth, data transfer
  CACHE: 'CACHE',               // Redis, Memcached
  CDN: 'CDN',                   // Content delivery
  SERVERLESS: 'SERVERLESS',     // Lambda, Cloud Functions
  API_CALLS: 'API_CALLS',       // Third-party API usage
} as const;

export type ResourceType = typeof ResourceType[keyof typeof ResourceType];

/**
 * Resource Status
 */
export const ResourceStatus = {
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ResourceStatus = typeof ResourceStatus[keyof typeof ResourceStatus];

/**
 * Cost Allocation Dimension
 */
export const CostDimension = {
  TENANT: 'TENANT',
  SERVICE: 'SERVICE',
  ENVIRONMENT: 'ENVIRONMENT',
  REGION: 'REGION',
  TEAM: 'TEAM',
  FEATURE: 'FEATURE',
} as const;

export type CostDimension = typeof CostDimension[keyof typeof CostDimension];

/**
 * Resource Metric
 */
export interface ResourceMetric {
  readonly resourceType: ResourceType;
  readonly resourceId: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly timestamp: string;
  readonly tags?: Record<string, string>;
}

/**
 * Resource Threshold
 */
export interface ResourceThreshold {
  readonly resourceType: ResourceType;
  readonly metric: string;
  readonly warningThreshold: number;
  readonly criticalThreshold: number;
  readonly comparison: 'gt' | 'gte' | 'lt' | 'lte';
}

/**
 * Resource Alert
 */
export interface ResourceAlert {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly resourceId: string;
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
  readonly status: ResourceStatus;
  readonly triggeredAt: string;
  readonly resolvedAt?: string;
  readonly acknowledged: boolean;
  readonly acknowledgedBy?: string;
}

/**
 * Cost Record
 */
export interface CostRecord {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly resourceId: string;
  readonly amount: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly allocation: Record<CostDimension, string>;
  readonly usage: {
    readonly quantity: number;
    readonly unit: string;
    readonly unitPrice: number;
  };
  readonly tags?: Record<string, string>;
}

/**
 * Cost Forecast
 */
export interface CostForecast {
  readonly dimension: CostDimension;
  readonly dimensionValue: string;
  readonly currentPeriodCost: number;
  readonly forecastedCost: number;
  readonly previousPeriodCost: number;
  readonly changePercentage: number;
  readonly confidence: number;
  readonly period: 'daily' | 'weekly' | 'monthly';
  readonly generatedAt: string;
}

/**
 * Optimization Recommendation
 */
export interface OptimizationRecommendation {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly resourceId?: string;
  readonly category: 'rightsizing' | 'scheduling' | 'reserved_capacity' | 'architecture' | 'cleanup';
  readonly title: string;
  readonly description: string;
  readonly estimatedSavings: number;
  readonly savingsCurrency: string;
  readonly effort: 'low' | 'medium' | 'high';
  readonly risk: 'low' | 'medium' | 'high';
  readonly implementationSteps: readonly string[];
  readonly autoImplementable: boolean;
  readonly status: 'new' | 'accepted' | 'rejected' | 'implemented';
}

/**
 * Budget Configuration
 */
export interface Budget {
  readonly id: string;
  readonly name: string;
  readonly amount: number;
  readonly currency: string;
  readonly period: 'monthly' | 'quarterly' | 'annual';
  readonly alertThresholds: readonly number[]; // Percentages
  readonly dimension: CostDimension;
  readonly dimensionValue: string;
  readonly currentSpend: number;
  readonly forecastedSpend: number;
}

/**
 * Resource Monitor Manager
 */
export class ResourceMonitorManager {
  private metrics: Map<string, ResourceMetric[]> = new Map();
  private thresholds: ResourceThreshold[] = [];
  private alerts: Map<string, ResourceAlert> = new Map();
  private listeners: ((alert: ResourceAlert) => void)[] = [];

  /**
   * Set thresholds for monitoring
   */
  setThresholds(thresholds: ResourceThreshold[]): void {
    this.thresholds = thresholds;
  }

  /**
   * Record a metric
   */
  recordMetric(metric: ResourceMetric): void {
    const key = `${metric.resourceType}:${metric.resourceId}`;
    const existing = this.metrics.get(key) ?? [];
    
    // Keep last 1000 metrics per resource
    if (existing.length >= 1000) {
      existing.shift();
    }
    existing.push(metric);
    this.metrics.set(key, existing);

    // Check thresholds
    this.checkThresholds(metric);
  }

  /**
   * Check metric against thresholds
   */
  private checkThresholds(metric: ResourceMetric): void {
    const applicableThresholds = this.thresholds.filter(
      t => t.resourceType === metric.resourceType && t.metric === metric.name
    );

    for (const threshold of applicableThresholds) {
      const exceeded = this.isThresholdExceeded(metric.value, threshold);
      const status = this.determineStatus(metric.value, threshold);
      
      if (exceeded) {
        const alertId = `${metric.resourceType}:${metric.resourceId}:${metric.name}`;
        const existingAlert = this.alerts.get(alertId);

        if (!existingAlert || existingAlert.resolvedAt) {
          const alert: ResourceAlert = {
            id: alertId,
            resourceType: metric.resourceType,
            resourceId: metric.resourceId,
            metric: metric.name,
            value: metric.value,
            threshold: status === ResourceStatus.CRITICAL 
              ? threshold.criticalThreshold 
              : threshold.warningThreshold,
            status,
            triggeredAt: new Date().toISOString(),
            acknowledged: false,
          };
          this.alerts.set(alertId, alert);
          this.notifyListeners(alert);
        }
      } else {
        // Resolve existing alert
        const alertId = `${metric.resourceType}:${metric.resourceId}:${metric.name}`;
        const existingAlert = this.alerts.get(alertId);
        if (existingAlert && !existingAlert.resolvedAt) {
          this.alerts.set(alertId, {
            ...existingAlert,
            resolvedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  private isThresholdExceeded(value: number, threshold: ResourceThreshold): boolean {
    switch (threshold.comparison) {
      case 'gt':
        return value > threshold.warningThreshold;
      case 'gte':
        return value >= threshold.warningThreshold;
      case 'lt':
        return value < threshold.warningThreshold;
      case 'lte':
        return value <= threshold.warningThreshold;
    }
  }

  private determineStatus(value: number, threshold: ResourceThreshold): ResourceStatus {
    const criticalExceeded = (() => {
      switch (threshold.comparison) {
        case 'gt':
          return value > threshold.criticalThreshold;
        case 'gte':
          return value >= threshold.criticalThreshold;
        case 'lt':
          return value < threshold.criticalThreshold;
        case 'lte':
          return value <= threshold.criticalThreshold;
      }
    })();

    return criticalExceeded ? ResourceStatus.CRITICAL : ResourceStatus.WARNING;
  }

  /**
   * Get current metrics for a resource
   */
  getMetrics(resourceType: ResourceType, resourceId: string, limit: number = 100): ResourceMetric[] {
    const key = `${resourceType}:${resourceId}`;
    const metrics = this.metrics.get(key) ?? [];
    return metrics.slice(-limit);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): ResourceAlert[] {
    return Array.from(this.alerts.values()).filter(a => !a.resolvedAt);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, userId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    this.alerts.set(alertId, {
      ...alert,
      acknowledged: true,
      acknowledgedBy: userId,
    });
    return true;
  }

  /**
   * Add alert listener
   */
  addAlertListener(listener: (alert: ResourceAlert) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(alert: ResourceAlert): void {
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get resource health summary
   */
  getHealthSummary(): Record<ResourceType, { status: ResourceStatus; alertCount: number }> {
    const summary: Record<string, { status: ResourceStatus; alertCount: number }> = {};
    
    for (const resourceType of Object.values(ResourceType)) {
      const alerts = Array.from(this.alerts.values()).filter(
        a => a.resourceType === resourceType && !a.resolvedAt
      );
      
      let status: ResourceStatus = ResourceStatus.HEALTHY;
      if (alerts.some(a => a.status === ResourceStatus.CRITICAL)) {
        status = ResourceStatus.CRITICAL;
      } else if (alerts.length > 0) {
        status = ResourceStatus.WARNING;
      }
      
      summary[resourceType] = { status, alertCount: alerts.length };
    }
    
    return summary as Record<ResourceType, { status: ResourceStatus; alertCount: number }>;
  }
}

/**
 * Cost Manager for FinOps
 */
export class CostManager {
  private costs: CostRecord[] = [];
  private budgets: Map<string, Budget> = new Map();
  private recommendations: Map<string, OptimizationRecommendation> = new Map();

  /**
   * Record a cost
   */
  recordCost(cost: CostRecord): void {
    this.costs.push(cost);
  }

  /**
   * Get costs by dimension
   */
  getCostsByDimension(
    dimension: CostDimension,
    startDate: string,
    endDate: string
  ): Map<string, number> {
    const result = new Map<string, number>();
    
    for (const cost of this.costs) {
      if (cost.periodStart >= startDate && cost.periodEnd <= endDate) {
        const key = cost.allocation[dimension];
        if (key) {
          result.set(key, (result.get(key) ?? 0) + cost.amount);
        }
      }
    }
    
    return result;
  }

  /**
   * Get tenant cost breakdown
   */
  getTenantCostBreakdown(tenantId: string, period: { start: string; end: string }): {
    total: number;
    byResource: Map<ResourceType, number>;
    topResources: Array<{ resourceId: string; type: ResourceType; cost: number }>;
  } {
    const tenantCosts = this.costs.filter(
      c => c.allocation[CostDimension.TENANT] === tenantId &&
           c.periodStart >= period.start &&
           c.periodEnd <= period.end
    );

    const byResource = new Map<ResourceType, number>();
    const resourceCosts = new Map<string, { type: ResourceType; cost: number }>();

    let total = 0;
    for (const cost of tenantCosts) {
      total += cost.amount;
      byResource.set(
        cost.resourceType,
        (byResource.get(cost.resourceType) ?? 0) + cost.amount
      );
      
      const existing = resourceCosts.get(cost.resourceId);
      if (existing) {
        existing.cost += cost.amount;
      } else {
        resourceCosts.set(cost.resourceId, { type: cost.resourceType, cost: cost.amount });
      }
    }

    const topResources = Array.from(resourceCosts.entries())
      .map(([resourceId, data]) => ({ resourceId, ...data }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return { total, byResource, topResources };
  }

  /**
   * Create a budget
   */
  createBudget(budget: Omit<Budget, 'currentSpend' | 'forecastedSpend'>): Budget {
    const fullBudget: Budget = {
      ...budget,
      currentSpend: 0,
      forecastedSpend: 0,
    };
    this.budgets.set(budget.id, fullBudget);
    return fullBudget;
  }

  /**
   * Update budget spend tracking
   */
  updateBudgetSpend(budgetId: string): Budget | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) return null;

    const now = new Date();
    const periodStart = this.getPeriodStart(now, budget.period);
    const periodEnd = this.getPeriodEnd(now, budget.period);

    // Calculate current spend
    const costs = this.costs.filter(
      c => c.allocation[budget.dimension] === budget.dimensionValue &&
           c.periodStart >= periodStart.toISOString() &&
           c.periodEnd <= periodEnd.toISOString()
    );
    const currentSpend = costs.reduce((sum, c) => sum + c.amount, 0);

    // Simple linear forecast
    const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
    const daysElapsed = Math.ceil((now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
    const dailyRate = daysElapsed > 0 ? currentSpend / daysElapsed : 0;
    const forecastedSpend = dailyRate * daysInPeriod;

    const updated: Budget = {
      ...budget,
      currentSpend,
      forecastedSpend,
    };
    this.budgets.set(budgetId, updated);
    return updated;
  }

  private getPeriodStart(date: Date, period: Budget['period']): Date {
    const start = new Date(date);
    switch (period) {
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'quarterly':
        start.setMonth(Math.floor(start.getMonth() / 3) * 3);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'annual':
        start.setMonth(0);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
    }
    return start;
  }

  private getPeriodEnd(date: Date, period: Budget['period']): Date {
    const end = new Date(this.getPeriodStart(date, period));
    switch (period) {
      case 'monthly':
        end.setMonth(end.getMonth() + 1);
        break;
      case 'quarterly':
        end.setMonth(end.getMonth() + 3);
        break;
      case 'annual':
        end.setFullYear(end.getFullYear() + 1);
        break;
    }
    return end;
  }

  /**
   * Get budgets with alerts
   */
  getBudgetsWithAlerts(): Array<Budget & { alertLevel: number | null }> {
    return Array.from(this.budgets.values()).map(budget => {
      const percentUsed = (budget.currentSpend / budget.amount) * 100;
      const alertLevel = budget.alertThresholds
        .filter(t => percentUsed >= t)
        .sort((a, b) => b - a)[0] ?? null;
      
      return { ...budget, alertLevel };
    });
  }

  /**
   * Add optimization recommendation
   */
  addRecommendation(recommendation: OptimizationRecommendation): void {
    this.recommendations.set(recommendation.id, recommendation);
  }

  /**
   * Get recommendations by category
   */
  getRecommendations(category?: OptimizationRecommendation['category']): OptimizationRecommendation[] {
    const all = Array.from(this.recommendations.values());
    if (!category) return all;
    return all.filter(r => r.category === category);
  }

  /**
   * Calculate total potential savings
   */
  getTotalPotentialSavings(): number {
    return Array.from(this.recommendations.values())
      .filter(r => r.status === 'new' || r.status === 'accepted')
      .reduce((sum, r) => sum + r.estimatedSavings, 0);
  }

  /**
   * Generate cost report
   */
  generateCostReport(period: { start: string; end: string }): {
    totalCost: number;
    byResourceType: Record<ResourceType, number>;
    byDimension: Record<CostDimension, Map<string, number>>;
    topTenants: Array<{ tenantId: string; cost: number }>;
    recommendations: OptimizationRecommendation[];
    budgetStatus: Array<Budget & { alertLevel: number | null }>;
  } {
    const periodCosts = this.costs.filter(
      c => c.periodStart >= period.start && c.periodEnd <= period.end
    );

    const byResourceType: Partial<Record<ResourceType, number>> = {};
    const byDimension: Partial<Record<CostDimension, Map<string, number>>> = {};
    let totalCost = 0;

    for (const cost of periodCosts) {
      totalCost += cost.amount;
      byResourceType[cost.resourceType] = (byResourceType[cost.resourceType] ?? 0) + cost.amount;

      for (const [dim, value] of Object.entries(cost.allocation) as [CostDimension, string][]) {
        if (!byDimension[dim]) {
          byDimension[dim] = new Map();
        }
        byDimension[dim]!.set(value, (byDimension[dim]!.get(value) ?? 0) + cost.amount);
      }
    }

    const tenantCosts = byDimension[CostDimension.TENANT] ?? new Map();
    const topTenants = Array.from(tenantCosts.entries())
      .map(([tenantId, cost]) => ({ tenantId, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return {
      totalCost,
      byResourceType: byResourceType as Record<ResourceType, number>,
      byDimension: byDimension as Record<CostDimension, Map<string, number>>,
      topTenants,
      recommendations: this.getRecommendations().filter(r => r.status === 'new'),
      budgetStatus: this.getBudgetsWithAlerts(),
    };
  }
}

/**
 * Default resource thresholds
 */
export const DefaultResourceThresholds: ResourceThreshold[] = [
  {
    resourceType: ResourceType.COMPUTE,
    metric: 'cpu_utilization',
    warningThreshold: 70,
    criticalThreshold: 90,
    comparison: 'gt',
  },
  {
    resourceType: ResourceType.MEMORY,
    metric: 'memory_utilization',
    warningThreshold: 75,
    criticalThreshold: 90,
    comparison: 'gt',
  },
  {
    resourceType: ResourceType.STORAGE,
    metric: 'disk_utilization',
    warningThreshold: 80,
    criticalThreshold: 95,
    comparison: 'gt',
  },
  {
    resourceType: ResourceType.DATABASE,
    metric: 'connection_utilization',
    warningThreshold: 70,
    criticalThreshold: 85,
    comparison: 'gt',
  },
  {
    resourceType: ResourceType.DATABASE,
    metric: 'query_latency_p99',
    warningThreshold: 100, // ms
    criticalThreshold: 500,
    comparison: 'gt',
  },
  {
    resourceType: ResourceType.CACHE,
    metric: 'hit_rate',
    warningThreshold: 80,
    criticalThreshold: 60,
    comparison: 'lt',
  },
  {
    resourceType: ResourceType.NETWORK,
    metric: 'bandwidth_utilization',
    warningThreshold: 70,
    criticalThreshold: 90,
    comparison: 'gt',
  },
];
