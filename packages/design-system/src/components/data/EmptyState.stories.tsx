import type { Meta, StoryObj } from '@storybook/react';
import * as E from './EmptyState';

const meta: Meta = {
  title: 'Data/EmptyState',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const EmptyState = (E as unknown as {
      EmptyState: React.FC<{ title?: string; description?: string }>;
    }).EmptyState;
    return <EmptyState title="No data" description="You haven't added any records yet." />;
  },
};
