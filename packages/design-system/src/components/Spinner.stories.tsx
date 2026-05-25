import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Core/Spinner',
  component: Spinner,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = { render: () => <Spinner /> };
export const Small: Story = { render: () => <Spinner className="h-4 w-4" /> };
export const Large: Story = { render: () => <Spinner className="h-10 w-10" /> };
