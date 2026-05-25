/**
 * MigrationWizardCopilot — parseAIResponse contract.
 *
 * Full integration against a real AI provider is covered elsewhere. These
 * tests lock in the typed output shape the orchestrator depends on.
 */

import { describe, it, expect } from 'vitest';
import { MigrationWizardCopilot } from '../migration-wizard.copilot.js';
import { RiskLevel } from '../../types/core.types.js';

describe('MigrationWizardCopilot.parseAIResponse', () => {
  // Access protected member via a subclass for test-only visibility.
  class Exposed extends MigrationWizardCopilot {
    public invokeParse(
      content: string,
      requestId: string
    ) {
      return (this as unknown as {
        parseAIResponse: (r: { content: string }, i: unknown, id: string) => unknown;
      }).parseAIResponse({ content }, null, requestId);
    }
  }

  const copilot = new Exposed(
    {} as never,
    {} as never,
    {} as never
  );

  it('returns commit proposedAction for a well-formed response', () => {
    const content = JSON.stringify({
      narrative: '3 properties, 12 units ready.',
      proposedAction: { kind: 'commit', runId: 'run_1', risk: RiskLevel.HIGH },
      confidence: 0.85,
    });
    const result = copilot.invokeParse(content, 'req_1') as {
      success: boolean;
      data?: { proposedAction: { kind: string }; riskLevel: RiskLevel };
    };
    expect(result.success).toBe(true);
    expect(result.data?.proposedAction.kind).toBe('commit');
    expect(result.data?.riskLevel).toBe(RiskLevel.HIGH);
  });

  it('rejects response with missing proposedAction', () => {
    const content = JSON.stringify({ narrative: 'ok' });
    const result = copilot.invokeParse(content, 'req_2') as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects response with unknown proposedAction.kind', () => {
    const content = JSON.stringify({
      narrative: 'ok',
      proposedAction: { kind: 'banana' },
    });
    const result = copilot.invokeParse(content, 'req_3') as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
  });
});
