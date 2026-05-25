import { describe, expect, it } from 'vitest';

import {
  applyEditProposal,
  parseDiff,
  proposeMinimalDiff,
  verifyDiffNoSideEffects,
} from './index.js';
import type { EditProposal } from '../types.js';
import { createMockBrain } from '../__tests__/fixtures/setup.js';

const SR_RESPONSE = `Rationale: rename foo to bar in greet().

<<<<<<< SEARCH
function greet(foo: string) {
  return 'hi ' + foo;
}
=======
function greet(bar: string) {
  return 'hi ' + bar;
}
>>>>>>> REPLACE`;

describe('minimal-diff-editing :: parseDiff', () => {
  it('parses search-replace blocks', () => {
    const diff = parseDiff('search-replace', SR_RESPONSE);
    expect(diff.dialect).toBe('search-replace');
    expect(diff.searchReplaceBlocks).toHaveLength(1);
    expect(diff.searchReplaceBlocks?.[0]?.search).toContain('foo: string');
    expect(diff.searchReplaceBlocks?.[0]?.replace).toContain('bar: string');
  });

  it('parses unified-diff (fenced)', () => {
    const text = '```diff\n@@ -1 +1 @@\n-old\n+new\n```';
    const diff = parseDiff('unified', text);
    expect(diff.dialect).toBe('unified');
    expect(diff.unifiedDiff).toContain('@@ -1 +1 @@');
  });

  it('parses ast-aware fenced JSON', () => {
    const text = '```json\n{"ops":[]}\n```';
    const diff = parseDiff('ast-aware', text);
    expect(diff.astMutations).toContain('"ops":[]');
  });

  it('handles multiple SEARCH/REPLACE blocks in one response', () => {
    const text = `<<<<<<< SEARCH\nA\n=======\nA1\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nB\n=======\nB1\n>>>>>>> REPLACE`;
    const diff = parseDiff('search-replace', text);
    expect(diff.searchReplaceBlocks).toHaveLength(2);
  });
});

describe('minimal-diff-editing :: proposeMinimalDiff', () => {
  it('calls brain with intent + file and parses the response', async () => {
    const brain = createMockBrain({ responses: [SR_RESPONSE] });
    const proposal = await proposeMinimalDiff({
      filePath: 'src/foo.ts',
      before: `function greet(foo: string) {\n  return 'hi ' + foo;\n}\n`,
      intent: 'rename foo to bar',
      brain,
    });
    expect(brain.calls).toHaveLength(1);
    expect(brain.calls[0]?.prompt).toContain('rename foo to bar');
    expect(brain.calls[0]?.prompt).toContain('src/foo.ts');
    expect(proposal.filePath).toBe('src/foo.ts');
    expect(proposal.rationale).toContain('rename foo to bar');
    expect(proposal.diff.searchReplaceBlocks).toHaveLength(1);
  });

  it('truncates context that exceeds maxContextChars', async () => {
    const brain = createMockBrain({ responses: [SR_RESPONSE] });
    const big = 'x'.repeat(5000);
    await proposeMinimalDiff({
      filePath: 'src/big.ts',
      before: big,
      intent: 'trim',
      brain,
      maxContextChars: 200,
    });
    const sent = brain.calls[0]?.prompt ?? '';
    expect(sent).toContain('[truncated]');
    expect(sent.length).toBeLessThan(big.length);
  });
});

