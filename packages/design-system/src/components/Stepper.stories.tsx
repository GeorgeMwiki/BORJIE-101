import type { Meta, StoryObj } from '@storybook/react';
import { Stepper, type StepperStep } from './Stepper';

const meta: Meta<typeof Stepper> = {
  title: 'State/Stepper',
  component: Stepper,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Stepper>;

const steps: StepperStep[] = [
  { id: 'org', label: 'Organisation', description: 'Estate details', statusLabel: 'completed' },
  { id: 'licence', label: 'Licence', description: 'Upload permits', statusLabel: 'current step' },
  { id: 'sites', label: 'Sites', description: 'Add mining sites', statusLabel: 'not started' },
  { id: 'review', label: 'Review', description: 'Confirm & submit', statusLabel: 'not started' },
];

export const Horizontal: Story = {
  render: () => (
    <div className="w-[44rem]">
      <Stepper steps={steps} current={1} label="Onboarding progress" />
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="w-72">
      <Stepper
        steps={steps}
        current={2}
        orientation="vertical"
        label="Onboarding progress"
      />
    </div>
  ),
};

export const FirstStep: Story = {
  render: () => (
    <div className="w-[44rem]">
      <Stepper steps={steps} current={0} label="Onboarding progress" />
    </div>
  ),
};

export const Complete: Story = {
  render: () => (
    <div className="w-[44rem]">
      <Stepper steps={steps} current={steps.length} label="Onboarding progress" />
    </div>
  ),
};
