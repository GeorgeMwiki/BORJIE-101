import type { Meta, StoryObj } from '@storybook/react';
import { Reveal, RevealGroup } from './Reveal';

/**
 * Reveal — token-driven, reduced-motion-aware scroll-reveal primitives.
 *
 * Toggle "Reduce motion" in your OS (or the Storybook a11y addon) to see the
 * primitives collapse to an instant, no-animation resting state.
 */
const meta: Meta<typeof Reveal> = {
  title: 'Motion/Reveal',
  component: Reveal,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'IntersectionObserver-based reveal. Motion resolves to the design ' +
          'system --duration-* / --ease-* tokens and fully honours ' +
          'prefers-reduced-motion (renders immediately, no animation).',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Reveal>;

const Panel = ({ label }: { label: string }) => (
  <div
    className="rounded-lg border border-border bg-card p-6 text-card-foreground"
    style={{ boxShadow: 'var(--shadow-glow)' }}
  >
    {label}
  </div>
);

export const SingleFadeUp: Story = {
  render: () => (
    <div className="max-w-md space-y-6">
      <p className="text-sm text-muted-foreground">Scroll into view to reveal.</p>
      <Reveal direction="up">
        <Panel label="I fade + slide up on enter" />
      </Reveal>
    </div>
  ),
};

export const Directions: Story = {
  render: () => (
    <div className="grid max-w-2xl grid-cols-2 gap-6">
      <Reveal direction="up">
        <Panel label="up" />
      </Reveal>
      <Reveal direction="down">
        <Panel label="down" />
      </Reveal>
      <Reveal direction="left">
        <Panel label="left" />
      </Reveal>
      <Reveal direction="right">
        <Panel label="right" />
      </Reveal>
    </div>
  ),
};

export const StaggeredGroup: Story = {
  render: () => (
    <RevealGroup className="max-w-md space-y-4" stagger={80} direction="up">
      <Panel label="First — no delay" />
      <Panel label="Second — +80ms" />
      <Panel label="Third — +160ms" />
      <Panel label="Fourth — +240ms" />
    </RevealGroup>
  ),
};
