import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Permalink, readPostQueryParam, scrollToPost } from '../components/Permalink';

describe('Permalink', () => {
  it('copies the canonical URL via the injected writer', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    render(
      <Permalink
        postId="p1"
        buildUrl={(id) => `https://borjie.test/?post=${id}`}
        writeClipboard={writeClipboard}
      />,
    );
    fireEvent.click(screen.getByTestId('permalink-p1'));
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('https://borjie.test/?post=p1');
    });
  });

  it('reads the ?post= query parameter from the URL', () => {
    window.history.replaceState({}, '', '/?post=p9');
    expect(readPostQueryParam()).toBe('p9');
  });

  it('scrollToPost is a no-op when the post is not in the DOM', () => {
    // No throw on a missing node — fundamental SSR-safe property.
    expect(() => scrollToPost('does-not-exist')).not.toThrow();
  });
});
