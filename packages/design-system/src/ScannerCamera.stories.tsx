import type { Meta, StoryObj } from '@storybook/react';
import { ScannerCamera } from './ScannerCamera';

const meta: Meta<typeof ScannerCamera> = {
  title: 'Device/ScannerCamera',
  component: ScannerCamera,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof ScannerCamera>;

export const Default: Story = {
  render: () => (
    <div className="p-4 text-sm text-muted-foreground">
      ScannerCamera requires browser media permissions. Render in a real app shell with a host page granting camera access.
    </div>
  ),
};
