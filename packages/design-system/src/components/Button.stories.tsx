import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

/**
 * Primary interactive element. Supports variants, sizes, and disabled state.
 */
const meta: Meta<typeof Button> = {
  title: 'Core/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'destructive', 'link'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Primary Action', variant: 'primary' },
};

export const Secondary: Story = {
  args: { children: 'Secondary', variant: 'secondary' },
};

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};
