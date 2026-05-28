/**
 * Drawer — LitFin-pattern side panel.
 *
 * Right-side slide-in panel for entity detail surfaces (tenant detail,
 * licence detail, employee detail, parcel detail). Built on Radix
 * Dialog primitive with custom animation classes.
 *
 * Anatomy:
 *   <Drawer>
 *     <DrawerTrigger asChild><Button>Open</Button></DrawerTrigger>
 *     <DrawerContent side="right" size="md">
 *       <DrawerHeader>
 *         <DrawerTitle>Title</DrawerTitle>
 *         <DrawerDescription>Sub</DrawerDescription>
 *       </DrawerHeader>
 *       <DrawerBody>...</DrawerBody>
 *       <DrawerFooter>...</DrawerFooter>
 *     </DrawerContent>
 *   </Drawer>
 *
 * The header is sticky with a hairline border-bottom, the body
 * scrolls, the footer is sticky at the bottom with a hairline border-top
 * and right-aligned action buttons.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
));
DrawerOverlay.displayName = 'DrawerOverlay';

const drawerContentVariants = cva(
  cn(
    'fixed z-50 flex flex-col bg-card text-card-foreground shadow-xl',
    'border-border',
    'data-[state=open]:animate-in data-[state=open]:duration-300 data-[state=open]:ease-out',
    'data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=closed]:ease-in',
  ),
  {
    variants: {
      side: {
        right:
          'right-0 inset-y-0 h-full border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left:
          'left-0 inset-y-0 h-full border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        top:
          'top-0 inset-x-0 w-full border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        bottom:
          'bottom-0 inset-x-0 w-full border-t rounded-t-2xl data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
      },
      size: {
        sm: 'w-full sm:max-w-sm',
        md: 'w-full sm:max-w-md',
        lg: 'w-full sm:max-w-lg',
        xl: 'w-full sm:max-w-xl',
        '2xl': 'w-full sm:max-w-2xl',
      },
    },
    compoundVariants: [
      // Size only applies to horizontal sides
      { side: 'top', size: 'sm', class: 'h-1/3 sm:max-w-none' },
      { side: 'top', size: 'md', class: 'h-1/2 sm:max-w-none' },
      { side: 'top', size: 'lg', class: 'h-2/3 sm:max-w-none' },
      { side: 'top', size: 'xl', class: 'h-3/4 sm:max-w-none' },
      { side: 'top', size: '2xl', class: 'h-[85vh] sm:max-w-none' },
      { side: 'bottom', size: 'sm', class: 'h-1/3 sm:max-w-none' },
      { side: 'bottom', size: 'md', class: 'h-1/2 sm:max-w-none' },
      { side: 'bottom', size: 'lg', class: 'h-2/3 sm:max-w-none' },
      { side: 'bottom', size: 'xl', class: 'h-3/4 sm:max-w-none' },
      { side: 'bottom', size: '2xl', class: 'h-[85vh] sm:max-w-none' },
    ],
    defaultVariants: {
      side: 'right',
      size: 'md',
    },
  },
);

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof drawerContentVariants> {
  /** Hide the built-in close button (default: false). */
  readonly hideCloseButton?: boolean;
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, children, side, size, hideCloseButton = false, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(drawerContentVariants({ side, size }), className)}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close panel</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = 'DrawerContent';

const DrawerHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'sticky top-0 z-10 flex flex-col gap-1 border-b border-border bg-card/95 px-6 py-5 backdrop-blur-xl',
      className,
    )}
    {...props}
  />
));
DrawerHeader.displayName = 'DrawerHeader';

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'font-display text-lg font-medium tracking-tight text-foreground',
      className,
    )}
    {...props}
  />
));
DrawerTitle.displayName = 'DrawerTitle';

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DrawerDescription.displayName = 'DrawerDescription';

const DrawerBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex-1 overflow-y-auto px-6 py-5', className)}
    {...props}
  />
));
DrawerBody.displayName = 'DrawerBody';

const DrawerFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-border bg-card/95 px-6 py-4 backdrop-blur-xl sm:flex-row sm:justify-end sm:gap-3',
      className,
    )}
    {...props}
  />
));
DrawerFooter.displayName = 'DrawerFooter';

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
};
