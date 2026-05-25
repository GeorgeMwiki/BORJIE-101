/**
 * Surveillance-consent service.
 *
 * Registers cameras/sensors against a unit, then verifies whether a
 * specific tenant has granted consent for each device active in that
 * unit. Consent is per-tenant per-device, so when the tenant changes,
 * fresh consent is required from the new occupier.
 *
 * The disclosure-rule registry per jurisdiction tells us:
 *   - which device types require opt-in
 *   - which recording policies are banned outright
 *
 * If the registered device's policy is banned in the jurisdiction we
 * refuse to register it.
 */

import type {
  EthicsStore,
  Jurisdiction,
  SurveillanceConsent,
  SurveillanceConsentStatus,
  SurveillanceDevice,
  SurveillanceDeviceType,
  RecordingPolicy,
} from '../types.js';
import { disclosureRuleFor } from './disclosure-rules.js';

export interface SurveillanceConsentService {
  registerSurveillanceDevice(args: {
    deviceId: string;
    unitId: string;
    type: SurveillanceDeviceType;
    location: string;
    recordingPolicy: RecordingPolicy;
    jurisdiction: Jurisdiction;
    disclosureUrl?: string;
  }): Promise<SurveillanceDevice>;

  recordConsent(args: {
    tenantId: string;
    deviceId: string;
    unitId: string;
    granted: boolean;
    jurisdiction: Jurisdiction;
  }): Promise<SurveillanceConsent>;

  validateConsent(args: {
    unitId: string;
    tenantId: string;
    jurisdiction: Jurisdiction;
  }): Promise<SurveillanceConsentStatus>;
}

export interface SurveillanceConsentServiceDeps {
  readonly store: EthicsStore;
  readonly now?: () => Date;
}

function nowIso(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

export function createSurveillanceConsentService(
  deps: SurveillanceConsentServiceDeps,
): SurveillanceConsentService {
  const { store } = deps;

  return {
    async registerSurveillanceDevice(args): Promise<SurveillanceDevice> {
      const rule = disclosureRuleFor(args.jurisdiction, args.type);
      if (rule && rule.bannedRecordingPolicies.includes(args.recordingPolicy)) {
        throw new Error(
          `[ethics-framework/surveillance] '${args.recordingPolicy}' is banned for '${args.type}' in '${args.jurisdiction}' (${rule.source})`,
        );
      }
      const device: SurveillanceDevice = {
        deviceId: args.deviceId,
        unitId: args.unitId,
        type: args.type,
        location: args.location,
        recordingPolicy: args.recordingPolicy,
        registeredAt: nowIso(deps.now),
        ...(args.disclosureUrl !== undefined ? { disclosureUrl: args.disclosureUrl } : {}),
      };
      await store.registerSurveillanceDevice(device);
      return device;
    },

    async recordConsent(args): Promise<SurveillanceConsent> {
      const device = await store.findSurveillanceDevice(args.deviceId);
      if (!device) {
        throw new Error(
          `[ethics-framework/surveillance] device '${args.deviceId}' not registered`,
        );
      }
      if (device.unitId !== args.unitId) {
        throw new Error(
          `[ethics-framework/surveillance] device '${args.deviceId}' is not in unit '${args.unitId}'`,
        );
      }
      const record: SurveillanceConsent = {
        tenantId: args.tenantId,
        deviceId: args.deviceId,
        unitId: args.unitId,
        granted: args.granted,
        recordedAt: nowIso(deps.now),
        jurisdiction: args.jurisdiction,
      };
      await store.appendSurveillanceConsent(record);
      return record;
    },

    async validateConsent({ unitId, tenantId, jurisdiction }): Promise<SurveillanceConsentStatus> {
      const devices = await store.surveillanceDevicesForUnit(unitId);
      const missing: string[] = [];
      for (const device of devices) {
        const rule = disclosureRuleFor(jurisdiction, device.type);
        // If the jurisdiction does not require opt-in for this type, skip.
        if (rule && !rule.requiresTenantOptIn) continue;
        const latest = await store.latestSurveillanceConsent({
          tenantId,
          deviceId: device.deviceId,
        });
        if (!latest || !latest.granted) {
          missing.push(device.deviceId);
        }
      }
      return {
        valid: missing.length === 0,
        missingConsent: missing,
      };
    },
  };
}
