import { describe, it, expect } from 'vitest';
import {
  createMultimodalInspection,
  type MultimodalInspectionRepository,
  type InspectionAIFinding,
} from '../multimodal-inspection/index.js';
import { DEGRADED_MODEL_VERSION, type VisionLLMPort } from '../shared.js';

function makeRepo(): MultimodalInspectionRepository & {
  findings: InspectionAIFinding[];
} {
  const findings: InspectionAIFinding[] = [];
  return {
    findings,
    async insertFindings(rows) {
      findings.push(...rows);
      return rows;
    },
    async listByInspection(_t, inspectionId) {
      return findings.filter((f) => f.inspectionId === inspectionId);
    },
  };
}

describe('multimodal-inspection', () => {
  it('analyzes media via vision port and persists findings with bounding boxes', async () => {
    const vision: VisionLLMPort = {
      async analyze() {
        return {
          raw: JSON.stringify({
            findings: [
              {
                defectLabel: 'cracked tile',
                severity: 'moderate',
                estimatedCostMinMinor: 10_000,
                estimatedCostMaxMinor: 30_000,
                recommendedTrade: 'tile-layer',
                evidenceMediaId: 'img-1',
                boundingBox: [0.2, 0.3, 0.1, 0.1],
                confidence: 0.88,
                explanation: 'visible cracks at floor tile',
              },
            ],
          }),
          modelVersion: 'claude-vision',
          inputTokens: 100,
          outputTokens: 100,
        };
      },
    };
    const repo = makeRepo();
    const svc = createMultimodalInspection({ repo, vision });

    const findings = await svc.analyze({
      tenantId: 't1',
      inspectionId: 'insp1',
      media: [{ kind: 'image', url: 'https://ex.com/photo.jpg', mediaId: 'img-1' }],
      currencyCode: 'KES',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('moderate');
    expect(findings[0].boundingBox).toEqual([0.2, 0.3, 0.1, 0.1]);
    expect(findings[0].confidence).toBeCloseTo(0.88);
    expect(findings[0].modelVersion).toBe('claude-vision');
    expect(findings[0].promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(findings[0].currencyCode).toBe('KES');
  });

  it('returns degraded placeholder when vision port is missing', async () => {
    const repo = makeRepo();
    const svc = createMultimodalInspection({ repo });
    const findings = await svc.analyze({
      tenantId: 't1',
      inspectionId: 'insp2',
      media: [{ kind: 'image', url: 'https://ex.com/a.jpg' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].modelVersion).toBe(DEGRADED_MODEL_VERSION);
    expect(findings[0].confidence).toBe(0);
    expect(findings[0].defectLabel).toBe('vision_port_unavailable');
  });

  it('rejects analyze with missing media array', async () => {
    const repo = makeRepo();
    const svc = createMultimodalInspection({ repo });
    await expect(
      svc.analyze({ tenantId: 't1', inspectionId: 'i1', media: [] }),
    ).rejects.toThrow(/at least one media/);
  });

  it('clamps invalid severity + confidence coming from LLM', async () => {
    const vision: VisionLLMPort = {
      async analyze() {
        return {
          raw: JSON.stringify({
            findings: [
              {
                defectLabel: 'x',
                severity: 'nonsense',
                confidence: 99,
                boundingBox: ['not a number', 0.2, 0.2, 0.2],
              },
            ],
          }),
          modelVersion: 'v',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const repo = makeRepo();
    const svc = createMultimodalInspection({ repo, vision });
    const findings = await svc.analyze({
      tenantId: 't1',
      inspectionId: 'insp3',
      media: [{ kind: 'image', url: 'https://x/x' }],
    });
    expect(findings[0].severity).toBe('minor'); // fallback
    expect(findings[0].confidence).toBe(1); // clamped
    expect(findings[0].boundingBox).toBeNull(); // invalid
  });
});
