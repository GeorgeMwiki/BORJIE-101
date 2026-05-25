/**
 * Partner API Gateway
 * 
 * Implements partner/developer API management with:
 * - API key management and rotation
 * - Scope-based access control
 * - Usage tracking and quotas
 * - API versioning support
 * - Developer portal integration
 */

import { z } from 'zod';

/**
 * API Key Status
 */
export const ApiKeyStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;

export type ApiKeyStatus = typeof ApiKeyStatus[keyof typeof ApiKeyStatus];

/**
 * API Scope Categories
 */
export const ApiScopeCategory = {
  READ: 'read',
  WRITE: 'write',
  DELETE: 'delete',
  ADMIN: 'admin',
} as const;

export type ApiScopeCategory = typeof ApiScopeCategory[keyof typeof ApiScopeCategory];

/**
 * Partner Tier
 */
export const PartnerTier = {
  DEVELOPER: 'DEVELOPER',     // Free tier, limited access
  STANDARD: 'STANDARD',       // Paid tier, standard limits
  PROFESSIONAL: 'PROFESSIONAL', // Higher limits, priority support
  ENTERPRISE: 'ENTERPRISE',   // Custom limits, SLA
} as const;

export type PartnerTier = typeof PartnerTier[keyof typeof PartnerTier];

/**
 * API Scope Definition
 */
export interface ApiScope {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ApiScopeCategory;
  readonly resources: readonly string[];
  readonly actions: readonly string[];
  readonly requiredTier: PartnerTier;
}

/**
 * Partner Application
 */
