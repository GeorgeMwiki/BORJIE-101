import type { Meta, StoryObj } from '@storybook/react';
import * as D from './DataTable';

const meta: Meta = {
  title: 'Data/DataTable',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const DataTable = (D as unknown as {
      DataTable: React.FC<{ columns: { key: string; header: string }[]; data: Record<string, unknown>[] }>;
    }).DataTable;
    return (
      <DataTable
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'role', header: 'Role' },
        ]}
        data={[
          { name: 'Alice', role: 'Admin' },
          { name: 'Bob', role: 'User' },
        ]}
      />
    );
  },
};
