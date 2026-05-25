import type { Meta, StoryObj } from '@storybook/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './Table';

const meta: Meta<typeof Table> = {
  title: 'Core/Table',
  component: Table,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Table>;

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Alice</TableCell>
          <TableCell>Active</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Bob</TableCell>
          <TableCell>Pending</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