export interface PartnerApplication {
  readonly id: string;
  readonly partnerId: string;
  readonly name: string;
  readonly description: string;
  readonly websiteUrl?: string;
  readonly callbackUrls: readonly string[];
  readonly tier: PartnerTier;
  readonly scopes: readonly string[];
  readonly status: 'pending' | 'approved' | 'rejected' | 'suspended';
  readonly createdAt: string;
  readonly approvedAt?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * API Key
 */
export interface ApiKey {
  readonly id: string;
  readonly applicationId: string;
  readonly tenantId?: string;           // For tenant-specific keys
  readonly keyPrefix: string;           // First 8 chars for identification
  readonly keyHash: string;             // SHA-256 hash of full key
  readonly name: string;
  readonly scopes: readonly string[];
  readonly status: ApiKeyStatus;
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly usageCount: number;
  readonly createdAt: string;
  readonly rotatedAt?: string;
  readonly revokedAt?: string;
  readonly ipAllowlist?: readonly string[];
  readonly rateLimit?: {
    readonly requestsPerMinute: number;
    readonly requestsPerDay: number;
  };
}

/**
 * API Usage Record
 */
export interface ApiUsageRecord {
  readonly id: string;
  readonly apiKeyId: string;
  readonly applicationId: string;
  readonly endpoint: string;
  readonly method: string;
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly timestamp: string;
  readonly requestSize: number;
  readonly responseSize: number;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly errorCode?: string;
}

/**
 * Usage Quota
 */
export interface UsageQuota {
  readonly applicationId: string;
  readonly period: 'minute' | 'hour' | 'day' | 'month';
  readonly limit: number;
  readonly used: number;
  readonly resetAt: string;
}

/**
 * API Version
 */
export interface ApiVersion {
  readonly version: string;             // e.g., 'v1', 'v2'
  readonly status: 'current' | 'deprecated' | 'sunset';
  readonly releasedAt: string;
  readonly deprecatedAt?: string;
  readonly sunsetAt?: string;
  readonly changelog?: string;
  readonly breaking: boolean;
}

/**
 * Default scopes for the platform
 */
export const DefaultApiScopes: ApiScope[] = [
  // Property scopes
  {
    id: 'properties:read',
    name: 'Read Properties',
    description: 'Read property and unit information',
    category: ApiScopeCategory.READ,
    resources: ['properties', 'units'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.DEVELOPER,
  },
  {
    id: 'properties:write',
    name: 'Write Properties',
    description: 'Create and update property information',
    category: ApiScopeCategory.WRITE,
    resources: ['properties', 'units'],
    actions: ['create', 'update'],
    requiredTier: PartnerTier.STANDARD,
  },

  // Lease scopes
  {
    id: 'leases:read',
    name: 'Read Leases',
    description: 'Read lease information',
    category: ApiScopeCategory.READ,
    resources: ['leases'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.DEVELOPER,
  },
  {
    id: 'leases:write',
    name: 'Write Leases',
    description: 'Create and update leases',
    category: ApiScopeCategory.WRITE,
    resources: ['leases'],
    actions: ['create', 'update'],
    requiredTier: PartnerTier.STANDARD,
  },

  // Payment scopes
  {
    id: 'payments:read',
    name: 'Read Payments',
    description: 'Read payment and invoice information',
    category: ApiScopeCategory.READ,
    resources: ['payments', 'invoices'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.STANDARD,
  },
  {
    id: 'payments:write',
    name: 'Write Payments',
    description: 'Process payments and create invoices',
    category: ApiScopeCategory.WRITE,
    resources: ['payments', 'invoices'],
    actions: ['create'],
    requiredTier: PartnerTier.PROFESSIONAL,
  },

  // Maintenance scopes
  {
    id: 'maintenance:read',
    name: 'Read Maintenance',
    description: 'Read work orders and maintenance requests',
    category: ApiScopeCategory.READ,
    resources: ['work_orders', 'maintenance_requests'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.DEVELOPER,
  },
  {
    id: 'maintenance:write',
    name: 'Write Maintenance',
    description: 'Create and update work orders',
    category: ApiScopeCategory.WRITE,
    resources: ['work_orders', 'maintenance_requests'],
    actions: ['create', 'update'],
    requiredTier: PartnerTier.STANDARD,
  },

  // Tenant/Customer scopes
  {
    id: 'customers:read',
    name: 'Read Customers',
    description: 'Read tenant/customer information',
    category: ApiScopeCategory.READ,
    resources: ['customers', 'tenants'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.STANDARD,
  },
  {
    id: 'customers:write',
    name: 'Write Customers',
    description: 'Create and update customer records',
    category: ApiScopeCategory.WRITE,
    resources: ['customers', 'tenants'],
    actions: ['create', 'update'],
    requiredTier: PartnerTier.PROFESSIONAL,
  },

  // Analytics scopes
  {
    id: 'analytics:read',
    name: 'Read Analytics',
    description: 'Access analytics and reporting data',
    category: ApiScopeCategory.READ,
    resources: ['analytics', 'reports'],
    actions: ['list', 'get'],
    requiredTier: PartnerTier.PROFESSIONAL,
  },

  // Webhooks scopes
  {
    id: 'webhooks:manage',
    name: 'Manage Webhooks',
    description: 'Create and manage webhook subscriptions',
    category: ApiScopeCategory.WRITE,
    resources: ['webhooks'],
    actions: ['create', 'update', 'delete', 'list'],
    requiredTier: PartnerTier.STANDARD,
  },
];

/**
 * Tier rate limits
 */
export const TierRateLimits: Record<PartnerTier, { requestsPerMinute: number; requestsPerDay: number }> = {
  [PartnerTier.DEVELOPER]: { requestsPerMinute: 60, requestsPerDay: 1000 },
  [PartnerTier.STANDARD]: { requestsPerMinute: 300, requestsPerDay: 10000 },
  [PartnerTier.PROFESSIONAL]: { requestsPerMinute: 1000, requestsPerDay: 100000 },
  [PartnerTier.ENTERPRISE]: { requestsPerMinute: 5000, requestsPerDay: 1000000 },
};

/**
 * Partner API Manager
 */
export class PartnerApiManager {
  private applications: Map<string, PartnerApplication> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private usageRecords: ApiUsageRecord[] = [];
  private quotas: Map<string, UsageQuota[]> = new Map();
  private scopes: Map<string, ApiScope> = new Map();
  private versions: Map<string, ApiVersion> = new Map();

  constructor() {
    // Initialize default scopes
    for (const scope of DefaultApiScopes) {
      this.scopes.set(scope.id, scope);
    }
  }

  /**
   * Register a partner application
   */
  registerApplication(app: Omit<PartnerApplication, 'id' | 'createdAt' | 'status'>): PartnerApplication {
    const id = crypto.randomUUID();
    const application: PartnerApplication = {
      ...app,
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.applications.set(id, application);
    return application;
  }

  /**
   * Approve an application
   */
  approveApplication(applicationId: string): PartnerApplication | null {
    const app = this.applications.get(applicationId);
    if (!app || app.status !== 'pending') return null;

    const approved: PartnerApplication = {
      ...app,
      status: 'approved',
      approvedAt: new Date().toISOString(),
    };
    this.applications.set(applicationId, approved);
    
    // Initialize quotas for the application
    this.initializeQuotas(applicationId, app.tier);
    
    return approved;
  }

  /**
   * Create an API key for an application
   */
  async createApiKey(
    applicationId: string,
    name: string,
    scopes: string[],
    options?: {
      expiresAt?: string;
      ipAllowlist?: string[];
      tenantId?: string;
    }
  ): Promise<{ key: ApiKey; plainTextKey: string } | null> {
    const app = this.applications.get(applicationId);
    if (!app || app.status !== 'approved') return null;

    // Validate scopes
    const validScopes = scopes.filter(s => {
      const scope = this.scopes.get(s);
      return scope && this.tierCanAccessScope(app.tier, scope.requiredTier);
    });

    // Generate key
    const keyBytes = new Uint8Array(32);
    crypto.getRandomValues(keyBytes);
    const plainTextKey = 'bny_' + Array.from(keyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const keyPrefix = plainTextKey.slice(0, 12);
    const keyHash = await this.hashKey(plainTextKey);

    const tierLimits = TierRateLimits[app.tier];
    
    const apiKey: ApiKey = {
      id: crypto.randomUUID(),
      applicationId,
      tenantId: options?.tenantId,
      keyPrefix,
      keyHash,
      name,
      scopes: validScopes,
      status: ApiKeyStatus.ACTIVE,
      expiresAt: options?.expiresAt,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      ipAllowlist: options?.ipAllowlist,
      rateLimit: tierLimits,
    };

    this.apiKeys.set(apiKey.id, apiKey);
    return { key: apiKey, plainTextKey };
  }

  /**
   * Validate an API key
   */
  async validateApiKey(plainTextKey: string): Promise<{
    valid: boolean;
    key?: ApiKey;
    application?: PartnerApplication;
    error?: string;
  }> {
    if (!plainTextKey.startsWith('bny_')) {
      return { valid: false, error: 'Invalid key format' };
    }

    const keyHash = await this.hashKey(plainTextKey);
    const key = Array.from(this.apiKeys.values()).find(k => k.keyHash === keyHash);

    if (!key) {
      return { valid: false, error: 'Key not found' };
    }

    if (key.status !== ApiKeyStatus.ACTIVE) {
      return { valid: false, error: `Key is ${key.status.toLowerCase()}` };
    }

    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      // Mark as expired
      this.apiKeys.set(key.id, { ...key, status: ApiKeyStatus.EXPIRED });
      return { valid: false, error: 'Key has expired' };
    }

    const application = this.applications.get(key.applicationId);
    if (!application || application.status !== 'approved') {
      return { valid: false, error: 'Application not active' };
    }

    return { valid: true, key, application };
  }

  /**
   * Check if key has required scope
   */
  hasScope(key: ApiKey, requiredScope: string): boolean {
    return key.scopes.includes(requiredScope);
  }

  /**
   * Rotate an API key
   */
  async rotateApiKey(keyId: string): Promise<{ key: ApiKey; plainTextKey: string } | null> {
    const oldKey = this.apiKeys.get(keyId);
    if (!oldKey) return null;

    // Create new key with same settings
    const result = await this.createApiKey(
      oldKey.applicationId,
      oldKey.name,
      [...oldKey.scopes],
      {
        expiresAt: oldKey.expiresAt,
        ipAllowlist: oldKey.ipAllowlist ? [...oldKey.ipAllowlist] : undefined,
        tenantId: oldKey.tenantId,
      }
    );

    if (!result) return null;

    // Mark old key as rotated (keep active briefly for transition)
    this.apiKeys.set(keyId, {
      ...oldKey,
      rotatedAt: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Revoke an API key
   */
  revokeApiKey(keyId: string): boolean {
    const key = this.apiKeys.get(keyId);
    if (!key) return false;

    this.apiKeys.set(keyId, {
      ...key,
      status: ApiKeyStatus.REVOKED,
      revokedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * Record API usage
   */
  recordUsage(record: Omit<ApiUsageRecord, 'id'>): void {
    const fullRecord: ApiUsageRecord = {
      ...record,
      id: crypto.randomUUID(),
    };
    this.usageRecords.push(fullRecord);

    // Update key usage count
    const key = this.apiKeys.get(record.apiKeyId);
    if (key) {
      this.apiKeys.set(key.id, {
        ...key,
        usageCount: key.usageCount + 1,
        lastUsedAt: record.timestamp,
      });
    }

    // Update quotas
    this.updateQuotaUsage(record.applicationId);
  }

  /**
   * Initialize quotas for an application
   */
  private initializeQuotas(applicationId: string, tier: PartnerTier): void {
    const limits = TierRateLimits[tier];
    const now = new Date();

    const quotas: UsageQuota[] = [
      {
        applicationId,
        period: 'minute',
        limit: limits.requestsPerMinute,
        used: 0,
        resetAt: new Date(now.getTime() + 60000).toISOString(),
      },
      {
        applicationId,
        period: 'day',
        limit: limits.requestsPerDay,
        used: 0,
        resetAt: new Date(now.setHours(24, 0, 0, 0)).toISOString(),
      },
    ];

    this.quotas.set(applicationId, quotas);
  }

  /**
   * Update quota usage
   */
  private updateQuotaUsage(applicationId: string): void {
    const quotas = this.quotas.get(applicationId);
    if (!quotas) return;

    const now = new Date();
    const updated = quotas.map(q => {
      // Reset if period has passed
      if (new Date(q.resetAt) < now) {
        const resetAt = this.calculateNextReset(now, q.period);
        return { ...q, used: 1, resetAt: resetAt.toISOString() };
      }
      return { ...q, used: q.used + 1 };
    });

    this.quotas.set(applicationId, updated);
  }

  private calculateNextReset(now: Date, period: UsageQuota['period']): Date {
    const reset = new Date(now);
    switch (period) {
      case 'minute':
        reset.setTime(reset.getTime() + 60000);
        break;
      case 'hour':
        reset.setTime(reset.getTime() + 3600000);
        break;
      case 'day':
        reset.setHours(24, 0, 0, 0);
        break;
      case 'month':
        reset.setMonth(reset.getMonth() + 1, 1);
        reset.setHours(0, 0, 0, 0);
        break;
    }
    return reset;
  }

  /**
   * Check quota
   */
  checkQuota(applicationId: string): { allowed: boolean; quotas: UsageQuota[] } {
    const quotas = this.quotas.get(applicationId) ?? [];
    const now = new Date();

    // Check each quota
    for (const quota of quotas) {
      // Skip if reset time has passed (will be reset on next usage)
      if (new Date(quota.resetAt) < now) continue;
      
      if (quota.used >= quota.limit) {
        return { allowed: false, quotas };
      }
    }

    return { allowed: true, quotas };
  }

  /**
   * Get usage statistics for an application
   */
  getUsageStats(
    applicationId: string,
    period: { start: string; end: string }
  ): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgLatencyMs: number;
    byEndpoint: Map<string, number>;
    byStatusCode: Map<number, number>;
  } {
    const records = this.usageRecords.filter(
      r => r.applicationId === applicationId &&
           r.timestamp >= period.start &&
           r.timestamp <= period.end
    );

    const successful = records.filter(r => r.statusCode >= 200 && r.statusCode < 300);
    const byEndpoint = new Map<string, number>();
    const byStatusCode = new Map<number, number>();
    let totalLatency = 0;

    for (const record of records) {
      byEndpoint.set(record.endpoint, (byEndpoint.get(record.endpoint) ?? 0) + 1);
      byStatusCode.set(record.statusCode, (byStatusCode.get(record.statusCode) ?? 0) + 1);
      totalLatency += record.latencyMs;
    }

    return {
      totalRequests: records.length,
      successfulRequests: successful.length,
      failedRequests: records.length - successful.length,
      avgLatencyMs: records.length > 0 ? Math.round(totalLatency / records.length) : 0,
      byEndpoint,
      byStatusCode,
    };
  }

  /**
   * Register an API version
   */
  registerVersion(version: ApiVersion): void {
    this.versions.set(version.version, version);
  }

  /**
   * Get current API version
   */
  getCurrentVersion(): ApiVersion | undefined {
    return Array.from(this.versions.values()).find(v => v.status === 'current');
  }

  /**
   * Check if tier can access scope
   */
  private tierCanAccessScope(appTier: PartnerTier, requiredTier: PartnerTier): boolean {
    const tierOrder = [
      PartnerTier.DEVELOPER,
      PartnerTier.STANDARD,
      PartnerTier.PROFESSIONAL,
      PartnerTier.ENTERPRISE,
    ];
    return tierOrder.indexOf(appTier) >= tierOrder.indexOf(requiredTier);
  }

  /**
   * Hash an API key
   */
  private async hashKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

/**
 * Zod schemas for API validation
 */
export const PartnerApplicationSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(1000),
  websiteUrl: z.string().url().optional(),
  callbackUrls: z.array(z.string().url()).min(1),
  scopes: z.array(z.string()).min(1),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(),
  ipAllowlist: z.array(z.string().ip()).optional(),
});
