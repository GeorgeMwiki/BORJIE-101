/**
 * Multimodal inspection.
 *
 * Accept photo / video / audio from an inspection. Route through a vision
 * model with a structured system prompt: "list observed defects, severity,
 * estimated repair cost range, recommended trade, photo-level evidence
 * spans." Persist per-finding with bounding-box + confidence.
 *
 * WHY AI-NATIVE: humans see N photos/day; this reviews thousands with
 * uniform rubric + pixel-level evidence every time.
 *
 * Gated by VISION_API_KEY env var — caller injects the port.
 */

import {
  type BudgetGuard,
  type VisionLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  newId,
  clamp01,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DefectSeverity = 'cosmetic' | 'minor' | 'moderate' | 'major' | 'critical';

export interface InspectionMedia {
  readonly kind: 'image' | 'video' | 'audio';
  readonly url: string;
  readonly mediaId?: string;
}

export interface AnalyzeInput {
  readonly tenantId: string;
  readonly inspectionId: string;
  readonly media: readonly InspectionMedia[];
  readonly contextNote?: string;
  readonly currencyCode?: string; // ISO-4217
}

export interface InspectionAIFinding {
  readonly id: string;
  readonly tenantId: string;
  readonly inspectionId: string;
  readonly defectLabel: string;
  readonly severity: DefectSeverity;
  readonly estimatedCostMinMinor: number | null;
  readonly estimatedCostMaxMinor: number | null;
  readonly currencyCode: string | null;
  readonly recommendedTrade: string | null;
  readonly evidenceMediaId: string | null;
  readonly boundingBox: readonly [number, number, number, number] | null;
  readonly confidence: number;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly explanation: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface MultimodalInspectionRepository {
  insertFindings(
    findings: readonly InspectionAIFinding[],
  ): Promise<readonly InspectionAIFinding[]>;
  listByInspection(
    tenantId: string,
    inspectionId: string,
  ): Promise<readonly InspectionAIFinding[]>;
}

export interface MultimodalInspectionDeps {
  readonly repo: MultimodalInspectionRepository;
  readonly vision?: VisionLLMPort;
  readonly budgetGuard?: BudgetGuard;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are a property-inspection AI. Analyze the attached media and return ONLY JSON:
{
  "findings": [
    {
      "defectLabel": string,
      "severity": "cosmetic" | "minor" | "moderate" | "major" | "critical",
      "estimatedCostMinMinor": number | null,
      "estimatedCostMaxMinor": number | null,
      "recommendedTrade": string | null,
      "evidenceMediaId": string | null,
      "boundingBox": [x, y, w, h] normalized 0..1 | null,
      "confidence": number (0..1),
      "explanation": string
    }
  ]
}
Rules:
- Base each finding on visible evidence only; no speculation.
- Costs are in MINOR units of the caller's currency.
- If media is too low-quality, return an empty findings array.`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MultimodalInspection {
  analyze(input: AnalyzeInput): Promise<readonly InspectionAIFinding[]>;
  listByInspection(
    tenantId: string,
    inspectionId: string,
  ): Promise<readonly InspectionAIFinding[]>;
}

const VALID_SEVERITIES: readonly DefectSeverity[] = [
  'cosmetic',
  'minor',
  'moderate',
  'major',
  'critical',
];

function normalizeSeverity(v: unknown): DefectSeverity {
  return typeof v === 'string' && (VALID_SEVERITIES as readonly string[]).includes(v)
    ? (v as DefectSeverity)
    : 'minor';
}

function normalizeBoundingBox(v: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const nums = v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? clamp01(x) : null));
  if (nums.some((n) => n === null)) return null;
  return nums as [number, number, number, number];
}

export function createMultimodalInspection(
  deps: MultimodalInspectionDeps,
): MultimodalInspection {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;

  return {
    async analyze(input) {
      if (!input.tenantId || !input.inspectionId) {
        throw new Error('multimodal-inspection.analyze: missing required fields');
      }
      if (!Array.isArray(input.media) || input.media.length === 0) {
        throw new Error('multimodal-inspection.analyze: at least one media item required');
      }

      const system = VISION_SYSTEM_PROMPT;
      const user = `Inspection ${input.inspectionId}. Context: ${input.contextNote ?? '(none)'}. Currency: ${input.currencyCode ?? 'unspecified'}. Analyze all attached media and list findings.`;
      const hash = promptHash(system + '\n---\n' + user + '\n---\n' + input.media.map((m) => `${m.kind}:${m.url}`).join('|'));
      const createdAt = now().toISOString();

      if (!deps.vision) {
        // Degraded mode — VISION_API_KEY not configured. Persist a zero-confidence
        // placeholder so the audit chain shows the attempt.
        const placeholder: InspectionAIFinding = {
          id: newId('iaf'),
          tenantId: input.tenantId,
          inspectionId: input.inspectionId,
          defectLabel: 'vision_port_unavailable',
          severity: 'minor',
          estimatedCostMinMinor: null,
          estimatedCostMaxMinor: null,
          currencyCode: input.currencyCode ?? null,
          recommendedTrade: null,
          evidenceMediaId: null,
          boundingBox: null,
          confidence: 0,
          modelVersion: DEGRADED_MODEL_VERSION,
          promptHash: hash,
          explanation: 'VISION_API_KEY not configured; skipped multimodal analysis',
          metadata: { degraded: true },
          createdAt,
        };
        return deps.repo.insertFindings([placeholder]);
      }

      await guard(input.tenantId, 'multimodal-inspection:analyze');

      try {
        const res = await deps.vision.analyze({
          systemPrompt: system,
          userPrompt: user,
          media: input.media,
        });
        const parsed = safeJsonParse<{
          findings?: Array<{
            defectLabel?: string;
            severity?: string;
            estimatedCostMinMinor?: number | null;
            estimatedCostMaxMinor?: number | null;
            recommendedTrade?: string | null;
            evidenceMediaId?: string | null;
            boundingBox?: unknown;
            confidence?: number;
            explanation?: string;
          }>;
        }>(res.raw) ?? { findings: [] };

        const findings: InspectionAIFinding[] = (parsed.findings ?? []).map((f) => ({
          id: newId('iaf'),
          tenantId: input.tenantId,
          inspectionId: input.inspectionId,
          defectLabel: (f.defectLabel ?? 'unlabeled').slice(0, 200),
          severity: normalizeSeverity(f.severity),
          estimatedCostMinMinor:
            typeof f.estimatedCostMinMinor === 'number' ? Math.max(0, Math.round(f.estimatedCostMinMinor)) : null,
          estimatedCostMaxMinor:
            typeof f.estimatedCostMaxMinor === 'number' ? Math.max(0, Math.round(f.estimatedCostMaxMinor)) : null,
          currencyCode: input.currencyCode ?? null,
          recommendedTrade: f.recommendedTrade ?? null,
          evidenceMediaId: f.evidenceMediaId ?? null,
          boundingBox: normalizeBoundingBox(f.boundingBox),
          confidence: clamp01(f.confidence),
          modelVersion: res.modelVersion,
          promptHash: hash,
          explanation: f.explanation ?? null,
          metadata: {},
          createdAt,
        }));

        return findings.length > 0 ? deps.repo.insertFindings(findings) : [];
      } catch (err) {
        const placeholder: InspectionAIFinding = {
          id: newId('iaf'),
          tenantId: input.tenantId,
          inspectionId: input.inspectionId,
          defectLabel: 'vision_call_failed',
          severity: 'minor',
          estimatedCostMinMinor: null,
          estimatedCostMaxMinor: null,
          currencyCode: input.currencyCode ?? null,
          recommendedTrade: null,
          evidenceMediaId: null,
          boundingBox: null,
          confidence: 0,
          modelVersion: DEGRADED_MODEL_VERSION,
          promptHash: hash,
          explanation: `Vision call failed: ${err instanceof Error ? err.message : 'unknown'}`,
          metadata: { degraded: true, error: true },
          createdAt,
        };
        return deps.repo.insertFindings([placeholder]);
      }
    },

    async listByInspection(tenantId, inspectionId) {
      return deps.repo.listByInspection(tenantId, inspectionId);
    },
  };
}
