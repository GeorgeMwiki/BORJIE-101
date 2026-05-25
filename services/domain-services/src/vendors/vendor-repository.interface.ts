/**
 * Vendor Repository Interface — SCAFFOLDED 9
 *
 * Narrow contract used by the vendor matcher, the rating worker, and the
 * domain-services vendor module. Intentionally smaller than the full
 * `VendorRepository` in `../vendor/index.ts` — the matcher only needs a
 * read surface plus rating-recompute writes. Separating the two allows
 * the Postgres impl to evolve without cascading through every call site.
 */

export type VendorMatchCategory =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'general'
  | 'cleaning'
  | 'landscaping'
  | 'pest_control'
  | 'security'
  | 'painting'
  | 'roofing'
  | 'other';

export type VendorMatchStatus =
  | 'active'
  | 'inactive'
  | 'probation'
  | 'suspended'
  | 'blacklisted';

export interface VendorRatingsDto {
  overall: number;
  quality: number;
  reliability: number;
  communication: number;
  value: number;
}

export interface VendorMetricsDto {
  completedJobs: number;
  averageResponseTimeHours: number;
  onTimeCompletionPct: number;
  repeatCallRatePct: number;
}

export interface VendorProfileDto {
  id: string;
  tenantId: string;
  vendorCode: string;
  name: string;
  status: VendorMatchStatus;
  categories: VendorMatchCategory[];
  serviceAreas: string[];
  ratings: VendorRatingsDto;
  metrics: VendorMetricsDto;
  isPreferred: boolean;
  emergencyAvailable: boolean;
  afterHoursAvailable: boolean;
  ratingLastComputedAt: Date | null;
  ratingSampleSize: number;
  hourlyRate: number | null;
  currency: string;
}

export interface VendorWorkOrderOutcomeDto {
  workOrderId: string;
  vendorId: string;
  tenantId: string;
  completedAt: Date;
  ratingOverall: number | null;
  ratingQuality: number | null;
  ratingCommunication: number | null;
  firstResponseMinutes: number | null;
  scheduledAt: Date | null;
  actualStartAt: Date | null;
  actualCompletionAt: Date | null;
  costActual: number | null;
  costEstimated: number | null;
  wasReopened: boolean;
}

export interface FindCandidatesParams {
  tenantId: string;
  category: VendorMatchCategory;
  serviceArea?: string;
  emergency?: boolean;
  excludeStatuses?: VendorMatchStatus[];
  limit?: number;
}

export interface VendorRatingUpdate {
  vendorId: string;
  tenantId: string;
  ratings: VendorRatingsDto;
  metrics: VendorMetricsDto;
  sampleSize: number;
  computedAt: Date;
}

export interface VendorRepositoryPort {
  findCandidates(params: FindCandidatesParams): Promise<VendorProfileDto[]>;
  findById(tenantId: string, vendorId: string): Promise<VendorProfileDto | null>;
  findAllActive(tenantId: string): Promise<VendorProfileDto[]>;
  listRecentOutcomes(params: {
    tenantId: string;
    vendorId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VendorWorkOrderOutcomeDto[]>;
  updateRatingAggregate(update: VendorRatingUpdate): Promise<void>;
}
