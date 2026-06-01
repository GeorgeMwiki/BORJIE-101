import { describe, expect, it } from 'vitest';
import { parseNL, parseAST } from '../parser/nl-parser.js';
import { royaltyArrearsChase } from './fixtures/royalty-arrears-chase.aop.js';
import { offtakeRenewal } from './fixtures/offtake-renewal.aop.js';
import { traFiling } from './fixtures/tra-filing.aop.js';
import {
  ROYALTY_ARREARS_CHASE_NL,
  TRA_FILING_NL,
  OFFTAKE_RENEWAL_NL,
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

  it('compiles the royalty-arrears-chase NL to the fixture AST', async () => {
    const llm = buildStubLLM([
      {
        contains: ROYALTY_ARREARS_CHASE_NL.slice(0, 40),
        respond: royaltyArrearsChase,
      },
    ]);
    const result = await parseNL(ROYALTY_ARREARS_CHASE_NL, llm);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.name).toBe('monthly-royalty-arrears-chase');
      expect(result.ast.steps).toHaveLength(6);
    }
  });

  it('compiles the offtake-renewal NL', async () => {
    const llm = buildStubLLM([
      { contains: OFFTAKE_RENEWAL_NL.slice(0, 40), respond: offtakeRenewal },
    ]);
    const result = await parseNL(OFFTAKE_RENEWAL_NL, llm);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ast.trigger.kind).toBe('event');
  });

  it('compiles the tra-filing NL', async () => {
    const llm = buildStubLLM([
      { contains: TRA_FILING_NL.slice(0, 40), respond: traFiling },
    ]);
    const result = await parseNL(TRA_FILING_NL, llm);
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
        respond: '```json\n' + JSON.stringify(royaltyArrearsChase) + '\n```',
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
    ['royalty-arrears-chase', royaltyArrearsChase],
    ['offtake-renewal', offtakeRenewal],
    ['tra-filing', traFiling],
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
