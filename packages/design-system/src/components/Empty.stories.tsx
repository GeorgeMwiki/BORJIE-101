import type { Meta, StoryObj } from '@storybook/react';
import * as E from './Empty';

const meta: Meta = {
  title: 'Core/Empty',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const Empty = (E as unknown as { Empty: React.FC<{ title?: string; description?: string }> }).Empty;
    return <Empty title="No results" description="Try adjusting your filters." />;
  },
};
