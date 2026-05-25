import type { Meta, StoryObj } from '@storybook/react';
import { Input, Textarea } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Core/Input',
  component: Input,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = { args: { placeholder: 'Enter text...' } };
export const WithValue: Story = { args: { defaultValue: 'Hello world' } };
export const Disabled: Story = { args: { disabled: true, value: 'Readonly' } };
export const TextareaVariant: StoryObj<typeof Textarea> = {
  render: () => <Textarea placeholder="Multiline input" rows={4} />,
};
