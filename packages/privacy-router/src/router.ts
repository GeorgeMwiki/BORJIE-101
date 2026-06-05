/**
 * Privacy-aware AI router — pure routing core.
 *
 * `createPrivacyRouter(deps)` returns a router bound to injected ports and
 * a policy. Routing rules:
 *
 *   RESTRICTED   -> local model only (PII stripped even for local).
 *                   DENIED if the local endpoint is unavailable.
 *   CONFIDENTIAL -> approved cloud provider + mandatory PII stripping.
 *   INTERNAL     -> approved cloud provider, no PII stripping.
 *   PUBLIC       -> approved cloud provider, no restrictions.
 *
 * No `node:*`, no `fetch`, no `process.env`. The audit log is an
 * immutable ring buffer held in closure; every append produces a new
 * array rather than mutating in place.
 */

import { DEFAULT_PRIVACY_POLICY, type PrivacyPolicy } from './policy.js';
import {
  CLASSIFICATION_ORDER,
  type ApprovedCloudProvider,
  type DataClassification,
  type FieldClassifierPort,
  type LocalEndpointHealthPort,
  type PiiStripperPort,
  type PrivacyAuditEntry,
  type PrivacyRoutingRequest,
  type PrivacyRoutingResult,
} from './types.js';

/** Dependencies the router is constructed with. */
export interface PrivacyRouterDeps {
  readonly pii: PiiStripperPort;
  readonly localHealth: LocalEndpointHealthPort;
  /** Optional field classifier. Absent => field paths only escalate via
   *  the restricted-prefix list. */
  readonly fieldClassifier?: FieldClassifierPort;
  /** Policy. Defaults to {@link DEFAULT_PRIVACY_POLICY}. */
  readonly policy?: PrivacyPolicy;
  /** Audit ring-buffer capacity. Default 1000. */
  readonly auditBufferSize?: number;
  /** Clock override for deterministic tests. */
  readonly now?: () => Date;
}

/** Public surface of a constructed router. */
export interface PrivacyRouter {
  readonly route: (
    request: PrivacyRoutingRequest,
  ) => Promise<PrivacyRoutingResult>;
  readonly classify: (request: PrivacyRoutingRequest) => DataClassification;
  readonly isCloudAllowed: (classification: DataClassification) => boolean;
  readonly getAuditLog: (limit?: number) => ReadonlyArray<PrivacyAuditEntry>;
  readonly getAuditStats: () => PrivacyAuditStats;
  readonly clearAuditLog: () => void;
}

export interface PrivacyAuditStats {
  readonly total: number;
  readonly byClassification: Readonly<Record<DataClassification, number>>;
  readonly byEndpoint: Readonly<Record<string, number>>;
  readonly deniedCount: number;
  readonly piiStrippedCount: number;
}

const DEFAULT_AUDIT_BUFFER_SIZE = 1000;

/** Return the more restrictive of two classifications. */
function elevate(
  current: DataClassification,
  candidate: DataClassification,
): DataClassification {
  const c = CLASSIFICATION_ORDER.indexOf(current);
  const d = CLASSIFICATION_ORDER.indexOf(candidate);
  return d > c ? candidate : current;
}

