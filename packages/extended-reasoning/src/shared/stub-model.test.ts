import { describe, expect, it } from 'vitest';
import { createStubModel } from './stub-model.js';

describe('createStubModel', () => {
  it('matches by substring', async () => {
    const stub = createStubModel({
      rules: [{ match: 'hello', respond: 'world' }],
    });
    const r = await stub.call({ prompt: 'say hello to me' });
    expect(r).toBe('world');
  });

  it('matches by regex', async () => {
    const stub = createStubModel({
      rules: [{ match: /^\d+/, respond: 'numeric' }],
    });
    const r = await stub.call({ prompt: '42 is the answer' });
    expect(r).toBe('numeric');
  });

  it('matches by predicate', async () => {
    const stub = createStubModel({
      rules: [
        { match: (input) => input.tier === 'fast', respond: 'fastResp' },
      ],
    });
    const r = await stub.call({ prompt: 'whatever', tier: 'fast' });
    expect(r).toBe('fastResp');
  });

  it('rule respond can be a function', async () => {
    const stub = createStubModel({
      rules: [{ match: 'q', respond: (input) => `echo: ${input.prompt}` }],
    });
    const r = await stub.call({ prompt: 'q!' });
    expect(r).toBe('echo: q!');
  });

  it('throws if no rule matches and no defaultResponse', async () => {
    const stub = createStubModel({ rules: [{ match: 'apple', respond: 'A' }] });
    await expect(stub.call({ prompt: 'orange' })).rejects.toThrow(/no rule matched/);
  });

  it('uses defaultResponse on miss', async () => {
    const stub = createStubModel({
      rules: [{ match: 'apple', respond: 'A' }],
      defaultResponse: 'fallback',
    });
    const r = await stub.call({ prompt: 'orange' });
    expect(r).toBe('fallback');
  });

  it('tracks per-rule call counts', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'a', respond: 'A' },
        { match: 'b', respond: 'B' },
      ],
    });
    await stub.call({ prompt: 'a' });
    await stub.call({ prompt: 'a' });
    await stub.call({ prompt: 'b' });
    expect(stub.callCount()).toBe(3);
    expect(stub.callsMatchingRule(0)).toBe(2);
    expect(stub.callsMatchingRule(1)).toBe(1);
  });
});
