import { describe, it, expect } from 'vitest';
import { TextRenderer } from '../renderers/text-renderer.js';
import { RendererError } from '../renderers/renderer-interface.js';

describe('TextRenderer', () => {
  const renderer = new TextRenderer();

  it('interpolates string templates', async () => {
    const result = await renderer.render(
      { id: 'x', version: '1', source: 'Hello {{name}}' },
      { name: 'Alice' }
    );
    expect(result.buffer.toString()).toBe('Hello Alice');
    expect(result.mimeType).toBe('text/plain');
  });

  it('supports nested dot paths', async () => {
    const result = await renderer.render(
      { id: 'x', version: '1', source: '{{user.city}}' },
      { user: { city: 'Nairobi' } }
    );
    expect(result.buffer.toString()).toBe('Nairobi');
  });

  it('calls a generate function when template.source is a generator', async () => {
    const result = await renderer.render(
      {
        id: 'x',
        version: '1',
        source: { generate: (input: { n: number }) => `n=${input.n}`.trim() },
      },
      { n: 42 }
    );
    expect(result.buffer.toString()).toBe('n=42');
  });

  it('rejects an invalid template', async () => {
    await expect(
      // @ts-expect-error bad template shape
      renderer.render({ id: 'x', version: '1', source: 123 }, {})
    ).rejects.toBeInstanceOf(RendererError);
  });
});
