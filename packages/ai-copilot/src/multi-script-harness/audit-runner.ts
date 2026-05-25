/**
 * Audit runner — orchestrates generator + judge across a test suite and
 * produces a `MultiScriptAuditReport` suitable for dashboards and
 * regression gates.
 *
 * The runner fan-outs cases in parallel (bounded concurrency) so a
 * regression across 50+ locales still completes inside CI budgets.
 * Concurrency is capped to guard shared LLM quota.
 */

import type {
  BrainOutputGenerator,
  LLMJudge,
  MultiScriptAuditReport,
  ScriptTestCase,
  ScriptTestResult,
} from './types.js';

export interface RunAuditOptions {
  readonly generator: BrainOutputGenerator;
  readonly judge: LLMJudge;
  readonly cases: readonly ScriptTestCase[];
  readonly concurrency?: number;
  readonly now?: () => Date;
}

const DEFAULT_CONCURRENCY = 4;

async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const runners: Promise<void>[] = [];
  const effectiveLimit = Math.max(1, limit);

  async function pickNext(): Promise<void> {
    const next = queue.shift();
    if (!next) return;
    await worker(next.item, next.index);
    await pickNext();
  }

  for (let i = 0; i < Math.min(effectiveLimit, queue.length); i += 1) {
    runners.push(pickNext());
  }
  await Promise.all(runners);
}

export async function runMultiScriptAudit(options: RunAuditOptions): Promise<MultiScriptAuditReport> {
  const { generator, judge, cases } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results: ScriptTestResult[] = new Array(cases.length);

  await runWithLimit(cases, concurrency, async (testCase, index) => {
    let output: string;
    try {
      output = await generator.generate({ testCase });
    } catch (error) {
      results[index] = {
        caseId: testCase.id,
        locale: testCase.locale,
        script: testCase.script,
        scenario: testCase.scenario,
        passed: false,
        rubricScores: {
          grammar: 0,
          scriptCorrectness: 0,
          registerFit: 0,
          culturalAppropriateness: 0,
          composite: 0,
        },
        issues: [
          {
            dimension: 'grammar',
            message: `Generator threw: ${(error as Error).message}`,
          },
        ],
        output: '',
      };
      return;
    }

    const judged = await judge.judge({ testCase, output });
    results[index] = {
      caseId: testCase.id,
      locale: testCase.locale,
      script: testCase.script,
      scenario: testCase.scenario,
      passed: judged.passed,
      rubricScores: judged.rubricScores,
      issues: judged.issues,
      output,
    };
  });

  const totalCases = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = totalCases - passed;
  const passRate = totalCases === 0 ? 0 : passed / totalCases;

  const byLocale: Record<string, { passed: number; total: number }> = {};
  const byScenario: Record<string, { passed: number; total: number }> = {};

  for (const result of results) {
    const locBucket = byLocale[result.locale] ?? { passed: 0, total: 0 };
    locBucket.total += 1;
    if (result.passed) locBucket.passed += 1;
    byLocale[result.locale] = locBucket;

    const scenBucket = byScenario[result.scenario] ?? { passed: 0, total: 0 };
    scenBucket.total += 1;
    if (result.passed) scenBucket.passed += 1;
    byScenario[result.scenario] = scenBucket;
  }

  const generatedAt = (options.now ? options.now() : new Date()).toISOString();

  return Object.freeze({
    totalCases,
    passed,
    failed,
    passRate,
    byLocale: Object.freeze({ ...byLocale }),
    byScenario: Object.freeze({ ...byScenario }),
    results: Object.freeze([...results]),
    generatedAt,
  });
}

export function failingLocales(report: MultiScriptAuditReport, threshold = 0.8): readonly string[] {
  const fails: string[] = [];
  for (const [locale, { passed, total }] of Object.entries(report.byLocale)) {
    if (total === 0) continue;
    const rate = passed / total;
    if (rate < threshold) fails.push(locale);
  }
  return Object.freeze(fails);
}
