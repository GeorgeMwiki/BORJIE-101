import type { Meta, StoryObj } from '@storybook/react';
import * as H from './Header';

const meta: Meta = {
  title: 'Core/Header',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const Header = (H as unknown as { Header: React.FC<{ title?: string }> }).Header;
    return <Header title="Page Title" />;
  },
};
