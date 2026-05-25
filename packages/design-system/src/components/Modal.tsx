import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';

/* ============================================================================
   Modal Types & Interfaces
   ============================================================================ */

export interface ModalProps {
  /** Control modal visibility */
  open: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal description */
  description?: string;
  /** Modal content */
  children: React.ReactNode;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Show close button in header */
  showCloseButton?: boolean;
  /** Close modal on overlay click */
  closeOnOverlayClick?: boolean;
  /** Close modal on Escape key */
  closeOnEscape?: boolean;
  /** Additional class names */
  className?: string;
}

/* ============================================================================
   Main Modal Component
   ============================================================================ */

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className,
}) => {
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
  };

  // Handle escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) onClose();
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onClose, closeOnEscape]);

  // Focus trap
  const modalRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (open && modalRef.current) {
      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      };

      document.addEventListener('keydown', handleTab);
      firstElement?.focus();

      return () => document.removeEventListener('keydown', handleTab);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-describedby={description ? 'modal-description' : undefined}
    >
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        {/* Overlay */}
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity animate-in fade-in-0"
          onClick={closeOnOverlayClick ? onClose : undefined}
          aria-hidden="true"
        />

        {/* Modal Content */}
        <div
          ref={modalRef}
          className={cn(
            'relative transform overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl transition-all sm:my-8 w-full border border-border animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 sm:slide-in-from-bottom-0',
            sizeClasses[size],
            className
          )}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
              <div>
                {title && (
                  <h2 id="modal-title" className="text-lg font-semibold text-foreground">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id="modal-description" className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close modal"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Body */}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   Modal Subcomponents
   ============================================================================ */

export interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Modal title */
  title?: string;
  /** Modal description */
  description?: string;
  /** Show close button */
  showCloseButton?: boolean;
  /** Close handler */
  onClose?: () => void;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  description,
  showCloseButton = true,
  onClose,
  className,
  children,
  ...props
}) => (
  <div
    className={cn('flex items-start justify-between p-6 pb-4 border-b border-border', className)}
    {...props}
  >
    <div>
      {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
    {showCloseButton && onClose && (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close modal"
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    )}
  </div>
);

export interface ModalBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

export const ModalBody: React.FC<ModalBodyProps> = ({ className, children, ...props }) => (
  <div className={cn('p-6', className)} {...props}>
    {children}
  </div>
);

export interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Primary action button label */
  primaryLabel?: string;
  /** Secondary action button label */
  secondaryLabel?: string;
  /** Primary action handler */
  onPrimaryAction?: () => void;
  /** Secondary action handler */
  onSecondaryAction?: () => void;
  /** Primary button loading state */
  primaryLoading?: boolean;
  /** Primary button disabled state */
  primaryDisabled?: boolean;
  /** Primary button variant */
  primaryVariant?: 'default' | 'danger' | 'success';
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  className,
  children,
  primaryLabel,
  secondaryLabel,
  onPrimaryAction,
  onSecondaryAction,
  primaryLoading,
  primaryDisabled,
  primaryVariant = 'default',
  ...props
}) => (
  <div
    className={cn(
      'flex items-center justify-end gap-3 pt-4 border-t border-border -mx-6 -mb-6 px-6 py-4 bg-muted/50 rounded-b-xl',
      className
    )}
    {...props}
  >
    {children || (
      <>
        {secondaryLabel && (
          <Button variant="outline" onClick={onSecondaryAction}>
            {secondaryLabel}
          </Button>
        )}
        {primaryLabel && (
          <Button
            variant={primaryVariant === 'danger' ? 'danger' : primaryVariant === 'success' ? 'success' : 'default'}
            onClick={onPrimaryAction}
            loading={primaryLoading}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </Button>
        )}
      </>
    )}
  </div>
);

/* ============================================================================
   Confirmation Modal
   ============================================================================ */

export interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
}) => (
  <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
    <ModalFooter
      primaryLabel={confirmLabel}
      secondaryLabel={cancelLabel}
      onPrimaryAction={onConfirm}
      onSecondaryAction={onClose}
      primaryLoading={loading}
      primaryVariant={variant}
    />
  </Modal>
);
