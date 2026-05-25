import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './Tooltip';
import { Button } from './Button';

const meta: Meta = {
  title: 'Core/Tooltip',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
