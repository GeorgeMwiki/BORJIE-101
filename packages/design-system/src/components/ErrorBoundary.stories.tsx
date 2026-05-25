import type { Meta, StoryObj } from '@storybook/react';
import { ErrorBoundary } from './ErrorBoundary';

const Bomb = () => {
  throw new Error('Boom!');
};

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Core/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

export const CatchesError: Story = {
  render: () => (
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  ),
};
export const HappyPath: Story = {
  render: () => (
    <ErrorBoundary>
      <div>Children render normally.</div>
    </ErrorBoundary>
  ),
};
