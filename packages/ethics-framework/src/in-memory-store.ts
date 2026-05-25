/**
 * In-memory `EthicsStore` for tests + local development.
 *
 * Never use this in production: there is no persistence and no
 * cross-process locking. The shipped DB-backed adapter lives in
 * `@borjie/database` (out of scope here).
 */

import type {
  AutomatedDecisionDisclosure,
  ConsentRecord,
  ConsentScope,
  EthicsStore,
  RightToExplanationRequest,
  SurveillanceConsent,
  SurveillanceDevice,
  VulnerabilityFlag,
} from './types.js';

type OptOutKey = `${string}::${ConsentScope}`;

function key(subjectId: string, scope: ConsentScope): OptOutKey {
  return `${subjectId}::${scope}`;
}

export function createInMemoryStore(): EthicsStore {
  const consent: ConsentRecord[] = [];
  const vulnerability: VulnerabilityFlag[] = [];
  const decisions: AutomatedDecisionDisclosure[] = [];
  const explanationRequests: RightToExplanationRequest[] = [];
  const optOuts = new Map<OptOutKey, string>();
  const devices = new Map<string, SurveillanceDevice>();
  const devicesByUnit = new Map<string, Set<string>>();
  const surveillanceConsents: SurveillanceConsent[] = [];

  return {
    async appendConsent(record) {
      consent.push(record);
    },
    async consentHistory({ subjectId, scope }) {
      return consent.filter((r) => r.subjectId === subjectId && r.scope === scope);
    },

    async appendVulnerabilityFlag(flag) {
      vulnerability.push(flag);
    },
    async vulnerabilityFlags(subjectId) {
      return vulnerability.filter((v) => v.subjectId === subjectId);
    },

    async appendAutomatedDecision(decision) {
      decisions.push(decision);
    },
    async findDecision(decisionId) {
      const d = decisions.find((x) => x.decisionId === decisionId);
      return d ?? null;
    },
    async recordExplanationRequest(req) {
      explanationRequests.push(req);
    },
    async recordAutomationOptOut(args) {
      optOuts.set(key(args.subjectId, args.scope), args.recordedAt);
    },
    async automationOptedOut(args) {
      return optOuts.has(key(args.subjectId, args.scope));
    },

    async registerSurveillanceDevice(device) {
      devices.set(device.deviceId, device);
      const set = devicesByUnit.get(device.unitId) ?? new Set<string>();
      set.add(device.deviceId);
      devicesByUnit.set(device.unitId, set);
    },
    async findSurveillanceDevice(deviceId) {
      return devices.get(deviceId) ?? null;
    },
    async surveillanceDevicesForUnit(unitId) {
      const set = devicesByUnit.get(unitId);
      if (!set) return [];
      const out: SurveillanceDevice[] = [];
      for (const id of set) {
        const d = devices.get(id);
        if (d) out.push(d);
      }
      return out;
    },
    async appendSurveillanceConsent(record) {
      surveillanceConsents.push(record);
    },
    async latestSurveillanceConsent({ tenantId, deviceId }) {
      const filtered = surveillanceConsents.filter(
        (r) => r.tenantId === tenantId && r.deviceId === deviceId,
      );
      if (filtered.length === 0) return null;
      return filtered[filtered.length - 1] ?? null;
    },
  };
}