export function createPrivacyRouter(deps: PrivacyRouterDeps): PrivacyRouter {
  const policy = deps.policy ?? DEFAULT_PRIVACY_POLICY;
  const bufferSize = deps.auditBufferSize ?? DEFAULT_AUDIT_BUFFER_SIZE;
  const clock = deps.now ?? (() => new Date());

  // Immutable ring buffer: each append replaces the reference.
  let auditBuffer: ReadonlyArray<PrivacyAuditEntry> = [];

  function append(entry: PrivacyAuditEntry): void {
    const next = [...auditBuffer, entry];
    auditBuffer = next.length > bufferSize ? next.slice(1) : next;
  }

  function resolveClassification(
    request: PrivacyRoutingRequest,
  ): DataClassification {
    if (request.classificationOverride) {
      return request.classificationOverride;
    }
    let highest: DataClassification = 'PUBLIC';

    if (request.fieldPaths && request.fieldPaths.length > 0) {
      for (const fieldPath of request.fieldPaths) {
        if (deps.fieldClassifier) {
          highest = elevate(highest, deps.fieldClassifier.classifyField(fieldPath));
        }
        const isRestricted = policy.restrictedFieldPrefixes.some((prefix) =>
          fieldPath.startsWith(prefix),
        );
        if (isRestricted) {
          highest = elevate(highest, 'RESTRICTED');
        }
      }
    }

    if (request.taskCategory) {
      const taskLevel = policy.taskCategoryClassification[request.taskCategory];
      if (taskLevel) {
        highest = elevate(highest, taskLevel);
      }
    }

    // Content scan bumps PUBLIC/INTERNAL to at least CONFIDENTIAL when PII
    // is present, so a public task carrying a stray NIDA is protected.
    if (highest === 'PUBLIC' || highest === 'INTERNAL') {
      if (deps.pii.containsPii(request.text)) {
        highest = elevate(highest, 'CONFIDENTIAL');
      }
    }

    return highest;
  }

  function selectCloudProvider(
    preferred?: ApprovedCloudProvider,
  ): ApprovedCloudProvider {
    if (preferred && policy.approvedCloudProviders.includes(preferred)) {
      return preferred;
    }
    // First approved provider is the platform default (Claude).
    return policy.approvedCloudProviders[0] ?? 'claude';
  }

  async function routeRestricted(
    request: PrivacyRoutingRequest,
    timestamp: string,
  ): Promise<PrivacyRoutingResult> {
    const strip = deps.pii.stripPii(request.text, request.knownNames);
    const strippedFields = Object.keys(strip.mappings);
    const healthy = await deps.localHealth.isHealthy();

    if (!healthy) {
      return {
        endpoint: 'DENIED',
        piiStripped: true,
        strippedFields,
        classification: 'RESTRICTED',
        reason:
          'RESTRICTED data cannot be sent to cloud providers and the local ' +
          'model is unavailable. Request denied per BOT Act data-residency rules.',
        timestamp,
      };
    }

    return {
      endpoint: 'ollama',
      piiStripped: true,
      strippedFields,
      classification: 'RESTRICTED',
      reason:
        'RESTRICTED data routed to the local model with full PII stripping. ' +
        'No data leaves the premises.',
      timestamp,
      piiMappings: strip.mappings,
      processedText: strip.stripped,
    };
  }

  function routeConfidential(
    request: PrivacyRoutingRequest,
    timestamp: string,
  ): PrivacyRoutingResult {
    const strip = deps.pii.stripPii(request.text, request.knownNames);
    const strippedFields = Object.keys(strip.mappings);
    const provider = selectCloudProvider(request.preferredProvider);
    return {
      endpoint: provider,
      piiStripped: true,
      strippedFields,
      classification: 'CONFIDENTIAL',
      reason:
        `CONFIDENTIAL data routed to ${provider} with mandatory PII stripping. ` +
        `${strippedFields.length} field(s) stripped; transport encryption required.`,
      timestamp,
      piiMappings: strip.mappings,
      processedText: strip.stripped,
    };
  }

  function routeOpen(
    request: PrivacyRoutingRequest,
    classification: 'INTERNAL' | 'PUBLIC',
    timestamp: string,
  ): PrivacyRoutingResult {
    const provider = selectCloudProvider(request.preferredProvider);
    const reason =
      classification === 'INTERNAL'
        ? `INTERNAL data routed to ${provider} with transport encryption. No PII stripping required.`
        : `PUBLIC data routed to ${provider}. No restrictions applied.`;
    return {
      endpoint: provider,
      piiStripped: false,
      strippedFields: [],
      classification,
      reason,
      timestamp,
      processedText: request.text,
    };
  }

  async function routeByClassification(
    request: PrivacyRoutingRequest,
    classification: DataClassification,
    timestamp: string,
  ): Promise<PrivacyRoutingResult> {
    switch (classification) {
      case 'RESTRICTED':
        return routeRestricted(request, timestamp);
      case 'CONFIDENTIAL':
        return routeConfidential(request, timestamp);
      case 'INTERNAL':
        return routeOpen(request, 'INTERNAL', timestamp);
      case 'PUBLIC':
        return routeOpen(request, 'PUBLIC', timestamp);
    }
  }

  return {
    async route(request) {
      const classification = resolveClassification(request);
      const timestamp = clock().toISOString();
      const result = await routeByClassification(
        request,
        classification,
        timestamp,
      );
      append({
        timestamp,
        classification,
        endpoint: result.endpoint,
        piiStripped: result.piiStripped,
        strippedFieldCount: result.strippedFields.length,
        taskCategory: request.taskCategory ?? 'unknown',
        reason: result.reason,
      });
      return result;
    },

    classify(request) {
      return resolveClassification(request);
    },

    isCloudAllowed(classification) {
      return classification !== 'RESTRICTED';
    },

    getAuditLog(limit = 100) {
      const reversed = [...auditBuffer].reverse();
      return reversed.slice(0, Math.min(limit, bufferSize));
    },

    getAuditStats() {
      const byClassification: Record<DataClassification, number> = {
        PUBLIC: 0,
        INTERNAL: 0,
        CONFIDENTIAL: 0,
        RESTRICTED: 0,
      };
      const byEndpoint: Record<string, number> = {};
      let deniedCount = 0;
      let piiStrippedCount = 0;
      for (const entry of auditBuffer) {
        byClassification[entry.classification] += 1;
        byEndpoint[entry.endpoint] = (byEndpoint[entry.endpoint] ?? 0) + 1;
        if (entry.endpoint === 'DENIED') deniedCount += 1;
        if (entry.piiStripped) piiStrippedCount += 1;
      }
      return {
        total: auditBuffer.length,
        byClassification,
        byEndpoint,
        deniedCount,
        piiStrippedCount,
      };
    },

    clearAuditLog() {
      auditBuffer = [];
    },
  };
}
