import type { Meta, StoryObj } from '@storybook/react';
import * as P from './Pagination';

const meta: Meta = {
  title: 'Core/Pagination',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="p-4 text-sm text-muted-foreground">
      Pagination primitives available ({Object.keys(P).length} exports). Compose Pagination, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext.
    </div>
  ),
};
