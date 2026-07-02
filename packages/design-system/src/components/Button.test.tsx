import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, ButtonGroup, pressClasses } from './Button';

/** Install a matchMedia stub with a fixed reduced-motion preference. */
function installMatchMedia(prefersReduced: boolean): void {
  const mql = {
    matches: prefersReduced,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql as unknown as MediaQueryList),
  });
}

const ALL_VARIANTS = [
  'default',
  'primary',
  'ignite',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'danger',
  'success',
  'warning',
  'link',
] as const;

describe('Button', () => {
  const original = (window as unknown as { matchMedia?: unknown }).matchMedia;

  beforeEach(() => {
    // Motion allowed by default so the press classes are present unless a
    // test opts into reduced motion.
    installMatchMedia(false);
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    });
  });

  it('renders every variant with its label', () => {
    for (const variant of ALL_VARIANTS) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole('button', { name: variant })).toBeTruthy();
      unmount();
    }
  });

  it('gives the ignite variant the copper gradient + glow brand tokens', () => {
    render(<Button variant="ignite">Ignite</Button>);
    const el = screen.getByRole('button', { name: 'Ignite' });
    expect(el.className).toContain('bg-gradient-primary');
    expect(el.className).toContain('shadow-glow');
  });

  it('carries a crisp brand focus-visible ring on the --ring token', () => {
    render(<Button>Focus me</Button>);
    const el = screen.getByRole('button', { name: 'Focus me' });
    expect(el.className).toContain('focus-visible:ring-ring');
  });

  it('emits the press-scale micro-interaction when motion is allowed', () => {
    installMatchMedia(false);
    render(<Button variant="primary">Press</Button>);
    const el = screen.getByRole('button', { name: 'Press' });
    expect(el.className).toContain('active:scale-[0.97]');
  });

  it('DROPS the press-scale entirely under prefers-reduced-motion', () => {
    installMatchMedia(true);
    render(<Button variant="primary">Press</Button>);
    const el = screen.getByRole('button', { name: 'Press' });
    expect(el.className).not.toContain('scale-[0.97]');
    expect(el.className).not.toContain('-translate-y-px');
  });

  it('gates the press helper purely on the reduce-motion flag', () => {
    expect(pressClasses(false)).toContain('active:scale-[0.97]');
    expect(pressClasses(false)).toContain('hover:-translate-y-px');
    // Reduced motion => no transform utilities of any kind.
    expect(pressClasses(true)).toBe('');
  });

  it('keeps loading state crisp: disabled, busy, spinner, label retained', () => {
    render(
      <Button variant="ignite" loading>
        Saving
      </Button>
    );
    const el = screen.getByRole('button', { name: 'Saving' });
    expect((el as HTMLButtonElement).disabled).toBe(true);
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('svg.animate-spin')).toBeTruthy();
  });

  it('respects the disabled prop and suppresses shadow', () => {
    render(<Button disabled>Off</Button>);
    const el = screen.getByRole('button', { name: 'Off' });
    expect((el as HTMLButtonElement).disabled).toBe(true);
    expect(el.className).toContain('disabled:shadow-none');
  });

  it('groups related buttons under a role="group"', () => {
    render(
      <ButtonGroup>
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>
    );
    expect(screen.getByRole('group')).toBeTruthy();
  });
});
