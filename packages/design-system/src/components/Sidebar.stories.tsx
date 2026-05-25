import type { Meta, StoryObj } from '@storybook/react';
import { Sidebar } from './Sidebar';
import { Home, Users, Settings } from 'lucide-react';

const meta: Meta<typeof Sidebar> = {
  title: 'Core/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Sidebar>;

const items = [
  { id: 'home', label: 'Home', icon: Home, href: '/' },
  { id: 'users', label: 'Users', icon: Users, href: '/users' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

export const Default: Story = {
  args: { items: items as never, activeId: 'home' } as never,
};
