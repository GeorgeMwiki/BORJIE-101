/**
 * persona-drift/page.tsx — server-component smoke test.
 *
 * Server components render synchronously to JSX. We assert the
 * component returns a non-null element tree so the build-time
 * static-page generation has something to mount.
 */

import { describe, it, expect } from 'vitest';
import PersonaDriftPage from '../page';

describe('Phase D D7 — persona-drift admin page', () => {
  it('returns a non-null JSX element', () => {
    const element = PersonaDriftPage();
    expect(element).not.toBeNull();
    expect(element).toBeDefined();
  });
});
