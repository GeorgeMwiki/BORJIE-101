/**
 * Constitutional critic — unit tests.
 *
 * Coverage (6+):
 *   1. heuristic scorer auto-passes a reflection mentioning no rule
 *      category keywords
 *   2. heuristic scorer flags a reflection containing a TZ Rental
 *      Act keyword (eviction) with score 0.5
 *   3. heuristic scorer flags a GDPR-relevant reflection (phone)
 *   4. Claude path: parses a well-formed JSON-array response
 *   5. Claude path: malformed response → backfilled with auto-pass
 *   6. Claude path: SDK throw → falls back to heuristic
 *   7. passThreshold gates `verdict.passed`
 *   8. modelId is included in the verdict when Claude is wired
 */

import { describe, it, expect } from 'vitest';
import {
  createConstitutionalCritic,
  BORJIE_CONSTITUTION,
  type AnthropicClientLike,
} from '../constitutional-critic.js';

function reflection(text: string) {
  return {
    clusterId: 'c-1',
    tenantId: 't-1' as string | null,
    text,
    intentLabel: 'test',
  };
}

describe('constitutional-critic — heuristic path', () => {
  it('auto-passes a benign reflection', async () => {
    const critic = createConstitutionalCritic();
    const v = await critic.score(reflection('skill ran successfully, no issues'));
    expect(v.overall).toBe(1);
    expect(v.passed).toBe(true);
  });

  it('flags a TZ Rental Act keyword (eviction) at 0.5', async () => {
    const critic = createConstitutionalCritic();
    const v = await critic.score(
      reflection('User asked about eviction process for non-paying tenant.'),
    );
    const tzScores = v.scores.filter((s) =>
      BORJIE_CONSTITUTION.find(
        (r) => r.id === s.ruleId && r.category === 'tz-rental-act',
      ),
    );
    expect(tzScores.some((s) => s.score === 0.5)).toBe(true);
  });

  it('flags GDPR-relevant keyword (phone)', async () => {
    const critic = createConstitutionalCritic();
    const v = await critic.score(
      reflection("Found tenant's phone number in trace summary"),
    );
    const gdprScores = v.scores.filter((s) =>
      BORJIE_CONSTITUTION.find(
        (r) => r.id === s.ruleId && r.category === 'gdpr-pdpa',
      ),
    );
    expect(gdprScores.some((s) => s.score === 0.5)).toBe(true);
  });
});

describe('constitutional-critic — Claude path', () => {
  it('parses a well-formed JSON-array response', async () => {
    const client: AnthropicClientLike = {
      messages: {
        async create() {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  BORJIE_CONSTITUTION.map((r) => ({
                    ruleId: r.id,
                    score: 0.9,
                    rationale: 'looks fine',
                  })),
                ),
              },
            ],
            model: 'claude-haiku-4-5',
          };
        },
      },
    };
    const critic = createConstitutionalCritic({ anthropicClient: client });
    const v = await critic.score(reflection('Some reflection text.'));
    expect(v.scores.every((s) => s.score === 0.9)).toBe(true);
    expect(v.overall).toBeCloseTo(0.9, 2);
    expect(v.modelId).toBe('claude-haiku-4-5');
  });

  it('malformed Claude response → unscored rules auto-pass', async () => {
    const client: AnthropicClientLike = {
      messages: {
        async create() {
          return {
            content: [{ type: 'text', text: 'Sorry, no JSON for you.' }],
          };
        },
      },
    };
    const critic = createConstitutionalCritic({ anthropicClient: client });
    const v = await critic.score(reflection('test'));
    expect(v.overall).toBe(1);
  });

  it('Claude SDK throw → falls back to heuristic', async () => {
    const client: AnthropicClientLike = {
      messages: {
        async create() {
          throw new Error('rate limited');
        },
      },
    };
    const critic = createConstitutionalCritic({ anthropicClient: client });
    const v = await critic.score(reflection('eviction discussed'));
    // Heuristic should fire (eviction keyword)
    expect(v.scores.some((s) => s.score < 1)).toBe(true);
  });

  it('passThreshold gates verdict.passed', async () => {
    const client: AnthropicClientLike = {
      messages: {
        async create() {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  BORJIE_CONSTITUTION.map((r) => ({
                    ruleId: r.id,
                    score: 0.5,
                    rationale: '',
                  })),
                ),
              },
            ],
          };
        },
      },
    };
    const strict = createConstitutionalCritic({
      anthropicClient: client,
      passThreshold: 0.8,
    });
    const lax = createConstitutionalCritic({
      anthropicClient: client,
      passThreshold: 0.3,
    });
    const strictV = await strict.score(reflection('t'));
    const laxV = await lax.score(reflection('t'));
    expect(strictV.passed).toBe(false);
    expect(laxV.passed).toBe(true);
  });
});
