/**
 * Waitlist types.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

export type WaitlistId = string & { readonly __brand: 'WaitlistId' };
export type WaitlistOutreachEventId = string & {
  readonly __brand: 'WaitlistOutreachEventId';
};

export const asWaitlistId = (s: string): WaitlistId => s as WaitlistId;
export const asWaitlistOutreachEventId = (
  s: string
): WaitlistOutreachEventId => s as WaitlistOutreachEventId;

export type WaitlistStatus =
  | 'active'
  | 'converted'
  | 'expired'
  | 'opted_out';

export type WaitlistSource =
  | 'enquiry'
  | 'failed_application'
  | 'manual_add'
  | 'marketplace_save'
  | 'ai_recommended';

export type WaitlistChannel =
  | 'sms'
  | 'whatsapp'
  | 'email'
  | 'push'
  | 'in_app';

export type WaitlistOutreachEventType =
  | 'vacancy_notified'
  | 'viewed'
  | 'applied'
  | 'declined'
  | 'opted_out'
  | 'delivery_failed';

export interface UnitWaitlistEntry {
  readonly id: WaitlistId;
  readonly tenantId: TenantId;
  readonly unitId: string | null;
  readonly listingId: string | null;
  readonly customerId: string;
  readonly priority: number;
  readonly source: WaitlistSource;
  readonly status: WaitlistStatus;
  readonly notificationPreferenceId: string | null;
  readonly preferredChannels: ReadonlyArray<WaitlistChannel>;
  readonly createdAt: ISOTimestamp;
  readonly expiresAt: ISOTimestamp | null;
  readonly convertedAt: ISOTimestamp | null;
  readonly optedOutAt: ISOTimestamp | null;
  readonly optOutReason: string | null;
  readonly lastNotifiedAt: ISOTimestamp | null;
  readonly notificationCount: number;
  readonly updatedAt: ISOTimestamp;
}

export interface WaitlistOutreachEvent {
  readonly id: WaitlistOutreachEventId;
  readonly tenantId: TenantId;
  readonly waitlistId: WaitlistId;
  readonly eventType: WaitlistOutreachEventType;
  readonly channel: WaitlistChannel;
  readonly messagePayload: Record<string, unknown>;
  readonly correlationId: string | null;
  readonly occurredAt: ISOTimestamp;
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

// ============================================================================
// Inputs
// ============================================================================

export interface JoinWaitlistInput {
  readonly unitId?: string | null;
  readonly listingId?: string | null;
  readonly customerId: string;
  readonly priority?: number;
  readonly source?: WaitlistSource;
  readonly preferredChannels?: ReadonlyArray<WaitlistChannel>;
  readonly notificationPreferenceId?: string;
  readonly expiresAt?: ISOTimestamp;
}

export interface LeaveWaitlistInput {
  readonly waitlistId: WaitlistId;
  readonly reason?: string;
}

// ============================================================================
// Repository
// ============================================================================

export interface WaitlistRepository {
  findById(
    id: WaitlistId,
    tenantId: TenantId
  ): Promise<UnitWaitlistEntry | null>;
  findActiveForCustomerUnit(
    tenantId: TenantId,
    unitId: string,
    customerId: string
  ): Promise<UnitWaitlistEntry | null>;
  create(entry: UnitWaitlistEntry): Promise<UnitWaitlistEntry>;
  update(
    id: WaitlistId,
    tenantId: TenantId,
    patch: Partial<UnitWaitlistEntry>
  ): Promise<UnitWaitlistEntry>;
  listActiveForUnit(
    tenantId: TenantId,
    unitId: string
  ): Promise<ReadonlyArray<UnitWaitlistEntry>>;
  listForCustomer(
    tenantId: TenantId,
    customerId: string
  ): Promise<ReadonlyArray<UnitWaitlistEntry>>;
}

export interface WaitlistOutreachRepository {
  append(event: WaitlistOutreachEvent): Promise<WaitlistOutreachEvent>;
  listByWaitlist(
    waitlistId: WaitlistId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<WaitlistOutreachEvent>>;
}

// ============================================================================
// Errors
// ============================================================================

export class WaitlistServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'DUPLICATE'
      | 'VALIDATION'
      | 'ALREADY_CLOSED'
  ) {
    super(message);
    this.name = 'WaitlistServiceError';
  }
}
