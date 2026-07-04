/**
 * Master Brain ChatPanel must render the canonical CC-12 AI-provenance
 * disclaimer (A14), the same shared @borjie/chat-ui primitive HomeChatTeach
 * wires — otherwise the master-brain chat streams AI output with no compliance
 * notice, unlike every other cockpit chat surface.
 *
 * ChatPanel pulls in a graph of `@/` client hooks (useChatSession,
 * useScrollAnchor, IncrementalMarkdown…) that do not resolve in this unit
 * environment, so we verify the wiring at source level: the component imports
 * ChatShellDisclaimer from the shared primitive and renders it in the owner's
 * ACTIVE locale.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'ChatPanel.tsx'), 'utf8');

describe('master-brain ChatPanel CC-12 disclaimer', () => {
  it('imports ChatShellDisclaimer from the shared chat-ui primitive', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*ChatShellDisclaimer[^}]*\}\s*from\s*'@borjie\/chat-ui'/,
    );
  });

  it('renders the disclaimer in the owner active locale', () => {
    expect(source).toMatch(/<ChatShellDisclaimer\s+language=\{locale\}\s*\/>/);
  });
});
