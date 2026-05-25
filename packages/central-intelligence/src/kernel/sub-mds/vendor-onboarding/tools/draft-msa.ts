/**
 * `vendor.draft_msa` — DRAFT-only.
 *
 * Produces a master service agreement draft. The owner signs via the
 * e-signature flow; this sub-MD never signs for the owner.
 */

import type { CapabilityTag } from './classify-capabilities.js';

export interface DraftMsaArgs {
  readonly vendorId: string;
  readonly vendorLegalName: string;
  readonly ownerLegalName: string;
  readonly jurisdiction: 'KE' | 'TZ' | 'UG' | 'OTHER';
  readonly capabilityTags: ReadonlyArray<CapabilityTag>;
  readonly serviceAreas: ReadonlyArray<string>;
  readonly emergencyAvailable: boolean;
  readonly paymentTermsDays: number;
  readonly slaHoursPerUrgency?: Readonly<Record<'emergency' | 'high' | 'medium' | 'low', number>>;
  readonly language: 'en' | 'sw' | 'mixed';
}

export interface DraftedMsa {
  readonly vendorId: string;
  readonly version: '1.0';
  readonly jurisdiction: DraftMsaArgs['jurisdiction'];
  readonly title: string;
  readonly body: string;
  readonly clauses: ReadonlyArray<string>;
  readonly draftStatus: 'queued-for-owner-signature';
  readonly nextStepGuidance: string;
}

const DEFAULT_SLA = Object.freeze({ emergency: 2, high: 12, medium: 48, low: 168 });

export function draftMsa(args: DraftMsaArgs): DraftedMsa {
  const sla = args.slaHoursPerUrgency ?? DEFAULT_SLA;
  const sw = args.language === 'sw';
  const title = sw
    ? `Mkataba mkuu wa huduma — ${args.vendorLegalName}`
    : `Master Service Agreement — ${args.vendorLegalName}`;

  const clauses = buildClauses({ ...args, sla, sw });
  const body = renderBody({
    ownerName: args.ownerLegalName,
    vendorName: args.vendorLegalName,
    jurisdiction: args.jurisdiction,
    clauses,
    sw,
  });

  return Object.freeze({
    vendorId: args.vendorId,
    version: '1.0',
    jurisdiction: args.jurisdiction,
    title,
    body,
    clauses: Object.freeze(clauses),
    draftStatus: 'queued-for-owner-signature',
    nextStepGuidance:
      'Owner reviews and signs via e-sig. The sub-MD does NOT sign on the owner\'s behalf. Once signed, vendor.setup_payment_rail may run.',
  });
}

function buildClauses(args: {
  readonly capabilityTags: ReadonlyArray<CapabilityTag>;
  readonly serviceAreas: ReadonlyArray<string>;
  readonly emergencyAvailable: boolean;
  readonly paymentTermsDays: number;
  readonly sla: Readonly<Record<'emergency' | 'high' | 'medium' | 'low', number>>;
  readonly jurisdiction: 'KE' | 'TZ' | 'UG' | 'OTHER';
  readonly sw: boolean;
}): string[] {
  const c: string[] = [];
  if (args.sw) {
    c.push(`1. Huduma: ${args.capabilityTags.join(', ') || 'haijabainishwa'}`);
    c.push(`2. Maeneo: ${args.serviceAreas.join(', ') || 'haijabainishwa'}`);
    c.push(`3. Dharura: ${args.emergencyAvailable ? 'ndiyo' : 'hapana'}`);
    c.push(`4. Muda wa kujibu (saa): dharura ${args.sla.emergency}, juu ${args.sla.high}, kati ${args.sla.medium}, chini ${args.sla.low}`);
    c.push(`5. Malipo: siku ${args.paymentTermsDays} baada ya kazi kukamilika`);
    c.push(`6. Sheria inayotumika: ${jurisdictionLawNameSw(args.jurisdiction)}`);
    c.push(`7. Kusitisha: pande zote zinaweza kusitisha kwa taarifa ya siku 30`);
    c.push(`8. Bima: muuzaji anahitajika kuwa na bima ya umma`);
    c.push(`9. Faragha: data ya wapangaji haitatumika nje ya kazi husika`);
    c.push(`10. Mzozo: usuluhishi katika ${jurisdictionVenueNameSw(args.jurisdiction)}`);
  } else {
    c.push(`1. Services: ${args.capabilityTags.join(', ') || 'unspecified'}`);
    c.push(`2. Service areas: ${args.serviceAreas.join(', ') || 'unspecified'}`);
    c.push(`3. Emergency on-call: ${args.emergencyAvailable ? 'yes' : 'no'}`);
    c.push(`4. SLA response (hours): emergency ${args.sla.emergency}, high ${args.sla.high}, medium ${args.sla.medium}, low ${args.sla.low}`);
    c.push(`5. Payment terms: ${args.paymentTermsDays} days after job completion`);
    c.push(`6. Governing law: ${jurisdictionLawName(args.jurisdiction)}`);
    c.push(`7. Termination: either party may terminate on 30-day notice`);
    c.push(`8. Insurance: vendor must maintain public-liability insurance`);
    c.push(`9. Privacy: tenant data shall not be used outside scope-of-work`);
    c.push(`10. Disputes: arbitration in ${jurisdictionVenueName(args.jurisdiction)}`);
  }
  return c;
}

function renderBody(args: {
  readonly ownerName: string;
  readonly vendorName: string;
  readonly jurisdiction: 'KE' | 'TZ' | 'UG' | 'OTHER';
  readonly clauses: ReadonlyArray<string>;
  readonly sw: boolean;
}): string {
  const lines: string[] = [];
  if (args.sw) {
    lines.push(`Mkataba huu (rasimu) ni kati ya ${args.ownerName} ("Mmiliki") na ${args.vendorName} ("Muuzaji"), kwa mujibu wa sheria za ${jurisdictionLawNameSw(args.jurisdiction)}.`);
  } else {
    lines.push(`This DRAFT Master Service Agreement is between ${args.ownerName} ("Owner") and ${args.vendorName} ("Vendor"), governed by ${jurisdictionLawName(args.jurisdiction)}.`);
  }
  lines.push('');
  for (const c of args.clauses) lines.push(c);
  lines.push('');
  lines.push(args.sw ? 'Sahihi (mmiliki): _______________' : 'Owner signature: _______________');
  lines.push(args.sw ? 'Sahihi (muuzaji): _______________' : 'Vendor signature: _______________');
  return lines.join('\n');
}

function jurisdictionLawName(j: 'KE' | 'TZ' | 'UG' | 'OTHER'): string {
  if (j === 'KE') return 'Kenya — Contracts Act, Cap 23';
  if (j === 'TZ') return 'Tanzania — Law of Contract Act, Cap 345';
  if (j === 'UG') return 'Uganda — Contracts Act, 2010';
  return 'governing-law-tbd';
}

function jurisdictionLawNameSw(j: 'KE' | 'TZ' | 'UG' | 'OTHER'): string {
  if (j === 'TZ') return 'Tanzania — Sheria ya Mikataba, Sura ya 345';
  return jurisdictionLawName(j);
}

function jurisdictionVenueName(j: 'KE' | 'TZ' | 'UG' | 'OTHER'): string {
  if (j === 'KE') return 'Nairobi';
  if (j === 'TZ') return 'Dar es Salaam';
  if (j === 'UG') return 'Kampala';
  return 'venue-tbd';
}

function jurisdictionVenueNameSw(j: 'KE' | 'TZ' | 'UG' | 'OTHER'): string {
  return jurisdictionVenueName(j);
}
