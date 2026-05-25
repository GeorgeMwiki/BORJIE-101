import type { Meta, StoryObj } from '@storybook/react';
import { SimpleDataGrid } from './DataGrid';

const meta: Meta<typeof SimpleDataGrid> = {
  title: 'Core/DataGrid',
  component: SimpleDataGrid,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof SimpleDataGrid>;

const data = [
  { id: '1', name: 'Alice', email: 'a@x.co' },
  { id: '2', name: 'Bob', email: 'b@x.co' },
];

export const Default: Story = {
  args: {
    data,
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'email', header: 'Email' },
    ],
  } as never,
};
