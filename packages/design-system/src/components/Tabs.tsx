import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/utils';

/* ============================================================================
   Radix UI Based Tabs
   ============================================================================ */

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: 'default' | 'pills' | 'underline' | 'boxed';
    fullWidth?: boolean;
  }
>(({ className, variant = 'default', fullWidth = false, ...props }, ref) => {
  const variantClasses = {
    default: 'bg-muted p-1 rounded-md',
    pills: 'gap-1',
    underline: 'border-b border-border gap-4',
    boxed: 'border border-border rounded-lg p-1 gap-1',
  };

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-start text-muted-foreground',
        variantClasses[variant],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    variant?: 'default' | 'pills' | 'underline' | 'boxed';
    icon?: React.ReactNode;
    badge?: string | number;
  }
>(({ className, variant = 'default', icon, badge, children, ...props }, ref) => {
  const variantClasses = {
    default:
      'rounded-sm px-3 py-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
    pills:
      'rounded-full px-4 py-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
    underline:
      'border-b-2 border-transparent px-1 pb-3 data-[state=active]:border-primary data-[state=active]:text-foreground -mb-px',
    boxed:
      'rounded-md px-3 py-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
  };

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {icon && <span className="mr-2">{icon}</span>}
      {children}
      {badge !== undefined && (
        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {badge}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

/* ============================================================================
   Simple Controlled Tabs
   ============================================================================ */

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
  content?: React.ReactNode;
}

export interface SimpleTabsProps {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  variant?: 'default' | 'pills' | 'underline' | 'boxed';
  fullWidth?: boolean;
  className?: string;
  contentClassName?: string;
}

const SimpleTabs: React.FC<SimpleTabsProps> = ({
  tabs,
  value,
  defaultValue,
  onChange,
  variant = 'default',
  fullWidth = false,
  className,
  contentClassName,
}) => {
  const initialValue = defaultValue || tabs[0]?.id;

  return (
    <Tabs
      value={value}
      defaultValue={initialValue}
      onValueChange={onChange}
      className={className}
    >
      <TabsList variant={variant} fullWidth={fullWidth}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            variant={variant}
            icon={tab.icon}
            badge={tab.badge}
            disabled={tab.disabled}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className={contentClassName}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
};

/* ============================================================================
   Vertical Tabs
   ============================================================================ */

export interface VerticalTabsProps extends Omit<SimpleTabsProps, 'variant' | 'fullWidth'> {
  /** Tab list width */
  tabListWidth?: string;
}

const VerticalTabs: React.FC<VerticalTabsProps> = ({
  tabs,
  value,
  defaultValue,
  onChange,
  className,
  contentClassName,
  tabListWidth = '200px',
}) => {
  const initialValue = defaultValue || tabs[0]?.id;

  return (
    <Tabs
      value={value}
      defaultValue={initialValue}
      onValueChange={onChange}
      className={cn('flex gap-4', className)}
      orientation="vertical"
    >
      <TabsPrimitive.List
        className="flex flex-col border-r border-border pr-4"
        style={{ minWidth: tabListWidth }}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            disabled={tab.disabled}
            className={cn(
              'flex items-center justify-start gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
              'hover:bg-muted hover:text-foreground',
              'data-[state=active]:bg-muted data-[state=active]:text-foreground',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {tab.badge}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      <div className="flex-1">
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className={cn('mt-0', contentClassName)}>
            {tab.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent, SimpleTabs, VerticalTabs };
