import type { Meta, StoryObj } from '@storybook/react';
import { SearchableSelect } from './Select';

const meta: Meta<typeof SearchableSelect> = {
  title: 'Core/Select',
  component: SearchableSelect,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof SearchableSelect>;

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

export const Default: Story = {
  args: { options, placeholder: 'Select an option', onChange: () => {} },
};
export const WithValue: Story = {
  args: { options, value: 'b', onChange: () => {} },
};
export const Disabled: Story = {
  args: { options, disabled: true, onChange: () => {} },
};
