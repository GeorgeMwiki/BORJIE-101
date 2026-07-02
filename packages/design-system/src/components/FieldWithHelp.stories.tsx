import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FieldWithHelp } from './FieldWithHelp';
import { Input } from './Input';

const meta: Meta<typeof FieldWithHelp> = {
  title: 'Form/FieldWithHelp',
  component: FieldWithHelp,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof FieldWithHelp>;

export const WithHelp: Story = {
  render: () => (
    <div className="w-80">
      <FieldWithHelp
        label="Licence number"
        help="Find this on the top-right of your permit."
      >
        {(field) => <Input {...field} placeholder="ML-000000" />}
      </FieldWithHelp>
    </div>
  ),
};

export const Required: Story = {
  render: () => (
    <div className="w-80">
      <FieldWithHelp label="Estate name" required help="Shown on your invoices.">
        {(field) => <Input {...field} />}
      </FieldWithHelp>
    </div>
  ),
};

export const WithError: Story = {
  render: () => (
    <div className="w-80">
      <FieldWithHelp
        label="Email address"
        required
        help="We'll only use this for receipts."
        error="Enter a valid email address."
      >
        {(field) => (
          <Input {...field} error inputType="email" defaultValue="not-an-email" />
        )}
      </FieldWithHelp>
    </div>
  ),
};

export const HiddenLabel: Story = {
  render: () => (
    <div className="w-80">
      <FieldWithHelp label="Search sites" hideLabel>
        {(field) => <Input {...field} inputType="search" placeholder="Search sites" />}
      </FieldWithHelp>
    </div>
  ),
};

/** Verifies aria-describedby resolves to the rendered help/error node ids. */
export const A11yWiring: Story = {
  render: () => {
    const [value, setValue] = React.useState('');
    const invalid = value.length > 0 && value.length < 3;
    return (
      <div className="w-80">
        <FieldWithHelp
          label="Site code"
          help="At least 3 characters."
          error={invalid ? 'Too short — use at least 3 characters.' : undefined}
        >
          {(field) => (
            <Input
              {...field}
              error={invalid}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </FieldWithHelp>
      </div>
    );
  },
};
