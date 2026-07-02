import type { Meta, StoryObj } from '@storybook/react';
import {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
} from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'State/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = { render: () => <Skeleton className="h-4 w-48" /> };

export const Shimmer: Story = {
  render: () => <Skeleton animation="shimmer" className="h-4 w-48" />,
};

export const Circle: Story = {
  render: () => <Skeleton circle className="h-12 w-12" />,
};

export const Announced: Story = {
  name: 'Announced (localized label)',
  render: () => <Skeleton label="Loading estate summary" className="h-4 w-64" />,
};

export const Text: Story = {
  render: () => (
    <div className="w-80 space-y-6">
      <SkeletonText lines={3} />
      <SkeletonText lines={4} animation="shimmer" />
    </div>
  ),
};

export const Avatar: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <SkeletonAvatar size="sm" />
      <SkeletonAvatar size="md" />
      <SkeletonAvatar size="lg" animation="shimmer" />
    </div>
  ),
};

export const Card: Story = {
  render: () => (
    <div className="grid w-[36rem] grid-cols-2 gap-4">
      <SkeletonCard lines={2} />
      <SkeletonCard media={false} lines={3} animation="shimmer" />
    </div>
  ),
};

export const TableRows: Story = {
  render: () => (
    <table className="w-[40rem] border-separate border-spacing-0">
      <tbody>
        <SkeletonTableRow columns={4} />
        <SkeletonTableRow columns={4} animation="shimmer" />
        <SkeletonTableRow columns={4} />
      </tbody>
    </table>
  ),
};
