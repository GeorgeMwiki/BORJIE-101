/**
 * Consistency-validator tests — Wave 28.
 *
 * Covers taboo hard-fail, register drift, pace bounds, and the
 * code-switch-out-of-context detector.
 */

import { describe, it, expect } from 'vitest';
import {
  HEAD_PROFILE,
  OWNER_PROFILE,
  TENANT_PROFILE,
  REGULATOR_PROFILE,
  VENDOR_PROFILE,
} from '../profiles.js';
import { scorePersonaFit } from '../consistency-validator.js';

describe('voice-persona-dna — scorePersonaFit', () => {
  it('returns 1.0 on a clean professional output matching the head profile', () => {
    const output =
      'Good morning. Here is today\'s portfolio briefing. Occupancy held at ninety-one percent across all estates.';
    const report = scorePersonaFit(output, HEAD_PROFILE);
    expect(report.score).toBe(1);
    expect(report.violations.length).toBe(0);
  });

  it('hard-fails to 0 when a taboo phrase appears', () => {
    const output =
      'That\'s not my problem — read the lease and pay up.';
    const report = scorePersonaFit(output, TENANT_PROFILE);
    expect(report.score).toBe(0);
    expect(report.violations.some((v) => v.kind === 'taboo_used')).toBe(true);
  });

  it('flags colloquial markers when regulator expects literary register', () => {
    const output =
      'Hey there! Pursuant to your letter, kindly find the filings attached.';
    const report = scorePersonaFit(output, REGULATOR_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'register_too_casual'),
    ).toBe(true);
    expect(report.score).toBeLessThan(1);
  });

  it('accepts genuine literary register for the regulator', () => {
    const output =
      'Dear Commissioner, Pursuant to the filings herein, the aforementioned returns are respectfully submitted for your review. Sincerely, The Head of Estates.';
    const report = scorePersonaFit(output, REGULATOR_PROFILE);
    expect(report.score).toBe(1);
  });

  it('flags formal bloat for a conversational tenant-facing output', () => {
    const output =
      'Furthermore, pursuant to the aforementioned notice, herein lies the scheduling window.';
    const report = scorePersonaFit(output, TENANT_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'register_too_formal'),
    ).toBe(true);
  });

  it('flags outputs that are far longer than the persona pace window', () => {
    const long = 'word '.repeat(400).trim();
    const report = scorePersonaFit(long, VENDOR_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'pace_output_too_long'),
    ).toBe(true);
  });

  it('flags outputs that are too short for the persona pace window', () => {
    const report = scorePersonaFit('ok.', HEAD_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'pace_output_too_short'),
    ).toBe(true);
  });

  it('produces human-readable suggestions for any violation', () => {
    const output = 'hey buddy, whatever';
    const report = scorePersonaFit(output, REGULATOR_PROFILE);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it('permits code-switching for profiles that allow it', () => {
    // Owner profile allows sw-KE inserts; Swahili rapport is NOT a violation.
    const output = 'Habari! Update ya property yako iko tayari kwa leo.';
    const report = scorePersonaFit(output, OWNER_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'code_switch_out_of_context'),
    ).toBe(false);
  });

  it('flags non-Latin script when persona has no code-switching rules', () => {
    // Vendor profile has no codeSwitching — Arabic tokens must flag.
    const output = 'Hello vendor. شكرا لك على العمل.';
    const report = scorePersonaFit(output, VENDOR_PROFILE);
    expect(
      report.violations.some((v) => v.kind === 'code_switch_out_of_context'),
    ).toBe(true);
  });

  it('score is clamped into [0, 1] even when severities sum above 1', () => {
    const output =
      'hey yo, dude — furthermore, pursuant to the aforementioned, gonna wrap this up. word '.repeat(
        200,
      );
    const report = scorePersonaFit(output, REGULATOR_PROFILE);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
  });
});
