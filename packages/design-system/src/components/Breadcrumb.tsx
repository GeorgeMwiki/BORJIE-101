/**
 * Breadcrumb — LitFin-pattern hairline breadcrumb for portal shells.
 *
 * Renders a horizontal `Trail`: `Home / Tenants / Lily Estate`. The
 * final crumb is in `text-foreground` semibold; prior crumbs are
 * `text-muted-foreground` and become anchors with hover-to-foreground.
 * The separator is a thin slash, never a chevron, to read as filesystem
 * path rather than navigation.
 *
 * Used in:
 *   - Owner cockpit top-bar (left of the title)
 *   - Admin console top-bar
 *   - Entity detail drawer header
 *
 * Anatomy:
 *   <Breadcrumb>
 *     <BreadcrumbList>
 *       <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
 *       <BreadcrumbSeparator />
 *       <BreadcrumbItem><BreadcrumbLink href="/sites">Sites</BreadcrumbLink></BreadcrumbItem>
 *       <BreadcrumbSeparator />
 *       <BreadcrumbItem><BreadcrumbPage>Lily Estate</BreadcrumbPage></BreadcrumbItem>
 *     </BreadcrumbList>
 *   </Breadcrumb>
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'nav'> & {
    readonly separator?: React.ReactNode;
  }
>(({ ...props }, ref) => (
  <nav ref={ref} aria-label="breadcrumb" {...props} />
));
Breadcrumb.displayName = 'Breadcrumb';

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<'ol'>
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      'flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2',
      className,
    )}
    {...props}
  />
));
BreadcrumbList.displayName = 'BreadcrumbList';

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<'li'>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn('inline-flex items-center gap-1.5', className)}
    {...props}
  />
));
BreadcrumbItem.displayName = 'BreadcrumbItem';

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<'a'> & { readonly asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      ref={ref}
      className={cn(
        'rounded-sm transition-colors hover:text-foreground',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
});
BreadcrumbLink.displayName = 'BreadcrumbLink';

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn('font-medium text-foreground', className)}
    {...props}
  />
));
BreadcrumbPage.displayName = 'BreadcrumbPage';

/**
 * Slash separator (LitFin filesystem-path feel).
 * Override the child to use ChevronRight for breadcrumb trails that
 * feel more like navigation (settings deep-nav).
 */
const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<'li'>) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn('text-muted-foreground/60 [&>svg]:size-3', className)}
    {...props}
  >
    {children ?? <span aria-hidden="true">/</span>}
  </li>
);
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';

/**
 * Chevron-right separator (alternative to slash) for nav-style trails.
 */
const BreadcrumbChevron = (props: React.ComponentProps<'li'>) => (
  <BreadcrumbSeparator {...props}>
    <ChevronRight aria-hidden="true" className="h-3 w-3" />
  </BreadcrumbSeparator>
);
BreadcrumbChevron.displayName = 'BreadcrumbChevron';

/** Ellipsis for collapsed middle crumbs in deep trees. */
const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<'span'>) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
);
BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis';

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbChevron,
  BreadcrumbEllipsis,
};
