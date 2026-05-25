/**
 * Intent classifier tests — heuristic regex + LLM-fallback wiring.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyIntentHeuristic,
  createIntentClassifier,
} from '../intent-classifier.js';

describe('classifyIntentHeuristic', () => {
  it('detects propose_action from "wants to lease"', () => {
    const r = classifyIntentHeuristic({
      user_text: 'Mr Juma wants to lease godown 3 for 350k/month from Jan',
      assistant_text: 'I see — would you like to start a lease application?',
      persona_id: 'trc-emu-officer',
    });
    expect(r.intent).toBe('propose_action');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('detects request_info from "what is the rent"', () => {
    const r = classifyIntentHeuristic({
      user_text: 'What is the rent for godown 3?',
      assistant_text: 'The rent for godown 3 is TZS 350,000 per month.',
      persona_id: 'trc-emu-officer',
    });
    expect(r.intent).toBe('request_info');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('detects file_event from "I just paid"', () => {
    const r = classifyIntentHeuristic({
      user_text: 'I just paid 350000 for the September rent',
      assistant_text: 'Got it. Recording the payment received.',
      persona_id: 'tenant-resident',
    });
    expect(r.intent).toBe('file_event');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('detects ask_for_help from "stuck/help"', () => {
    const r = classifyIntentHeuristic({
      user_text: 'I am stuck — what should I do about my missing receipt?',
      assistant_text: 'Let me suggest a few options.',
      persona_id: 'tenant-resident',
    });
    expect(r.intent).toBe('ask_for_help');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('returns ambiguous when no keywords match', () => {
    const r = classifyIntentHeuristic({
      user_text: 'X Y Z',
      assistant_text: 'A B C',
      persona_id: 'trc-emu-officer',
    });
    expect(r.intent).toBe('ambiguous');
    expect(r.confidence).toBeLessThanOrEqual(0.4);
  });

  it('handles Swahili "nataka" → propose_action', () => {
    const r = classifyIntentHeuristic({
      user_text: 'Nataka kupanga godown 3',
      assistant_text: 'Sawa, tutaanza maombi.',
      persona_id: 'tenant-resident',
    });
    expect(r.intent).toBe('propose_action');
  });
});

describe('createIntentClassifier', () => {
  it('caches identical args', async () => {
    const fallback = vi.fn();
    const classifier = createIntentClassifier({ fallback });
    const args = {
      user_text: 'Mr Juma wants to lease godown 3',
      assistant_text: 'Sure, I will create the application.',
      persona_id: 'p1',
    };
    const a = await classifier(args);
    const b = await classifier(args);
    expect(a).toEqual(b);
    expect(fallback).not.toHaveBeenCalled(); // heuristic resolved
  });

  it('escalates ambiguous to LLM fallback', async () => {
    const fallback = vi.fn().mockResolvedValue({
      intent: 'propose_action',
      confidence: 0.9,
    });
    const classifier = createIntentClassifier({ fallback });
    const result = await classifier({
      user_text: 'X Y Z',
      assistant_text: 'A B C',
      persona_id: 'p1',
    });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe('propose_action');
    expect(result.confidence).toBe(0.9);
  });

  it('falls back to heuristic when LLM throws', async () => {
    const fallback = vi.fn().mockRejectedValue(new Error('llm down'));
    const classifier = createIntentClassifier({ fallback });
    const r = await classifier({
      user_text: 'X Y Z',
      assistant_text: 'A B C',
      persona_id: 'p1',
    });
    expect(r.intent).toBe('ambiguous');
  });

  it('disableCache forces recomputation', async () => {
    const classifier = createIntentClassifier({ disableCache: true });
    const a = await classifier({
      user_text: 'Mr Juma wants to lease',
      assistant_text: 'OK',
      persona_id: 'p1',
    });
    const b = await classifier({
      user_text: 'Mr Juma wants to lease',
      assistant_text: 'OK',
      persona_id: 'p1',
    });
    expect(a.intent).toBe(b.intent);
  });
});
