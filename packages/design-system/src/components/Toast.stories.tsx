import type { Meta, StoryObj } from '@storybook/react';
import * as Toast from './Toast';

const meta: Meta = {
  title: 'Core/Toast',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="p-4 text-sm text-muted-foreground">
      Toast primitives available ({Object.keys(Toast).length} exports). Compose ToastProvider, Toast, ToastTitle, ToastDescription, ToastViewport in your app shell.
    </div>
  ),
};
