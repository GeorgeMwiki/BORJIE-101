import type { Meta, StoryObj } from '@storybook/react';
import * as S from './StatCard';

const meta: Meta = {
  title: 'Data/StatCard',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const StatCard = (S as unknown as {
      StatCard: React.FC<{ label: string; value: string; delta?: string }>;
    }).StatCard;
    return <StatCard label="Active leases" value="128" delta="+4.2%" />;
  },
};
