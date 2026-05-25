/**
 * TDD loop — Aider's red→green→refactor cycle.
 *
 * The loop:
 *
 *   1. Brain proposes a failing test for the intent.
 *   2. Tests run — we EXPECT failure ("red"). If they pass, the
 *      brain misread the intent — bail.
 *   3. Brain proposes the implementation patch.
 *   4. Tests run again — we EXPECT success ("green"). If they
 *      still fail, feed the test output back to the brain and
 *      retry up to `maxIterations` times.
 *   5. Optional refactor step.
 *
 * Every iteration is recorded as a `TDDStep` for replay/audit.
 *
 * The loop is brain- and sandbox-agnostic — both are injected via
 * the `BrainPort` / `SandboxPort` interfaces.
 */

import type {
  BrainPort,
  EditApplyResult,
  EditProposal,
  SandboxPort,
  TDDLoop,
  TDDLoopResult,
  TDDStep,
  TestResult,
} from '../types.js';
import { applyEditProposal, parseDiff } from '../minimal-diff-editing/index.js';
import { runTests, type RunTestsOptions } from '../sandbox-execution/index.js';

export interface RunTDDLoopOptions {
  readonly intent: string;
  readonly testFilePath: string;
  readonly implFilePath: string;
  readonly testFileBefore: string;
  readonly implFileBefore: string;
  readonly brain: BrainPort;
  readonly sandbox: SandboxPort;
  readonly tests: Omit<RunTestsOptions, 'sandbox'>;
  readonly maxIterations?: number;
  /**
   * Hook the caller uses to persist updated bytes back to the
   * filesystem (so the sandbox sees them). Returns the new bytes
   * if the caller wants to override (e.g. formatter).
   */
  readonly writeFile: (path: string, bytes: string) => Promise<string>;
  /**
   * Optional refactor step prompt template.
   */
  readonly refactorPromptBuilder?: (params: {
    readonly impl: string;
    readonly intent: string;
  }) => string;
}

const DEFAULT_MAX_ITER = 4;

export async function runTDDLoop(options: RunTDDLoopOptions): Promise<TDDLoop> {
  const max = options.maxIterations ?? DEFAULT_MAX_ITER;
  const history: TDDStep[] = [];

  // ── 1. Write the test (red expectation). ───────────────────────
  const testProp = await brainPropose(
    options.brain,
    `Write a failing test for ${options.testFilePath} that proves: ${options.intent}\n\nCURRENT TEST FILE:\n${options.testFileBefore}`,
    options.testFilePath,
    `add test for ${options.intent}`,
  );
  const testApply = applyEditProposal({
    proposal: testProp,
    fileBytes: options.testFileBefore,
  });
  await options.writeFile(options.testFilePath, testApply.newBytes);
  history.push(makeStep(1, 'write-test', testProp, undefined, testApply));

  // ── 2. Run tests — expect red. ─────────────────────────────────
  const redResult = await runTests({ sandbox: options.sandbox, ...options.tests });
  history.push(makeStep(1, 'expect-fail', undefined, redResult));
  if (redResult.passed) {
    return finalize(options, history, 'red', 1);
  }

  let implBytes = options.implFileBefore;
  let lastTestResult: TestResult = redResult;
  let iter = 1;

  while (iter <= max) {
    // ── 3. Brain writes the impl using the test output as context.
    const implProp = await brainPropose(
      options.brain,
      `Make the test pass for: ${options.intent}\n\nFAILING TEST OUTPUT:\n${lastTestResult.stdout}\n${lastTestResult.stderr}\n\nCURRENT IMPL FILE:\n${implBytes}`,
      options.implFilePath,
      `impl for ${options.intent} (iter ${iter})`,
    );
    const implApply = applyEditProposal({
      proposal: implProp,
      fileBytes: implBytes,
    });
    implBytes = await options.writeFile(options.implFilePath, implApply.newBytes);
    history.push(makeStep(iter, 'write-code', implProp, undefined, implApply));

    // ── 4. Run tests — expect green.
    const result = await runTests({ sandbox: options.sandbox, ...options.tests });
    history.push(makeStep(iter, 'expect-pass', undefined, result));
    lastTestResult = result;
    if (result.passed) {
      // ── 5. Optional refactor.
      if (options.refactorPromptBuilder) {
        const prompt = options.refactorPromptBuilder({ impl: implBytes, intent: options.intent });
        const refactorProp = await brainPropose(
          options.brain,
          prompt,
          options.implFilePath,
          `refactor for ${options.intent}`,
        );
        const refactorApply = applyEditProposal({
          proposal: refactorProp,
          fileBytes: implBytes,
        });
        const refactorBytes = await options.writeFile(
          options.implFilePath,
          refactorApply.newBytes,
        );
        const postResult = await runTests({
          sandbox: options.sandbox,
          ...options.tests,
        });
        history.push(makeStep(iter, 'refactor', refactorProp, postResult, refactorApply));
        if (!postResult.passed) {
          // Refactor broke things — keep the pre-refactor version semantically
          // but report final as red because tests don't pass.
          return finalize(options, history, 'red', iter);
        }
        void refactorBytes;
      }
      return finalize(options, history, 'green', iter);
    }
    iter++;
  }
  return finalize(options, history, 'max-iterations', iter);
}

function makeStep(
  iteration: number,
  phase: TDDStep['phase'],
  proposal: EditProposal | undefined,
  testResult: TestResult | undefined,
  apply?: EditApplyResult,
): TDDStep {
  const notes = apply
    ? `applied=${apply.appliedHunks} conflicts=${apply.conflicts.length}`
    : undefined;
  return Object.freeze({
    iteration,
    phase,
    ...(proposal !== undefined ? { editProposal: proposal } : {}),
    ...(testResult !== undefined ? { testResult } : {}),
    ...(notes !== undefined ? { notes } : {}),
  });
}

async function brainPropose(
  brain: BrainPort,
  prompt: string,
  filePath: string,
  intent: string,
): Promise<EditProposal> {
  const res = await brain.generate({ prompt });
  return Object.freeze({
    filePath,
    intent,
    diff: parseDiff('search-replace', res.text),
  });
}

function finalize(
  options: RunTDDLoopOptions,
  history: ReadonlyArray<TDDStep>,
  final: TDDLoopResult['final'],
  iterations: number,
): TDDLoop {
  return Object.freeze({
    intent: options.intent,
    testFilePath: options.testFilePath,
    implFilePath: options.implFilePath,
    result: Object.freeze({
      final,
      iterations,
      history,
    }),
  });
}
