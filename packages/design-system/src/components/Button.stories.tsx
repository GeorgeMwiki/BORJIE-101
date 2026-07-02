import type { Meta, StoryObj } from '@storybook/react';
import { Button, ButtonGroup } from './Button';

/**
 * Primary interactive element. Supports variants, sizes, loading and disabled
 * states. Solid variants carry a subtle inner-highlight gloss and a copper
 * hover glow; `ignite` is the premium hero CTA (copper gradient + glow). The
 * press-scale and hover-lift micro-interactions honour prefers-reduced-motion
 * via Tailwind's `motion-safe:` gate.
 */
const meta: Meta<typeof Button> = {
  title: 'Core/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
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
      ],
    },
    size: {
      control: 'select',
      options: ['sm', 'default', 'lg', 'xl', 'icon', 'icon-sm', 'icon-lg'],
    },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Primary Action', variant: 'primary' },
};

/** IGNITION — the premium copper-gradient hero CTA. */
export const Ignite: Story = {
  args: { children: 'Ignite', variant: 'ignite', size: 'lg' },
};

export const Secondary: Story = {
  args: { children: 'Secondary', variant: 'secondary' },
};

export const Outline: Story = {
  args: { children: 'Outline', variant: 'outline' },
};

export const Ghost: Story = {
  args: { children: 'Ghost', variant: 'ghost' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Loading: Story = {
  args: { children: 'Saving', variant: 'primary', loading: true },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};

/** Every variant rendered together — proves the full API surface paints. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="ignite">Ignite</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="success">Success</Button>
      <Button variant="warning">Warning</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

/** Every size, including WCAG-target-size icon buttons. */
export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ignite" size="sm">
        Small
      </Button>
      <Button variant="ignite" size="default">
        Default
      </Button>
      <Button variant="ignite" size="lg">
        Large
      </Button>
      <Button variant="ignite" size="xl">
        Extra Large
      </Button>
    </div>
  ),
};

export const Grouped: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="outline">Left</Button>
      <Button variant="outline">Middle</Button>
      <Button variant="outline">Right</Button>
    </ButtonGroup>
  ),
};
