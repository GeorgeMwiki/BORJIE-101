import type { Meta, StoryObj } from '@storybook/react';
import * as P from './Progress';

const meta: Meta = {
  title: 'Core/Progress',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const AtZero: Story = {
  render: () => {
    const C = (P as unknown as { Progress: React.FC<{ value: number }> }).Progress;
    return <C value={0} />;
  },
};

export const Half: Story = {
  render: () => {
    const C = (P as unknown as { Progress: React.FC<{ value: number }> }).Progress;
    return <C value={50} />;
  },
};

export const Complete: Story = {
  render: () => {
    const C = (P as unknown as { Progress: React.FC<{ value: number }> }).Progress;
    return <C value={100} />;
  },
};
