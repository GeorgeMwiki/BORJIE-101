import type { Meta, StoryObj } from '@storybook/react';
import * as S from './Stat';

const meta: Meta = {
  title: 'Core/Stat',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const Stat = (S as unknown as { Stat: React.FC<{ label: string; value: string }> }).Stat;
    return <Stat label="Total Revenue" value="$24,580" />;
  },
};
