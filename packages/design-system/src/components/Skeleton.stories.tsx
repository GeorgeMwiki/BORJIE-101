import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Core/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = { render: () => <Skeleton className="h-4 w-48" /> };
export const Card: Story = {
  render: () => (
    <div className="space-y-2">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-24 w-64" />
    </div>
  ),
};
