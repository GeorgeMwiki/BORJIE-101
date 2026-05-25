import type { Meta, StoryObj } from '@storybook/react';
import { Alert, AlertTitle, AlertDescription } from './Alert';

const meta: Meta<typeof Alert> = {
  title: 'Core/Alert',
  component: Alert,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Alert>;

export const Info: Story = {
  render: () => (
    <Alert>
      <AlertTitle>Info</AlertTitle>
      <AlertDescription>This is an informational alert.</AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>Something went wrong.</AlertDescription>
    </Alert>
  ),
};
