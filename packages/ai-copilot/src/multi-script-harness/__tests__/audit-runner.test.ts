import { describe, it, expect } from 'vitest';
import { runMultiScriptAudit, failingLocales } from '../audit-runner.js';
import { heuristicJudge } from '../heuristic-judge.js';
import { BASELINE_TEST_CASES } from '../fixtures.js';
import type { BrainOutputGenerator, ScriptTestCase } from '../types.js';
import { validateRubricWeights } from '../types.js';

const STUB_RESPONSES: Record<string, string> = {
  'rent-reminder-sw-KE':
    'Habari, hii ni ukumbusho wa kodi ya nyumba yako. Tafadhali lipa kodi leo kwa MPESA paybill. Asante kwa ushirikiano.',
  'rent-reminder-en-GB':
    'Dear tenant, kindly note the rent is three days overdue. Please settle today to avoid late fees. Thank you.',
  'arrears-notice-ar-AE':
    'السلام عليكم، نود إشعاركم أن الإيجار متأخر عن الدفع لمدة 14 يوماً. يرجى سداد المتأخرات خلال 7 أيام.',
  'lease-renewal-de-DE':
    'Sehr geehrter Herr Mieter, bitte beachten Sie unsere Mietanpassung gemäß BGB §557. Wir würden uns freuen, den Mietvertrag zu erneuern.',
  'move-out-ko-KR':
    '안녕하세요. 이사 체크리스트를 안내드립니다. 임대료와 보증금 정산을 위해 집 상태를 확인해 주세요.',
  'regulator-letter-ja-JP':
    '拝啓、借地借家法に基づき、本書をもってご連絡申し上げます。規制当局のご指摘について、以下の通り回答いたします。',
  'viewing-confirmation-fr-FR':
    'Bonjour, je confirme votre visite prévue samedi à 10h30. Cordialement, l’équipe de location.',
  'deposit-dispute-hi-IN':
    'नमस्ते, आपकी प्रतिभूति जमा से संबंधित विवाद के बारे में हम साधारण टूट-फूट का नियम लागू कर रहे हैं।',
  'portfolio-briefing-en-KE':
    'Dear boss, here is your overnight briefing. Autonomous actions covered arrears, maintenance, renewal and vendor payouts.',
  'tenant-welcome-zh-CN':
    '欢迎入住新居。以下是入住清单，请确认门禁、水电和物业费。如有问题请随时联系。',
  'code-switch-sw-en-KE':
    'Karibu sana! Here is the rent breakdown for this month including service charge and water.',
  'maintenance-update-pt-BR':
    'Olá, atualizando o status da manutenção do encanamento. O técnico estará no local amanhã às 9h.',
  'owner-statement-es-MX':
    'Estimado propietario, adjuntamos el estado de cuenta mensual incluyendo retenciones y gastos.',
};

function makeStubGenerator(overrides: Partial<Record<string, string>> = {}): BrainOutputGenerator {
  return {
    async generate({ testCase }: { testCase: ScriptTestCase }) {
      const key = testCase.id;
      return overrides[key] ?? STUB_RESPONSES[key] ?? 'output unavailable';
    },
  };
}

describe('multi-script-harness', () => {
  it('validates rubric weights must sum to 1', () => {
    expect(() =>
      validateRubricWeights({
        grammarWeight: 0.5,
        scriptCorrectnessWeight: 0.5,
        registerFitWeight: 0.5,
        culturalAppropriatenessWeight: 0.5,
      }),
    ).toThrowError(/weights must sum to 1/);
  });

  it('runs the baseline suite and produces a report', async () => {
    const report = await runMultiScriptAudit({
      generator: makeStubGenerator(),
      judge: heuristicJudge,
      cases: BASELINE_TEST_CASES,
      concurrency: 4,
    });

    expect(report.totalCases).toBe(BASELINE_TEST_CASES.length);
    expect(report.passed + report.failed).toBe(report.totalCases);
    expect(report.byLocale['sw-KE']).toBeDefined();
    expect(report.byScenario['rent-reminder']).toBeDefined();
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.passRate).toBeGreaterThanOrEqual(0);
    expect(report.passRate).toBeLessThanOrEqual(1);
  });

  it('captures generator failures as failed cases (not thrown)', async () => {
    const throwing: BrainOutputGenerator = {
      async generate() {
        throw new Error('upstream timeout');
      },
    };
    const report = await runMultiScriptAudit({
      generator: throwing,
      judge: heuristicJudge,
      cases: BASELINE_TEST_CASES.slice(0, 2),
    });
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.results[0].issues.length).toBeGreaterThan(0);
    expect(report.results[0].issues[0].message).toMatch(/upstream timeout/);
  });

  it('flags locales below a pass-rate threshold', async () => {
    const overrides: Record<string, string> = {
      'arrears-notice-ar-AE': 'this is an English output for an Arabic test case',
      'regulator-letter-ja-JP': 'This English output is not Japanese.',
    };
    const report = await runMultiScriptAudit({
      generator: makeStubGenerator(overrides),
      judge: heuristicJudge,
      cases: BASELINE_TEST_CASES,
    });
    const fails = failingLocales(report, 0.8);
    expect(fails).toContain('ar-AE');
    expect(fails).toContain('ja-JP');
  });

  it('honours a concurrency of 1', async () => {
    const report = await runMultiScriptAudit({
      generator: makeStubGenerator(),
      judge: heuristicJudge,
      cases: BASELINE_TEST_CASES.slice(0, 3),
      concurrency: 1,
    });
    expect(report.totalCases).toBe(3);
  });
});
