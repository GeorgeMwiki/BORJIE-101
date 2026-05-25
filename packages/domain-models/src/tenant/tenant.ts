/**
 * Tenant (Organization) domain model
 * Core multi-tenancy entity
 */

import { getRegionConfig } from '../common/region-config';
import type {
  TenantId,
  OrganizationId,
  UserId,
  EntityMetadata,
  SoftDeletable,
  ISOTimestamp,
} from '../common/types';

/** Tenant status */
export type TenantStatus = 'active' | 'suspended' | 'pending_setup' | 'churned';

/** Subscription tier */
export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';

/** Billing cycle */
export type BillingCycle = 'monthly' | 'quarterly' | 'annual';

/** Validates tenant slug format (URL-safe, 3-50 chars, lowercase alphanumeric and hyphens) */
export function isValidTenantSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  return slug.length >= 3 && slug.length <= 50 && slugRegex.test(slug);
}

/**
 * Tenant entity - represents a property management company using the platform
 */
export interface Tenant extends EntityMetadata, SoftDeletable {
  readonly id: TenantId;
  readonly name: string;
  readonly slug: string; // URL-safe identifier
  readonly status: TenantStatus;
  readonly subscriptionTier: SubscriptionTier;
  readonly billingCycle: BillingCycle;
  readonly settings: TenantSettings;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly logoUrl: string | null;
  readonly timezone: string;
  readonly locale: string;
  readonly trialEndsAt: ISOTimestamp | null;
}

/** Tenant configuration (for services) */
export interface TenantConfig {
  readonly [key: string]: unknown;
}

/** Default tenant configuration */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {};

/** Input for creating a tenant */
export interface CreateTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly contactEmail: string;
}

/** Input for updating a tenant */
export interface UpdateTenantInput {
  readonly name?: string;
  readonly status?: TenantStatus;
  readonly subscriptionTier?: SubscriptionTier;
}

/** Tenant with usage statistics */
export interface TenantWithUsage extends Tenant {
  readonly usage?: {
    readonly userCount: number;
    readonly propertyCount: number;
    readonly unitCount: number;
  };
}

/** Tenant configuration settings */
export interface TenantSettings {
  readonly maxUsers: number;
  readonly maxProperties: number;
  readonly maxUnits: number;
  readonly features: TenantFeatures;
  readonly branding: TenantBranding;
  readonly notifications: NotificationSettings;
}

/** Feature flags for tenant */
export interface TenantFeatures {
  readonly maintenanceModule: boolean;
  readonly paymentsModule: boolean;
  readonly documentsModule: boolean;
  readonly analyticsModule: boolean;
  readonly aiAssistant: boolean;
  readonly customWorkflows: boolean;
  readonly apiAccess: boolean;
  readonly slaTracking: boolean;
}

/** Branding customization */
export interface TenantBranding {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly customDomain: string | null;
}

/** Notification preferences */
export interface NotificationSettings {
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly maintenanceAlerts: boolean;
  readonly paymentReminders: boolean;
  readonly leaseExpiryReminders: boolean;
  readonly reminderDaysBefore: number;
}

/** Create a new tenant */
export function createTenant(
  id: TenantId,
  data: {
    name: string;
    slug: string;
    contactEmail: string;
    /** ISO 3166-1 alpha-2 country code — drives ALL region-adaptive
     *  defaults (currency, timezone, locale, compliance, phone format).
     *  MUST be captured during tenant onboarding. */
    country?: string;
    subscriptionTier?: SubscriptionTier;
    billingCycle?: BillingCycle;
    timezone?: string;
    locale?: string;
  },
  createdBy: UserId
): Tenant {
  const now = new Date().toISOString();
  
  return {
    id,
    name: data.name,
    slug: data.slug,
    status: 'pending_setup',
    subscriptionTier: data.subscriptionTier ?? 'starter',
    billingCycle: data.billingCycle ?? 'monthly',
    contactEmail: data.contactEmail,
    contactPhone: null,
    logoUrl: null,
    // Region-adaptive defaults — resolved from the tenant's country
    // selection via the region-config registry. NO country is hardcoded.
    timezone: data.timezone ?? (data.country ? getRegionConfig(data.country).defaultTimezone : 'UTC'),
    locale: data.locale ?? (data.country ? getRegionConfig(data.country).defaultLocale : 'en'),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 day trial
    settings: getDefaultSettings(data.subscriptionTier ?? 'starter'),
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

function getDefaultSettings(tier: SubscriptionTier): TenantSettings {
  const limits = {
    starter: { users: 5, properties: 10, units: 50 },
    professional: { users: 25, properties: 50, units: 500 },
    enterprise: { users: -1, properties: -1, units: -1 }, // unlimited
  };

  return {
    maxUsers: limits[tier].users,
    maxProperties: limits[tier].properties,
    maxUnits: limits[tier].units,
    features: {
      maintenanceModule: true,
      paymentsModule: true,
      documentsModule: tier !== 'starter',
      analyticsModule: tier !== 'starter',
      aiAssistant: tier === 'enterprise',
      customWorkflows: tier === 'enterprise',
      apiAccess: tier !== 'starter',
      slaTracking: true,
    },
    branding: {
      primaryColor: '#1E40AF',
      secondaryColor: '#3B82F6',
      logoUrl: null,
      faviconUrl: null,
      customDomain: null,
    },
    notifications: {
      emailEnabled: true,
      smsEnabled: tier !== 'starter',
      pushEnabled: true,
      maintenanceAlerts: true,
      paymentReminders: true,
      leaseExpiryReminders: true,
      reminderDaysBefore: 30,
    },
  };
}
