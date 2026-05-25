/**
 * Tenant Preference Profile domain model
 * Customer preferences and communication settings for AI personalization
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';
import { ChannelPreference, ChannelPreferenceSchema } from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type TenantPreferenceProfileId = Brand<string, 'TenantPreferenceProfileId'>;

export function asTenantPreferenceProfileId(id: string): TenantPreferenceProfileId {
  return id as TenantPreferenceProfileId;
}

// ============================================================================
// Nested Types
// ============================================================================

/** Household details */
export interface HouseholdDetails {
  readonly numberOfAdults: number;
  readonly numberOfChildren: number;
  readonly childrenAges: readonly number[];
  readonly hasPets: boolean;
  readonly petTypes: readonly string[];
  readonly specialNeeds: readonly string[];
}

export const HouseholdDetailsSchema = z.object({
  numberOfAdults: z.number().default(1),
  numberOfChildren: z.number().default(0),
  childrenAges: z.array(z.number()).default([]),
  hasPets: z.boolean().default(false),
  petTypes: z.array(z.string()).default([]),
  specialNeeds: z.array(z.string()).default([]),
});

/** Parking needs */
export interface ParkingNeeds {
  readonly numberOfVehicles: number;
  readonly vehicleTypes: readonly string[];
  readonly coveredParkingPreferred: boolean;
}

export const ParkingNeedsSchema = z.object({
  numberOfVehicles: z.number().default(0),
  vehicleTypes: z.array(z.string()).default([]),
  coveredParkingPreferred: z.boolean().default(false),
});

// ============================================================================
// Zod Schema
// ============================================================================

export const TenantPreferenceProfileSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),

  // Communication preferences
  preferredChannel: ChannelPreferenceSchema,
  secondaryChannel: ChannelPreferenceSchema.nullable(),
  preferredLanguage: z.string().default('en'),

  // Timing
  preferredContactTime: z.string().nullable(),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  // Timezone defaults to UTC until the caller supplies the tenant's
  // `tenant.defaultTimezone` (resolve via getRegionConfig(tenant.countryCode)).
  timezone: z.string().default('UTC'),

  // Notifications
  paymentReminders: z.boolean().default(true),
  maintenanceUpdates: z.boolean().default(true),
  communityNews: z.boolean().default(true),
  marketingMessages: z.boolean().default(false),
  emergencyAlerts: z.boolean().default(true),

  // Frequency
  reminderFrequency: z.enum(['minimal', 'standard', 'frequent']).default('standard'),
  messageFormat: z.enum(['brief', 'standard', 'detailed']).default('standard'),
  receiptFormat: z.enum(['digital', 'print', 'both']).default('digital'),

  // Accessibility
  accessibilityNeeds: z.array(z.string()).default([]),
  largeText: z.boolean().default(false),
  voiceAssistance: z.boolean().default(false),

  // Household
  householdSize: z.number().nullable(),
  hasChildren: z.boolean().nullable(),
  hasPets: z.boolean().nullable(),
  householdDetails: HouseholdDetailsSchema.nullable(),

  // Lifestyle
  workSchedule: z.string().nullable(),
  parkingNeeds: ParkingNeedsSchema.nullable(),
  amenityPreferences: z.array(z.string()).default([]),

  // Consent
  dataProcessingConsent: z.boolean().default(false),
  dataProcessingConsentAt: z.string().datetime().nullable(),
  testimonialConsent: z.boolean().default(false),
  testimonialConsentAt: z.string().datetime().nullable(),

  version: z.number().default(1),
});

