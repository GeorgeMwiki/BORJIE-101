import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli-program.js';
import { generateCompletion } from '../src/commands/completion.js';
import { createLogger } from '../src/logger.js';

const silentLogger = createLogger({ json: true, noColor: true });

describe('completion script generators', () => {
  it('bash script lists top-level verbs', () => {
    const program = buildProgram({ logger: silentLogger });
    const script = generateCompletion('bash', program);
    expect(script).toContain('_borjie_completion');
    expect(script).toContain('complete -F');
    expect(script).toContain('login');
    expect(script).toContain('drafts');
    expect(script).toContain('watch');
    expect(script).toContain('agent');
  });

  it('zsh script defines _borjie + compdef', () => {
    const program = buildProgram({ logger: silentLogger });
    const script = generateCompletion('zsh', program);
    expect(script).toMatch(/#compdef borjie/);
    expect(script).toContain('_borjie');
    expect(script).toContain('login');
  });

  it('fish script defines a completion function', () => {
    const program = buildProgram({ logger: silentLogger });
    const script = generateCompletion('fish', program);
    expect(script).toContain('__borjie_complete');
    expect(script).toContain('login');
  });
});
