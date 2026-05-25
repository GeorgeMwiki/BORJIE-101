import { describe, expect, it } from 'vitest';
import { runConstitutionalCritique } from '../single-agent/constitutional-critique.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('runConstitutionalCritique', () => {
  it('returns the draft unchanged when no violations are found', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: JSON.stringify({ violations: [], summary: 'all good' }),
          stopReason: 'end_turn',
        },
      ],
    });
    const result = await runConstitutionalCritique({
      agent: makeAgent(),
      draft: 'Hello, this is fine.',
      brain,
      principles: ['Be polite', 'Do not lie'],
    });
    expect(result.changed).toBe(false);
    expect(result.revised).toBe('Hello, this is fine.');
    expect(result.critique).toBe('all good');
  });

  it('produces a revised draft when violations are present', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: JSON.stringify({
            violations: [
              { principle: 'Be polite', evidence: 'shut up' },
            ],
            summary: 'rude tone',
          }),
          stopReason: 'end_turn',
        },
        { text: 'Hello, please listen.', stopReason: 'end_turn' },
      ],
    });
    const result = await runConstitutionalCritique({
      agent: makeAgent(),
      draft: 'shut up and listen',
      brain,
      principles: ['Be polite'],
    });
    expect(result.changed).toBe(true);
    expect(result.revised).toBe('Hello, please listen.');
    expect(result.critique).toBe('rude tone');
  });

  it('fails closed when the critic returns unparseable JSON (failClosed default)', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'not json at all', stopReason: 'end_turn' }],
    });
    const result = await runConstitutionalCritique({
      agent: makeAgent(),
      draft: 'whatever',
      brain,
      principles: ['x'],
    });
    expect(result.changed).toBe(false);
    expect(result.revised).toBe('whatever');
  });

  it('tolerates fenced ```json blocks in the critic response', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: 'Here is the analysis:\n```json\n{"violations":[],"summary":"clean"}\n```\nDone.',
          stopReason: 'end_turn',
        },
      ],
    });
    const result = await runConstitutionalCritique({
      agent: makeAgent(),
      draft: 'whatever',
      brain,
      principles: ['x'],
    });
    expect(result.changed).toBe(false);
    expect(result.critique).toBe('clean');
  });
});
