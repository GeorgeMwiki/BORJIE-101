import type { Meta, StoryObj } from '@storybook/react';
import { Label } from './Label';

const meta: Meta<typeof Label> = {
  title: 'Core/Label',
  component: Label,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = { args: { children: 'Field label' } };
export const Required: Story = {
  render: () => (
    <Label>
      Email <span className="text-red-500">*</span>
    </Label>
  ),
};
