import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Core/Badge',
  component: Badge,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { children: 'Badge' } };
export const Success: Story = { args: { children: 'Success', variant: 'success' as never } };
export const Warning: Story = { args: { children: 'Warning', variant: 'warning' as never } };
export const Danger: Story = { args: { children: 'Danger', variant: 'destructive' as never } };
