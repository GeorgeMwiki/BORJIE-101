import { describe, it, expect } from 'vitest';
import {
  Budget,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_WALL_MS,
} from '../budget.js';
import type { DispatchResult } from '../decision.js';

describe('Budget', () => {
  it('starts with full headroom on every axis', () => {
    const b = Budget.of();
    const snap = b.snapshot();
    expect(snap.limits.maxTurns).toBe(DEFAULT_MAX_TURNS);
    expect(snap.limits.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(snap.limits.maxToolCalls).toBe(DEFAULT_MAX_TOOL_CALLS);
    expect(snap.limits.maxWallMs).toBe(DEFAULT_MAX_WALL_MS);
    expect(snap.exhausted).toBe(false);
    expect(snap.exhaustionAxis).toBeNull();
    expect(b.remaining()).toBe(true);
  });

  it('accumulates turns + tokens + tool calls immutably', () => {
    const b0 = Budget.of();
    const result: DispatchResult = {
      kind: 'tool_ok',
      callId: 'c1',
      output: null,
      latencyMs: 5,
      tokensIn: 100,
      tokensOut: 50,
      usdCost: 0.01,
    };
    const b1 = b0.consume(result);
    const b2 = b1.consume(result);
    // Original is untouched.
    expect(b0.snapshot().usage.turns).toBe(0);
    expect(b0.snapshot().usage.tokens).toBe(0);
    expect(b1.snapshot().usage.turns).toBe(1);
    expect(b1.snapshot().usage.tokens).toBe(150);
    expect(b1.snapshot().usage.toolCalls).toBe(1);
    expect(b1.snapshot().usage.usdCost).toBeCloseTo(0.01);
    expect(b2.snapshot().usage.tokens).toBe(300);
    expect(b2.snapshot().usage.toolCalls).toBe(2);
  });

  it('exhausts on the turns axis at the configured ceiling', () => {
    let b = Budget.of({ maxTurns: 2 });
    const response: DispatchResult = {
      kind: 'response',
      text: 'ok',
      tokensIn: 1,
      tokensOut: 1,
      usdCost: 0,
    };
    b = b.consume(response);
    b = b.consume(response);
    expect(b.exhausted()).toBe(true);
    expect(b.exhaustionAxis()).toBe('turns');
    expect(b.remaining()).toBe(false);
  });

  it('exhausts on the tokens axis when the cumulative count crosses the cap', () => {
    let b = Budget.of({ maxTurns: 100, maxTokens: 100 });
    const big: DispatchResult = {
      kind: 'tool_ok',
      callId: 'big',
      output: null,
      latencyMs: 0,
      tokensIn: 60,
      tokensOut: 60,
      usdCost: 0,
    };
    b = b.consume(big);
    expect(b.exhaustionAxis()).toBe('tokens');
  });

  it('exhausts on the wall-ms axis using the injected clock', () => {
    let now = 1_000;
    const clock = (): number => now;
    let b = Budget.of({ maxWallMs: 50 }, clock);
    expect(b.exhausted()).toBe(false);
    now += 100;
    expect(b.exhaustionAxis()).toBe('wall-ms');
  });

  it('does not count tool-call delta for response / wake results', () => {
    let b = Budget.of();
    const wake: DispatchResult = { kind: 'wake_ack', resumeToken: 't' };
    b = b.consume(wake);
    expect(b.snapshot().usage.toolCalls).toBe(0);
    expect(b.snapshot().usage.turns).toBe(1);
  });
});
