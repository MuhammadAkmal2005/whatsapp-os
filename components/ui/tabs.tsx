'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * A segmented control: a sunken track holding two or three sibling views.
 *
 * The active thumb is raised by value and an inset hairline rather than by a shadow —
 * a real shadow at this scale reads as a smudge, and the surface step already does the
 * work. The inset ring is deliberate: a normal border would grow the thumb by two pixels
 * and shift its label when the selection moved.
 */
const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-control max-w-full items-center justify-center gap-0.5 overflow-x-auto rounded-md border border-border bg-surface-sunken p-0.5 text-muted-foreground scrollbar-none',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-sm font-medium',
      'transition-[background-color,color,box-shadow] duration-instant ease-out',
      'disabled:pointer-events-none disabled:opacity-45',
      'hover:text-foreground',
      'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_0_0_1px_hsl(var(--border))]',
      '[&_svg]:size-3.5 [&_svg]:shrink-0',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4', className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
