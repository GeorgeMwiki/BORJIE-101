/**
 * Validation Schemas
 * 
 * Centralized Zod schemas for request validation across the BORJIE API Gateway.
 * Provides reusable validators for common data types and patterns.
 */

import { z } from 'zod';

// ============================================================================
// Primitive Validators
// ============================================================================

/**
 * Phone number in E.164 format.
 *
 * Generic — accepts any well-formed international number. Use this for
 * any user-input boundary that is NOT explicitly scoped to a single
 * country. For per-country validation, prefer
 * `buildPhoneSchemaForCountry(code)` from
 * `@borjie/domain-models/common/region-config`.
 */
export const phoneNumberSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format. Use E.164 (leading +, 8-15 digits).');

/**
 * Strict E.164 — leading `+` required, no national-format fallback.
 *
 * Use this on production routes that MUST receive a fully-qualified
 * international number (e.g. webhook callback registrations, third-
 * party API integrations). For lighter validation on UI-facing user
 * input, `phoneNumberSchema` (above) is more forgiving.
 */
export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number. Use full E.164 (leading +, 7-15 digits).');

/**
 * @deprecated TZ-only — kept for backwards compatibility with any
 * legacy import sites. New code MUST use `phoneNumberSchema` (generic
 * E.164) or `buildPhoneSchemaForCountry()` for per-region validation.
 * BORJIE is built for the world; pinning a user-input boundary to
 * TZ blocks every other jurisdiction.
 */
export const tanzanianPhoneSchemaLegacyTZOnly = z
  .string()
  .regex(/^\+255[67]\d{8}$/, 'Invalid Tanzanian phone number. Use format +255XXXXXXXXX');

/**
 * @deprecated alias preserved for source-import compatibility. New
 * imports should use `tanzanianPhoneSchemaLegacyTZOnly` (explicit
 * scope) or, preferably, the generic schemas above.
 */
export const tanzanianPhoneSchema = tanzanianPhoneSchemaLegacyTZOnly;

/**
 * Email address
 */
export const emailSchema = z
  .string()
  .email('Invalid email address')
  .max(255, 'Email too long')
  .toLowerCase();

/**
 * Password with security requirements
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character');

/**
 * UUID v4
 */
export const uuidSchema = z
  .string()
  .uuid('Invalid ID format');

/**
 * ISO 8601 date string
 */
export const isoDateSchema = z
  .string()
  .datetime({ message: 'Invalid date format. Use ISO 8601 format' });

/**
 * Date string (YYYY-MM-DD)
 */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Use YYYY-MM-DD');

/**
 * Currency amount (positive number with max 2 decimal places)
 */
export const amountSchema = z
  .number()
  .positive('Amount must be positive')
  .multipleOf(0.01, 'Amount can have at most 2 decimal places');

/**
 * Percentage (0-100)
 */
export const percentageSchema = z
  .number()
  .min(0, 'Percentage cannot be negative')
  .max(100, 'Percentage cannot exceed 100');

// ============================================================================
// Common Object Schemas
// ============================================================================

/**
 * Pagination parameters
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Date range filter
 */
const dateRangeShape = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});
export const dateRangeSchema = dateRangeShape.refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

/**
 * Sort parameters
 */
export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

/**
 * Address
 */
export const addressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().min(2).max(100).default('Tanzania'),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
});

/**
 * Contact information
 */
export const contactSchema = z.object({
  name: z.string().min(1).max(100),
  phone: phoneNumberSchema,
  email: emailSchema.optional(),
  isPrimary: z.boolean().default(false),
});

/**
 * Money/Currency
 */
export const moneySchema = z.object({
  amount: amountSchema,
  // No default currency — client supplies this from tenant region-config.
  // The enum is a validation allow-list of currencies the platform
  // supports; adding a new country extends this list via region-config.
  currency: z.enum(['TZS', 'USD', 'KES', 'UGX', 'RWF', 'EUR', 'GBP']),
});

// ============================================================================
// Entity Schemas
// ============================================================================

/**
 * User profile update
 */
export const userProfileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: phoneNumberSchema.optional(),
  email: emailSchema.optional(),
  locale: z.enum(['en', 'sw']).optional(),
  timezone: z.string().max(50).optional(),
  notificationPreferences: z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    push: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  }).optional(),
});

/**
 * Property creation
 */
export const createPropertySchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(['residential', 'commercial', 'mixed', 'industrial']),
  address: addressSchema,
  totalUnits: z.number().int().positive(),
  amenities: z.array(z.string()).optional(),
  description: z.string().max(2000).optional(),
  managerId: uuidSchema.optional(),
  photos: z.array(z.string().url()).optional(),
});

