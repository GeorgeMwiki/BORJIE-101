import type { Meta, StoryObj } from '@storybook/react';
import * as F from './FormField';

const meta: Meta = {
  title: 'Form/FormField',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const FormField = (F as unknown as { FormField: React.FC<{ label: string; children: React.ReactNode }> }).FormField;
    return (
      <FormField label="Email">
        <input className="border rounded px-2 py-1" placeholder="you@example.com" />
      </FormField>
    );
  },
};
