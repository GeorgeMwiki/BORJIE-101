import type { Meta, StoryObj } from '@storybook/react';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './Dialog';
import { Button } from './Button';

const meta: Meta = {
  title: 'Core/Dialog',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dialog Title</DialogTitle>
          <DialogDescription>Dialog description text.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
};
