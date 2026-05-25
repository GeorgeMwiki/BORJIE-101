/**
 * Geology advisor — pure geometry + statistics for drill-hole
 * interpretation, vein triangulation, and contained-metal estimates.
 *
 * The triangulation is intentionally simple (fan triangulation around
 * the centroid) — enough for visualisation and rough volume estimates
 * but not a substitute for a full Delaunay / implicit-surface engine.
 */

import {
  geologyInputSchema,
  geologyRecommendationContextSchema,
  type AssayInterval,
  type CompositedInterval,
  type EvidenceRef,
  type GeologyAnalysis,
  type GeologyInput,
  type GeologyRecommendation,
  type GeologyRecommendationContext,
  type OreBodyStats,
  type Point3D,
  type TriangulatedMesh,
  type VeinSamplePoint,
} from './types.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface GeologyAdvisorDeps {
  readonly logger?: Logger;
}

export interface GeologyAdvisor {
  analyze(input: GeologyInput): Promise<GeologyAnalysis>;
  recommend(
    context: GeologyRecommendationContext,
  ): Promise<ReadonlyArray<GeologyRecommendation>>;
}

export function createGeologyAdvisor(deps: GeologyAdvisorDeps = {}): GeologyAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = geologyInputSchema.parse(rawInput);
      logger.info('geology.analyze.start', {
        holes: input.collars.length,
        assays: input.assays.length,
      });
      const composited = compositeIntervals(input.assays);
      const veinMesh =
        input.veinSamples.length >= 3 ? triangulateVein(input.veinSamples) : null;
      const stats = computeOreBodyStats(composited, input.cutoffGrade);
      const analysis: GeologyAnalysis = {
        composited: [...composited],
        veinMesh,
        stats,
        computedAtISO: new Date().toISOString(),
      };
      logger.info('geology.analyze.done', {
        totalTonnes: stats.totalTonnes,
        avgGrade: stats.weightedAverageGrade,
      });
      return analysis;
    },
    async recommend(rawContext) {
      const context = geologyRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('geology.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

// ─── Compositing ──────────────────────────────────────────────────

export function compositeIntervals(
  assays: ReadonlyArray<AssayInterval>,
): ReadonlyArray<CompositedInterval> {
  const byHole = new Map<string, AssayInterval[]>();
  for (const a of assays) {
    const list = byHole.get(a.holeId) ?? [];
    list.push(a);
    byHole.set(a.holeId, list);
  }
  const out: CompositedInterval[] = [];
  for (const [holeId, list] of byHole.entries()) {
    const sorted = [...list].sort((a, b) => a.fromM - b.fromM);
    let totalLength = 0;
    let gradeAccum = 0;
    let densityAccum = 0;
    let fromM = sorted[0]?.fromM ?? 0;
    let toM = sorted[sorted.length - 1]?.toM ?? 0;
    for (const a of sorted) {
      const len = a.toM - a.fromM;
      totalLength += len;
      gradeAccum += a.grade * len;
      densityAccum += a.density * len;
    }
    if (totalLength === 0) continue;
    out.push({
      holeId,
      fromM,
      toM,
      lengthM: totalLength,
      weightedGrade: gradeAccum / totalLength,
      weightedDensity: densityAccum / totalLength,
    });
  }
  return out;
}

// ─── Triangulation ────────────────────────────────────────────────

export function triangulateVein(
  samples: ReadonlyArray<VeinSamplePoint>,
): TriangulatedMesh {
  if (samples.length < 3) {
    return { vertices: [], triangles: [] };
  }
  // Compute centroid; build a fan of triangles around it.
  const centroid = computeCentroid(samples.map((s) => s.point));
  const vertices: Point3D[] = [centroid, ...samples.map((s) => s.point)];
  const triangles: Array<[number, number, number]> = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push([0, i, i + 1]);
  }
  return { vertices, triangles };
}

function computeCentroid(points: ReadonlyArray<Point3D>): Point3D {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const [x, y, z] of points) {
    sx += x;
    sy += y;
    sz += z;
  }
  const n = points.length;
  return [sx / n, sy / n, sz / n];
}

// ─── Stats ────────────────────────────────────────────────────────

export function computeOreBodyStats(
  composited: ReadonlyArray<CompositedInterval>,
  cutoffGrade: number,
): OreBodyStats {
  let totalTonnes = 0;
  let gradeTonnes = 0;
  let aboveCutoffSum = 0;
  let aboveCutoffCount = 0;
  for (const c of composited) {
    // Cylinder approximation per metre of core: cross-section ~ 1 m^2.
    const tonnes = c.lengthM * c.weightedDensity;
    totalTonnes += tonnes;
    gradeTonnes += tonnes * c.weightedGrade;
    if (c.weightedGrade >= cutoffGrade) {
      aboveCutoffSum += c.weightedGrade;
      aboveCutoffCount++;
    }
  }
  const wAvg = totalTonnes === 0 ? 0 : gradeTonnes / totalTonnes;
  return {
    totalTonnes,
    weightedAverageGrade: wAvg,
    // Contained metal in tonnes when grade is in g/t — caller divides by 1e6.
    containedMetalTonnes: (gradeTonnes / 1_000_000),
    meanGradeAboveCutoff: aboveCutoffCount === 0 ? 0 : aboveCutoffSum / aboveCutoffCount,
    intervalCount: composited.length,
  };
}

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: GeologyRecommendationContext,
): ReadonlyArray<GeologyRecommendation> {
  const { input, analysis, policy } = context;
  const out: GeologyRecommendation[] = [];

  // R1: sparse vein samples
  if (input.veinSamples.length > 0 && input.veinSamples.length < policy.minSamplesPerVein) {
    out.push({
      id: 'sparse-vein-samples',
      kind: 'infill-drill',
      title: `Only ${input.veinSamples.length} vein samples — below policy ${policy.minSamplesPerVein}`,
      rationale:
        'Vein modelling is unreliable below the minimum sample count. ' +
        'Recommend infill-drilling before promoting the body to Reserve.',
      severity: 'medium',
      evidence: [evidence('vein-sample', 'vein-samples.count')],
    });
  }

  // R2: low confidence over wide area
  const uniqueHoles = new Set(input.assays.map((a) => a.holeId));
  if (uniqueHoles.size < policy.minHolesPerArea) {
    out.push({
      id: 'low-confidence-volume',
      kind: 'flag-low-confidence-volume',
      title: `${uniqueHoles.size} hole(s) supporting current volume estimate`,
      rationale:
        'Hole density below policy — downstream tonnage figures should ' +
        'be tagged low-confidence in the LMBM.',
      severity: 'high',
      evidence: [evidence('stats', 'stats.totalTonnes')],
    });
  }

  // R3: average grade comfortably above cutoff → suggest raising cutoff
  if (
    analysis.stats.meanGradeAboveCutoff > input.cutoffGrade * 2 &&
    analysis.stats.intervalCount > 0
  ) {
    out.push({
      id: 'raise-cutoff-grade',
      kind: 'raise-cutoff',
      title: 'Mean grade above cutoff is >2x the cutoff itself',
      rationale:
        'Cutoff grade may be too low — raising it would improve ore ' +
        'selectivity and processing margin. Coordinate with the ' +
        'cost-engineer-advisor before changing it.',
      severity: 'low',
      evidence: [evidence('stats', 'stats.meanGradeAboveCutoff')],
    });
  }

  return out;
}

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}
