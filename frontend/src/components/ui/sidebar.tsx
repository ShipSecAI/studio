import * as React from 'react';
import { cn } from '@/lib/utils';

const Sidebar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <aside
      ref={ref}
      className={cn(
        'flex flex-col overflow-hidden border-r border-border/70 bg-background/90 shadow-[1px_0_0_rgba(255,255,255,0.55)] backdrop-blur dark:shadow-[1px_0_0_rgba(255,255,255,0.04)]',
        // Ensure smooth transition for width changes
        'will-change-[width,transform]',
        className,
      )}
      {...props}
    />
  ),
);
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex h-14 items-center border-b border-border/70 p-3 md:p-4', className)}
      {...props}
    />
  ),
);
SidebarHeader.displayName = 'SidebarHeader';

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-auto border-t border-border/70 p-2', className)} {...props} />
  ),
);
SidebarFooter.displayName = 'SidebarFooter';

const SidebarContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden py-2',
        // Custom scrollbar styling
        'scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent',
        className,
      )}
      {...props}
    />
  ),
);
SidebarContent.displayName = 'SidebarContent';

const SidebarItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    isActive?: boolean;
  }
>(({ className, isActive, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'flex w-full items-center gap-3 px-3 py-2.5 md:py-2 text-left rounded-lg text-sm font-medium',
      'transition-[background-color,color,box-shadow] duration-150',
      'hover:bg-accent hover:text-accent-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      // Touch-friendly sizing on mobile
      'min-h-[44px] md:min-h-0',
      isActive
        ? 'bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
        : 'text-muted-foreground',
      className,
    )}
    {...props}
  />
));
SidebarItem.displayName = 'SidebarItem';

export { Sidebar, SidebarHeader, SidebarFooter, SidebarContent, SidebarItem };
