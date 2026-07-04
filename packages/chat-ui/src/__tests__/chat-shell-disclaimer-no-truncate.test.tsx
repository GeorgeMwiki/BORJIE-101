/**
 * ChatShellDisclaimer must NEVER single-line-ellipsis the CC-12 compliance
 * notice (B2). The SW copy (~93 chars) clips mid-sentence at compact chat
 * width when the paragraph carries `truncate`, so the shared primitive has to
 * let the legal string wrap. We assert the notice paragraph does not carry the
 * `truncate` class in either locale.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ChatShellDisclaimer } from '../litfin-primitives';

function disclaimerParagraph(language: 'en' | 'sw'): HTMLParagraphElement {
  const { container } = render(<ChatShellDisclaimer language={language} />);
  const note = container.querySelector('[role="note"]');
  expect(note).not.toBeNull();
  const paragraph = note!.querySelector('p');
  expect(paragraph).not.toBeNull();
  return paragraph as HTMLParagraphElement;
}

describe('ChatShellDisclaimer compliance notice never truncates', () => {
  it('does not apply the truncate class in en', () => {
    const paragraph = disclaimerParagraph('en');
    expect(paragraph.className).not.toContain('truncate');
  });

  it('does not apply the truncate class in sw', () => {
    const paragraph = disclaimerParagraph('sw');
    expect(paragraph.className).not.toContain('truncate');
    // The full SW legal sentence must render intact (no mid-sentence clip).
    expect(paragraph.textContent).toContain('mmiliki wa mgodi');
  });
});
