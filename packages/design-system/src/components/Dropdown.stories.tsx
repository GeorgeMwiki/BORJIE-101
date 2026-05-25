import type { Meta, StoryObj } from '@storybook/react';
import * as Dropdown from './Dropdown';

const meta: Meta = {
  title: 'Core/Dropdown',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="p-4 text-sm text-muted-foreground">
      Dropdown primitive composition — see DropdownMenu for full example.
      {Object.keys(Dropdown).length} exports available.
    </div>
  ),
};