/**
 * Unit creation
 */
export const createUnitSchema = z.object({
  propertyId: uuidSchema,
  unitNumber: z.string().min(1).max(50),
  type: z.enum(['studio', '1br', '2br', '3br', '4br', 'penthouse', 'office', 'retail', 'warehouse']),
  floor: z.number().int().min(-5).max(200),
  area: z.object({
    value: z.number().positive(),
    unit: z.enum(['sqm', 'sqft']).default('sqm'),
  }),
  bedrooms: z.number().int().min(0).max(10).optional(),
  bathrooms: z.number().min(0).max(10).optional(),
  rent: moneySchema,
  deposit: moneySchema.optional(),
  amenities: z.array(z.string()).optional(),
  isAvailable: z.boolean().default(true),
});

/**
 * Customer/Tenant creation
 */
export const createCustomerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: emailSchema,
  phone: phoneNumberSchema,
  alternativePhone: phoneNumberSchema.optional(),
  idType: z.enum(['national_id', 'passport', 'drivers_license', 'voter_id']),
  idNumber: z.string().min(4).max(50),
  dateOfBirth: dateStringSchema.optional(),
  nationality: z.string().max(100).optional(),
  occupation: z.string().max(200).optional(),
  employer: z.string().max(200).optional(),
  monthlyIncome: moneySchema.optional(),
  emergencyContact: contactSchema.optional(),
  address: addressSchema.optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Lease creation
 */
export const createLeaseSchema = z.object({
  unitId: uuidSchema,
  customerId: uuidSchema,
  type: z.enum(['fixed_term', 'month_to_month', 'commercial']),
  startDate: dateStringSchema,
  endDate: dateStringSchema.optional(),
  rentAmount: moneySchema,
  depositAmount: moneySchema,
  paymentDueDay: z.number().int().min(1).max(28).default(1),
  gracePeriodDays: z.number().int().min(0).max(30).default(5),
  lateFeeType: z.enum(['fixed', 'percentage']).default('percentage'),
  lateFeeValue: z.number().positive().default(5),
  terms: z.string().max(10000).optional(),
  specialConditions: z.array(z.string()).optional(),
}).refine(
  (data) => {
    if (data.endDate) {
      return new Date(data.startDate) < new Date(data.endDate);
    }
    return true;
  },
  { message: 'Lease start date must be before end date' }
);

/**
 * Work order creation
 */
export const createWorkOrderSchema = z.object({
  unitId: uuidSchema.optional(),
  propertyId: uuidSchema,
  customerId: uuidSchema.optional(),
  category: z.enum([
    'plumbing',
    'electrical',
    'appliance',
    'hvac',
    'structural',
    'pest_control',
    'security',
    'cleaning',
    'landscaping',
    'other',
  ]),
  priority: z.enum(['emergency', 'high', 'medium', 'low']),
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  location: z.string().max(200).optional(),
  attachments: z.array(z.object({
    type: z.enum(['image', 'video', 'document']),
    url: z.string().url(),
    description: z.string().max(200).optional(),
  })).max(10).optional(),
  requiresEntry: z.boolean().default(true),
  entryInstructions: z.string().max(500).optional(),
  permissionToEnter: z.boolean().default(false),
  preferredSchedule: z.object({
    dates: z.array(dateStringSchema).max(5).optional(),
    timePreference: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
  }).optional(),
});

/**
 * Payment initiation
 */
export const initiatePaymentSchema = z.object({
  invoiceId: uuidSchema.optional(),
  leaseId: uuidSchema.optional(),
  amount: moneySchema,
  paymentMethod: z.enum(['mpesa', 'bank_transfer', 'card', 'cash', 'cheque']),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
}).refine(
  (data) => data.invoiceId || data.leaseId,
  { message: 'Either invoiceId or leaseId is required' }
);

/**
 * Invoice creation
 */
export const createInvoiceSchema = z.object({
  customerId: uuidSchema,
  leaseId: uuidSchema,
  type: z.enum(['rent', 'utility', 'maintenance', 'deposit', 'fee', 'other']),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(200),
    quantity: z.number().positive().default(1),
    unitPrice: moneySchema,
  })).min(1).max(20),
  dueDate: dateStringSchema,
  notes: z.string().max(1000).optional(),
  isRecurring: z.boolean().default(false),
});