export type TenantPreferenceProfileData = z.infer<typeof TenantPreferenceProfileSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface TenantPreferenceProfile extends EntityMetadata {
  readonly id: TenantPreferenceProfileId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;

  // Communication preferences
  readonly preferredChannel: ChannelPreference;
  readonly secondaryChannel: ChannelPreference | null;
  readonly preferredLanguage: string;

  // Timing
  readonly preferredContactTime: string | null;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly timezone: string;

  // Notifications
  readonly paymentReminders: boolean;
  readonly maintenanceUpdates: boolean;
  readonly communityNews: boolean;
  readonly marketingMessages: boolean;
  readonly emergencyAlerts: boolean;

  // Frequency
  readonly reminderFrequency: 'minimal' | 'standard' | 'frequent';
  readonly messageFormat: 'brief' | 'standard' | 'detailed';
  readonly receiptFormat: 'digital' | 'print' | 'both';

  // Accessibility
  readonly accessibilityNeeds: readonly string[];
  readonly largeText: boolean;
  readonly voiceAssistance: boolean;

  // Household
  readonly householdSize: number | null;
  readonly hasChildren: boolean | null;
  readonly hasPets: boolean | null;
  readonly householdDetails: HouseholdDetails | null;

  // Lifestyle
  readonly workSchedule: string | null;
  readonly parkingNeeds: ParkingNeeds | null;
  readonly amenityPreferences: readonly string[];

  // Consent
  readonly dataProcessingConsent: boolean;
  readonly dataProcessingConsentAt: ISOTimestamp | null;
  readonly testimonialConsent: boolean;
  readonly testimonialConsentAt: ISOTimestamp | null;

  readonly version: number;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createTenantPreferenceProfile(
  id: TenantPreferenceProfileId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    preferredChannel?: ChannelPreference;
    preferredLanguage?: string;
  },
  createdBy: UserId
): TenantPreferenceProfile {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,

    preferredChannel: data.preferredChannel ?? 'whatsapp',
    secondaryChannel: null,
    preferredLanguage: data.preferredLanguage ?? 'en',

    preferredContactTime: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    // Follow-up KI-005 (Docs/TODO_BACKLOG.md): populate from tenant.defaultTimezone — see
    //   packages/domain-models/src/common/region-config.ts. UTC is the
    //   neutral fallback; callers should override via `data.timezone`.
    //   See Docs/KNOWN_ISSUES.md#ki-005.
    timezone: 'UTC',

    paymentReminders: true,
    maintenanceUpdates: true,
    communityNews: true,
    marketingMessages: false,
    emergencyAlerts: true,

    reminderFrequency: 'standard',
    messageFormat: 'standard',
    receiptFormat: 'digital',

    accessibilityNeeds: [],
    largeText: false,
    voiceAssistance: false,

    householdSize: null,
    hasChildren: null,
    hasPets: null,
    householdDetails: null,

    workSchedule: null,
    parkingNeeds: null,
    amenityPreferences: [],

    dataProcessingConsent: false,
    dataProcessingConsentAt: null,
    testimonialConsent: false,
    testimonialConsentAt: null,

    version: 1,

    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function updateCommunicationPreferences(
  profile: TenantPreferenceProfile,
  preferences: {
    preferredChannel?: ChannelPreference;
    secondaryChannel?: ChannelPreference | null;
    preferredLanguage?: string;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    preferredContactTime?: string | null;
  },
  updatedBy: UserId
): TenantPreferenceProfile {
  const now = new Date().toISOString();
  return {
    ...profile,
    preferredChannel: preferences.preferredChannel ?? profile.preferredChannel,
    secondaryChannel: preferences.secondaryChannel !== undefined ? preferences.secondaryChannel : profile.secondaryChannel,
    preferredLanguage: preferences.preferredLanguage ?? profile.preferredLanguage,
    quietHoursStart: preferences.quietHoursStart !== undefined ? preferences.quietHoursStart : profile.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd !== undefined ? preferences.quietHoursEnd : profile.quietHoursEnd,
    preferredContactTime: preferences.preferredContactTime !== undefined ? preferences.preferredContactTime : profile.preferredContactTime,
    version: profile.version + 1,
    updatedAt: now,
    updatedBy,
  };
}

export function updateNotificationPreferences(
  profile: TenantPreferenceProfile,
  preferences: {
    paymentReminders?: boolean;
    maintenanceUpdates?: boolean;
    communityNews?: boolean;
    marketingMessages?: boolean;
    emergencyAlerts?: boolean;
  },
  updatedBy: UserId
): TenantPreferenceProfile {
  const now = new Date().toISOString();
  return {
    ...profile,
    paymentReminders: preferences.paymentReminders ?? profile.paymentReminders,
    maintenanceUpdates: preferences.maintenanceUpdates ?? profile.maintenanceUpdates,
    communityNews: preferences.communityNews ?? profile.communityNews,
    marketingMessages: preferences.marketingMessages ?? profile.marketingMessages,
    emergencyAlerts: preferences.emergencyAlerts ?? profile.emergencyAlerts,
    version: profile.version + 1,
    updatedAt: now,
    updatedBy,
  };
}

export function recordDataProcessingConsent(
  profile: TenantPreferenceProfile,
  consent: boolean,
  updatedBy: UserId
): TenantPreferenceProfile {
  const now = new Date().toISOString();
  return {
    ...profile,
    dataProcessingConsent: consent,
    dataProcessingConsentAt: consent ? now : null,
    version: profile.version + 1,
    updatedAt: now,
    updatedBy,
  };
}

export function isInQuietHours(profile: TenantPreferenceProfile): boolean {
  if (!profile.quietHoursStart || !profile.quietHoursEnd) return false;

  const now = new Date();
  const [sH, sM] = profile.quietHoursStart.split(':').map(Number);
  const [eH, eM] = profile.quietHoursEnd.split(':').map(Number);
  const startHour = sH ?? 0;
  const startMin = sM ?? 0;
  const endHour = eH ?? 0;
  const endMin = eM ?? 0;

  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTime = currentHour * 60 + currentMin;
  const startTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

export function shouldSendNotification(
  profile: TenantPreferenceProfile,
  notificationType: 'payment' | 'maintenance' | 'community' | 'marketing' | 'emergency'
): boolean {
  // Emergency always gets through
  if (notificationType === 'emergency') return profile.emergencyAlerts;

  // Check quiet hours for non-emergency
  if (isInQuietHours(profile)) return false;

  switch (notificationType) {
    case 'payment':
      return profile.paymentReminders;
    case 'maintenance':
      return profile.maintenanceUpdates;
    case 'community':
      return profile.communityNews;
    case 'marketing':
      return profile.marketingMessages;
    default:
      return true;
  }
}
