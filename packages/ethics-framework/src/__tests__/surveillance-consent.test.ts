import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryStore } from '../in-memory-store.js';
import {
  createSurveillanceConsentService,
  SURVEILLANCE_DISCLOSURE_RULES,
  disclosureRuleFor,
} from '../surveillance-consent/index.js';
import type { SurveillanceConsentService } from '../surveillance-consent/index.js';

describe('SURVEILLANCE_DISCLOSURE_RULES — per-jurisdiction coverage', () => {
  it('all 10 device types are mapped for each of TZ/KE/UG/RW/NG/ZA/EU/UK/US/US-CA', () => {
    const jurisdictions = ['TZ', 'KE', 'UG', 'RW', 'NG', 'ZA', 'EU', 'UK', 'US', 'US-CA'] as const;
    for (const j of jurisdictions) {
      const rules = SURVEILLANCE_DISCLOSURE_RULES.filter((r) => r.jurisdiction === j);
      expect(rules.length).toBe(10);
    }
  });

  it('indoor-camera always-on is banned in every jurisdiction', () => {
    const jurisdictions = ['TZ', 'KE', 'UG', 'RW', 'NG', 'ZA', 'EU', 'UK', 'US', 'US-CA'] as const;
    for (const j of jurisdictions) {
      const rule = disclosureRuleFor(j, 'indoor-camera');
      expect(rule?.bannedRecordingPolicies).toContain('always-on');
    }
  });

  it('outdoor-camera does NOT require tenant opt-in (legitimate-interest CCTV)', () => {
    expect(disclosureRuleFor('TZ', 'outdoor-camera')?.requiresTenantOptIn).toBe(false);
    expect(disclosureRuleFor('EU', 'outdoor-camera')?.requiresTenantOptIn).toBe(false);
  });

  it('audio-recorder requires opt-in in US (two-party consent states)', () => {
    expect(disclosureRuleFor('US', 'audio-recorder')?.requiresTenantOptIn).toBe(true);
    expect(disclosureRuleFor('US-CA', 'audio-recorder')?.requiresTenantOptIn).toBe(true);
  });
});

describe('SurveillanceConsentService — register + consent + validate', () => {
  let svc: SurveillanceConsentService;

  beforeEach(() => {
    svc = createSurveillanceConsentService({ store: createInMemoryStore() });
  });

  it('registers device + flags missing consent on validate', async () => {
    await svc.registerSurveillanceDevice({
      deviceId: 'cam-1',
      unitId: 'unit-A',
      type: 'indoor-camera',
      location: 'living-room',
      recordingPolicy: 'event-triggered',
      jurisdiction: 'TZ',
    });
    const status = await svc.validateConsent({
      unitId: 'unit-A',
      tenantId: 'tenant-1',
      jurisdiction: 'TZ',
    });
    expect(status.valid).toBe(false);
    expect(status.missingConsent).toContain('cam-1');
  });

  it('after consent recorded, validate passes', async () => {
    await svc.registerSurveillanceDevice({
      deviceId: 'cam-2',
      unitId: 'unit-B',
      type: 'indoor-camera',
      location: 'kitchen',
      recordingPolicy: 'event-triggered',
      jurisdiction: 'KE',
    });
    await svc.recordConsent({
      tenantId: 'tenant-2',
      deviceId: 'cam-2',
      unitId: 'unit-B',
      granted: true,
      jurisdiction: 'KE',
    });
    const status = await svc.validateConsent({
      unitId: 'unit-B',
      tenantId: 'tenant-2',
      jurisdiction: 'KE',
    });
    expect(status.valid).toBe(true);
    expect(status.missingConsent.length).toBe(0);
  });

  it('tenant change requires fresh consent', async () => {
    await svc.registerSurveillanceDevice({
      deviceId: 'cam-3',
      unitId: 'unit-C',
      type: 'indoor-camera',
      location: 'bedroom',
      recordingPolicy: 'event-triggered',
      jurisdiction: 'EU',
    });
    await svc.recordConsent({
      tenantId: 'tenant-3a',
      deviceId: 'cam-3',
      unitId: 'unit-C',
      granted: true,
      jurisdiction: 'EU',
    });
    // New tenant moves in
    const status = await svc.validateConsent({
      unitId: 'unit-C',
      tenantId: 'tenant-3b',
      jurisdiction: 'EU',
    });
    expect(status.valid).toBe(false);
    expect(status.missingConsent).toContain('cam-3');
  });

  it('refuses to register always-on indoor camera', async () => {
    await expect(
      svc.registerSurveillanceDevice({
        deviceId: 'cam-4',
        unitId: 'unit-D',
        type: 'indoor-camera',
        location: 'bedroom',
        recordingPolicy: 'always-on',
        jurisdiction: 'EU',
      }),
    ).rejects.toThrow('banned');
  });

  it('outdoor-camera does NOT block validate even without consent', async () => {
    await svc.registerSurveillanceDevice({
      deviceId: 'cam-out',
      unitId: 'unit-E',
      type: 'outdoor-camera',
      location: 'driveway',
      recordingPolicy: 'event-triggered',
      jurisdiction: 'TZ',
    });
    const status = await svc.validateConsent({
      unitId: 'unit-E',
      tenantId: 'tenant-5',
      jurisdiction: 'TZ',
    });
    expect(status.valid).toBe(true);
  });

  it('rejects recording consent for device not in supplied unit', async () => {
    await svc.registerSurveillanceDevice({
      deviceId: 'cam-6',
      unitId: 'unit-F',
      type: 'indoor-camera',
      location: 'hall',
      recordingPolicy: 'on-demand',
      jurisdiction: 'TZ',
    });
    await expect(
      svc.recordConsent({
        tenantId: 't',
        deviceId: 'cam-6',
        unitId: 'WRONG-UNIT',
        granted: true,
        jurisdiction: 'TZ',
      }),
    ).rejects.toThrow('not in unit');
  });
});