/**
 * Communication/Message
 */
export const sendMessageSchema = z.object({
  recipientId: uuidSchema,
  recipientType: z.enum(['customer', 'user', 'vendor']),
  channel: z.enum(['sms', 'whatsapp', 'email', 'in_app']),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
  attachments: z.array(z.object({
    type: z.enum(['document', 'image']),
    url: z.string().url(),
    name: z.string().max(100),
  })).max(5).optional(),
});

/**
 * Feedback/Survey response
 */
export const feedbackSchema = z.object({
  type: z.enum(['maintenance', 'general', 'onboarding', 'check_in', 'nps']),
  workOrderId: uuidSchema.optional(),
  rating: z.number().int().min(1).max(5),
  categories: z.array(z.enum([
    'response_time',
    'quality',
    'communication',
    'professionalism',
    'value',
    'cleanliness',
  ])).optional(),
  comment: z.string().max(2000).optional(),
  wouldRecommend: z.boolean().optional(),
});

// ============================================================================
// Filter Schemas
// ============================================================================

/**
 * Property filter
 */
export const propertyFilterSchema = paginationSchema.merge(sortSchema).extend({
  type: z.enum(['all', 'residential', 'commercial', 'mixed', 'industrial']).optional(),
  status: z.enum(['all', 'active', 'inactive']).optional(),
  search: z.string().max(100).optional(),
});

/**
 * Unit filter
 */
export const unitFilterSchema = paginationSchema.merge(sortSchema).extend({
  propertyId: uuidSchema.optional(),
  type: z.string().optional(),
  status: z.enum(['all', 'available', 'occupied', 'maintenance', 'reserved']).optional(),
  minRent: z.coerce.number().positive().optional(),
  maxRent: z.coerce.number().positive().optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
});

/**
 * Work order filter
 */
export const workOrderFilterSchema = paginationSchema.merge(sortSchema).merge(dateRangeShape).extend({
  propertyId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  vendorId: uuidSchema.optional(),
  status: z.enum([
    'all',
    'submitted',
    'triaged',
    'pending_approval',
    'approved',
    'assigned',
    'scheduled',
    'in_progress',
    'pending_verification',
    'completed',
    'cancelled',
  ]).optional(),
  priority: z.enum(['all', 'emergency', 'high', 'medium', 'low']).optional(),
  category: z.string().optional(),
  assignedToMe: z.coerce.boolean().optional(),
});

/**
 * Payment/Transaction filter
 */
export const paymentFilterSchema = paginationSchema.merge(sortSchema).merge(dateRangeShape).extend({
  customerId: uuidSchema.optional(),
  propertyId: uuidSchema.optional(),
  status: z.enum(['all', 'pending', 'processing', 'completed', 'failed', 'refunded']).optional(),
  method: z.enum(['all', 'mpesa', 'bank_transfer', 'card', 'cash', 'cheque']).optional(),
  type: z.enum(['all', 'rent', 'utility', 'maintenance', 'deposit', 'fee', 'other']).optional(),
  minAmount: z.coerce.number().positive().optional(),
  maxAmount: z.coerce.number().positive().optional(),
});

/**
 * Customer filter
 */
export const customerFilterSchema = paginationSchema.merge(sortSchema).extend({
  propertyId: uuidSchema.optional(),
  status: z.enum(['all', 'active', 'inactive', 'pending', 'former']).optional(),
  search: z.string().max(100).optional(),
  hasArrears: z.coerce.boolean().optional(),
  leaseExpiringSoon: z.coerce.boolean().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a schema for array IDs
 */
export function arrayOfIds(maxItems = 100) {
  return z.array(uuidSchema).max(maxItems);
}

/**
 * Create a schema for optional fields that should be set to null if empty
 */
export function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((val) => val === '' ? null : val);
}

/**
 * Create a string schema that trims whitespace
 */
export function trimmedString(min = 1, max = 255) {
  return z.string().min(min).max(max).transform((s) => s.trim());
}

// ============================================================================
// Type Exports
// ============================================================================

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Money = z.infer<typeof moneySchema>;
export type CreateProperty = z.infer<typeof createPropertySchema>;
export type CreateUnit = z.infer<typeof createUnitSchema>;
export type CreateCustomer = z.infer<typeof createCustomerSchema>;
export type CreateLease = z.infer<typeof createLeaseSchema>;
export type CreateWorkOrder = z.infer<typeof createWorkOrderSchema>;
export type InitiatePayment = z.infer<typeof initiatePaymentSchema>;
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
