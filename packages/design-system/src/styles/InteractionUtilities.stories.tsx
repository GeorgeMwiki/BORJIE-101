import type { Meta, StoryObj } from '@storybook/react';

/**
 * Proof surface for the Borjie interaction utility layer added to
 * `styles/globals.css`. Every class below is token-driven (motion,
 * easing, copper-glow tokens) and neutralizes under
 * `prefers-reduced-motion`. This story exists to prove the utilities
 * render and are visually exercisable — hover the cards, press the
 * buttons, tab through to see the focus rings.
 */
const meta: Meta = {
  title: 'Foundations/Interaction Utilities',
  parameters: {
    docs: {
      description: {
        component:
          'hover-lift · press-scale · reveal · celebrate · pulse-attention · focus-ring · sr-only(-focusable). All token-driven, all reduced-motion + high-contrast + forced-colors aware.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const cardBase =
  'rounded-lg border border-border bg-card p-4 shadow-sm text-card-foreground';

export const MotionPrimitives: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <section className="flex flex-wrap gap-4">
        <div className={`${cardBase} hover-lift focus-ring w-56`} tabIndex={0}>
          <p className="font-medium">hover-lift</p>
          <p className="text-sm text-muted-foreground">
            Rises + gains copper glow on hover. Tab to me for the ring.
          </p>
        </div>
        <div className={`${cardBase} reveal w-56`}>
          <p className="font-medium">reveal</p>
          <p className="text-sm text-muted-foreground">Fades up on mount.</p>
        </div>
        <div className={`${cardBase} celebrate w-56`}>
          <p className="font-medium">celebrate</p>
          <p className="text-sm text-muted-foreground">One-shot copper pulse.</p>
        </div>
        <div className={`${cardBase} pulse-attention w-56`}>
          <p className="font-medium">pulse-attention</p>
          <p className="text-sm text-muted-foreground">Recurring soft ring.</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="press-scale focus-ring rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          press-scale button
        </button>
        <button
          type="button"
          className="hover-lift press-scale focus-ring rounded-md border border-border bg-surface px-4 py-2"
        >
          hover-lift + press-scale
        </button>
      </section>

      <section className={`${cardBase} focus-ring-inset w-full`} tabIndex={0}>
        <p className="font-medium">focus-ring-inset</p>
        <p className="text-sm text-muted-foreground">
          Inset ring for overflow-clipped rows. Tab to me.
        </p>
      </section>
    </div>
  ),
};

export const ScreenReaderOnly: Story = {
  render: () => (
    <div className="relative p-6">
      <a
        href="#content"
        className="sr-only-focusable rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        Skip to content
      </a>
      <p className="text-sm text-muted-foreground">
        A visually hidden skip-link precedes this text. Press Tab to reveal it.
      </p>
      <p id="content" className="mt-4">
        Content target.{' '}
        <span className="sr-only">
          This label is only announced to screen readers.
        </span>
      </p>
    </div>
  ),
};
