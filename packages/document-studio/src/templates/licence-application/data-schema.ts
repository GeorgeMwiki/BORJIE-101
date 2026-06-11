/**
 * Mining Licence Application — data schema.
 *
 * Tumemadini (Tume ya Madini — Mining Commission of Tanzania) submission
 * for a Primary Mining Licence (PML) or Prospecting Licence (PL) under
 * the Mining Act, 2010 and the Mining (Mineral Rights) Regulations.
 *
 * Raw request shape validated by Zod before any render. The builder
 * derives totals + pre-formats every monetary figure via the project
 * `formatCurrency` convention (see ../../format.ts) and injects a
 * single-language label set (EN/SW absolute toggle — no mixing).
 *
 * This is a MINING document class. (Borjie is a mining-estate OS; the
 * old property-domain eviction-notice templates were deleted.)
 */

import { z } from 'zod';
import { CitationSchema } from '../../types.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');
const Iso4217 = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 currency code');

/** Absolute locale toggle — the whole document renders in exactly one. */
export const LocaleSchema = z.enum(['en', 'sw']);
export type DocLocale = z.infer<typeof LocaleSchema>;

/** PML = Primary Mining Licence · PL = Prospecting Licence. */
export const LicenceTypeSchema = z.enum(['PML', 'PL']);

export const ApplicantSchema = z.object({
  name: z.string().min(1),
  applicantType: z.enum(['individual', 'company']),
  /** National ID (individual) or TIN; PML is reserved for Tanzanian citizens. */
  nationalIdOrTin: z.string().min(1),
  nationality: z.string().min(1),
  address: z.string().min(1),
  /** Required when applicantType === 'company'. */
  companyRegNo: z.string().optional(),
});

/** A cadastral boundary beacon — mineral rights are defined by coordinates. */
export const BeaconSchema = z.object({
  beaconNo: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const LicenceSoughtSchema = z.object({
  type: LicenceTypeSchema,
  primaryMineral: z.string().min(1),
  otherMinerals: z.array(z.string().min(1)).optional(),
  areaHectares: z.number().positive(),
  durationYears: z.number().int().positive(),
  region: z.string().min(1),
  district: z.string().min(1),
  ward: z.string().optional(),
  localityDescription: z.string().min(1),
});

export const WorkProgrammeSchema = z.object({
  summary: z.string().min(1),
  /** Planned investment over the licence term, in the document currency. */
  proposedExpenditure: z.number().nonnegative(),
  equipment: z.array(z.string().min(1)).optional(),
  estimatedJobs: z.number().int().nonnegative().optional(),
});

export const FeesSchema = z.object({
  applicationFee: z.number().nonnegative(),
  /** Annual rent per hectare; builder multiplies by areaHectares. */
  annualRentPerHectare: z.number().nonnegative(),
  preparationFee: z.number().nonnegative().optional(),
});

export const SubmissionSchema = z.object({
  referenceNo: z.string().min(1),
  dateSubmitted: IsoDate,
  submittedBy: z.string().min(1),
});

export const LicenceApplicationDataSchema = z.object({
  /** Absolute language toggle for the whole document. */
  locale: LocaleSchema,
  /** ISO-4217 currency for ALL monetary figures. Never inferred. */
  currencyCode: Iso4217,
  applicant: ApplicantSchema,
  licence: LicenceSoughtSchema,
  /** A licence area polygon needs at least three boundary beacons. */
  beacons: z.array(BeaconSchema).min(3),
  workProgramme: WorkProgrammeSchema,
  fees: FeesSchema,
  submission: SubmissionSchema,
  citations: z.array(CitationSchema).default([]),
});

export type LicenceApplicationData = z.infer<typeof LicenceApplicationDataSchema>;