describe('minimal-diff-editing :: applyEditProposal', () => {
  const before = `function greet(foo: string) {\n  return 'hi ' + foo;\n}\n`;

  function makeProposal(text: string, dialect: 'search-replace' | 'unified' = 'search-replace'): EditProposal {
    return {
      filePath: 'src/foo.ts',
      intent: 'rename',
      diff: parseDiff(dialect, text),
    };
  }

  it('applies a clean search/replace block and preserves untouched lines', () => {
    const proposal = makeProposal(SR_RESPONSE);
    const after = `function greet(bar: string) {\n  return 'hi ' + bar;\n}\n`;
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.conflicts).toHaveLength(0);
    expect(result.appliedHunks).toBe(1);
    expect(result.newBytes).toBe(after);
  });

  it('reports search-not-found conflict', () => {
    const proposal = makeProposal(
      `<<<<<<< SEARCH\nnonexistent\n=======\nreplaced\n>>>>>>> REPLACE`,
    );
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.conflicts[0]?.kind).toBe('search-not-found');
    expect(result.appliedHunks).toBe(0);
    expect(result.newBytes).toBe(before);
  });

  it('reports ambiguous conflict when SEARCH matches multiple times', () => {
    const source = `x = 1;\nx = 1;\n`;
    const proposal = makeProposal(
      `<<<<<<< SEARCH\nx = 1;\n=======\ny = 2;\n>>>>>>> REPLACE`,
    );
    const result = applyEditProposal({ proposal, fileBytes: source });
    expect(result.conflicts[0]?.kind).toBe('ambiguous');
    expect(result.newBytes).toBe(source);
  });

  it('rejects empty proposal (no parsed blocks)', () => {
    const proposal = makeProposal('no blocks here');
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.conflicts[0]?.kind).toBe('patch-rejected');
  });

  it('applies a simple unified-diff hunk', () => {
    const proposal = makeProposal(
      `@@ -1,1 +1,1 @@\n-function greet(foo: string) {\n+function greet(bar: string) {`,
      'unified',
    );
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.appliedHunks).toBe(1);
    expect(result.newBytes.startsWith('function greet(bar: string) {')).toBe(true);
  });

  it('reports patch-rejected on context mismatch in unified diff', () => {
    const proposal = makeProposal(
      `@@ -1,1 +1,1 @@\n-this line does not exist\n+replacement`,
      'unified',
    );
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.conflicts[0]?.kind).toBe('patch-rejected');
  });

  it('rejects ast-aware diff when no adapter is supplied', () => {
    const proposal: EditProposal = {
      filePath: 'src/foo.ts',
      intent: 'rename',
      diff: { dialect: 'ast-aware', astMutations: '{"ops":[]}' },
    };
    const result = applyEditProposal({ proposal, fileBytes: before });
    expect(result.conflicts[0]?.kind).toBe('patch-rejected');
    expect(result.conflicts[0]?.detail).toContain('astAdapter');
  });

  it('runs ast-aware diff through an injected adapter', () => {
    const proposal: EditProposal = {
      filePath: 'src/foo.ts',
      intent: 'rename',
      diff: { dialect: 'ast-aware', astMutations: '{}' },
    };
    const result = applyEditProposal({
      proposal,
      fileBytes: before,
      astAdapter: { apply: () => 'mutated source' },
    });
    expect(result.newBytes).toBe('mutated source');
    expect(result.appliedHunks).toBe(1);
  });
});

describe('minimal-diff-editing :: verifyDiffNoSideEffects', () => {
  it('flags focused diffs (small percent changed, no extra files)', () => {
    const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 5', 'LINE FIVE');
    const report = verifyDiffNoSideEffects({ before, after });
    expect(report.isFocused).toBe(true);
    expect(report.unexpectedLineChanges).toBe(1);
  });

  it('flags non-focused diffs (over threshold)', () => {
    const before = `a\nb\nc\nd\ne\n`;
    const after = `1\n2\n3\n4\n5\n`;
    const report = verifyDiffNoSideEffects({ before, after, nonFocusedPercent: 10 });
    expect(report.isFocused).toBe(false);
    expect(report.unexpectedLineChanges).toBe(5);
  });

  it('flags unexpected file touches', () => {
    const report = verifyDiffNoSideEffects({
      before: '',
      after: '',
      intendedFilePaths: ['src/foo.ts'],
      otherFileChanges: ['src/foo.ts', 'src/bar.ts'],
    });
    expect(report.unexpectedFilesTouched).toEqual(['src/bar.ts']);
    expect(report.isFocused).toBe(false);
  });
});
