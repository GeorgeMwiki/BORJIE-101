import { describe, expect, it } from 'vitest';
import { parseNL, parseAST } from '../parser/nl-parser.js';
import { arrearsChase } from './fixtures/arrears-chase.aop.js';
import { leaseRenewal } from './fixtures/lease-renewal.aop.js';
import { kraFiling } from './fixtures/kra-filing.aop.js';
import {
  ARREARS_CHASE_NL,
  KRA_FILING_NL,
  LEASE_RENEWAL_NL,
} from './fixtures/nl-inputs.js';
import { buildStubLLM } from './_test-helpers.js';

describe('parseNL', () => {
  it('refuses empty input', async () => {
    const llm = buildStubLLM([]);
    const result = await parseNL('', llm);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.code).toBe('empty-input');
    }
  });

  it('compiles the arrears-chase NL to the fixture AST', async () => {
    const llm = buildStubLLM([
      { contains: ARREARS_CHASE_NL.slice(0, 40), respond: arrearsChase },
    ]);
    const result = await parseNL(ARREARS_CHASE_NL, llm);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.name).toBe('monthly-arrears-chase');
      expect(result.ast.steps).toHaveLength(6);
    }
  });

  it('compiles the lease-renewal NL', async () => {
    const llm = buildStubLLM([
      { contains: LEASE_RENEWAL_NL.slice(0, 40), respond: leaseRenewal },
    ]);
    const result = await parseNL(LEASE_RENEWAL_NL, llm);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ast.trigger.kind).toBe('event');
  });

  it('compiles the kra-filing NL', async () => {
    const llm = buildStubLLM([
      { contains: KRA_FILING_NL.slice(0, 40), respond: kraFiling },
    ]);
    const result = await parseNL(KRA_FILING_NL, llm);
    expect(result.ok).toBe(true);
    if (result.ok && result.ast.trigger.kind === 'cron') {
      expect(result.ast.trigger.schedule).toBe('0 6 5 * *');
    }
  });

  it('reports invalid JSON from the LLM', async () => {
    const llm = buildStubLLM([{ contains: 'foo', respond: '{ not json' }]);
    const result = await parseNL('foo bar baz', llm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('invalid-json');
  });

  it('strips markdown fences around the LLM response', async () => {
    const llm = buildStubLLM([
      {
        contains: 'fenced',
        respond: '```json\n' + JSON.stringify(arrearsChase) + '\n```',
      },
    ]);
    const result = await parseNL('fenced input', llm);
    expect(result.ok).toBe(true);
  });

  it('flags grammar violations in the LLM output', async () => {
    const llm = buildStubLLM([
      { contains: 'bad', respond: { name: 'Bad-Name', steps: [] } as never },
    ]);
    const result = await parseNL('bad fixture', llm);
    expect(result.ok).toBe(false);
  });
});

describe('parseAST round-trip', () => {
  it.each([
    ['arrears-chase', arrearsChase],
    ['lease-renewal', leaseRenewal],
    ['kra-filing', kraFiling],
  ])('is idempotent for %s', (_name, ast) => {
    const json = JSON.stringify(ast);
    const round1 = parseAST(json);
    expect(round1.ok).toBe(true);
    if (round1.ok) {
      const round2 = parseAST(JSON.stringify(round1.ast));
      expect(round2.ok).toBe(true);
      if (round2.ok) {
        expect(round2.ast).toEqual(round1.ast);
      }
    }
  });
});
