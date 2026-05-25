import type { Meta, StoryObj } from '@storybook/react';
import { Separator } from './Separator';

const meta: Meta<typeof Separator> = {
  title: 'Core/Separator',
  component: Separator,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Separator>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p>Above</p>
      <Separator />
      <p>Below</p>
    </div>
  ),
};
export const Vertical: Story = {
  render: () => (
    <div className="flex h-12 items-center">
      <span>Left</span>
      <Separator orientation="vertical" className="mx-2" />
      <span>Right</span>
    </div>
  ),
};
