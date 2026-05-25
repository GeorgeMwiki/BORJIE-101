import type { Meta, StoryObj } from '@storybook/react';
import { Avatar, AvatarImage, AvatarFallback } from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Core/Avatar',
  component: Avatar,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Avatar>;

export const WithImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="https://i.pravatar.cc/80" alt="user" />
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
  ),
};
export const Fallback: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>JS</AvatarFallback>
    </Avatar>
  ),
};
