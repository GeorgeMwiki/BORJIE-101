import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from './ErrorState';

const meta: Meta<typeof ErrorState> = {
  title: 'State/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj<typeof ErrorState>;

const noop = () => undefined;

export const Default: Story = {
  render: () => (
    <ErrorState
      title="Couldn't load the estate summary"
      description="Something went wrong while fetching your data. Try again in a moment."
      action={{ label: 'Retry', onClick: noop }}
    />
  ),
};

export const WithSecondaryAction: Story = {
  render: () => (
    <ErrorState
      title="Couldn't save the licence"
      description="Your changes weren't saved. Retry, or go back to review them."
      action={{ label: 'Retry', onClick: noop }}
      secondaryAction={{ label: 'Go back', onClick: noop }}
    />
  ),
};

export const Offline: Story = {
  render: () => (
    <ErrorState
      tone="offline"
      title="You're offline"
      description="Reconnect to sync your latest changes."
      action={{ label: 'Try again', onClick: noop }}
    />
  ),
};

export const Forbidden: Story = {
  render: () => (
    <ErrorState
      tone="forbidden"
      title="Access denied"
      description="You don't have permission to view this workspace."
    />
  ),
};

export const Server: Story = {
  render: () => (
    <ErrorState
      tone="server"
      title="Service unavailable"
      description="Our servers are having trouble. We're on it."
      action={{ label: 'Retry', onClick: noop }}
    />
  ),
};

export const Compact: Story = {
  render: () => (
    <div className="w-80 rounded-lg border border-border">
      <ErrorState
        compact
        title="Chart failed to load"
        action={{ label: 'Retry', onClick: noop }}
      />
    </div>
  ),
};
