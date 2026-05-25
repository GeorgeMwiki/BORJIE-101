import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './Modal';
import { Button } from './Button';

const meta: Meta<typeof Modal> = {
  title: 'Core/Modal',
  component: Modal,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof Modal>;

const Template = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <ModalHeader>Modal Title</ModalHeader>
        <ModalBody>Modal body content goes here.</ModalBody>
        <ModalFooter>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </ModalFooter>
      </Modal>
    </>
  );
};

export const Default: Story = { render: () => <Template /> };
