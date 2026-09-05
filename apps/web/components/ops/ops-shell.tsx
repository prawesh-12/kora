'use client';

import { usePathname, useRouter } from 'next/navigation';
import { NAV, activeNavHref } from '@/components/ops/nav';
import { type ReactNode, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarTrigger,
} from '@/components/motion/animated-sidebar';

/**
 * Every mode below `full` holds something back: simulation writes nothing, shadow
 * only proposes, human_approval and limited gate the risky calls. `full` acts on
 * real customer money unasked, so it is the one that has to be unmistakable.
 */
const MODE: Record<string, { label: string; className: string }> = {
  simulation: { label: 'Simulation', className: 'border-info/40 bg-info/10 text-info-strong' },
  shadow: { label: 'Shadow', className: 'border-info/40 bg-info/10 text-info-strong' },
  human_approval: {
    label: 'Human approval',
    className: 'border-warning/40 bg-warning/10 text-warning-strong',
  },
  limited: { label: 'Limited', className: 'border-warning/40 bg-warning/10 text-warning-strong' },
  full: {
    label: 'Autonomous',
    className: 'border-destructive/50 bg-destructive/10 font-semibold text-destructive-strong',
  },
};

export function OpsShell({
  operatorEmail,
  deploymentMode,
  tenant,
  children,
}: {
  operatorEmail: string;
  deploymentMode: string;
  tenant: string;
  children: ReactNode;
}) {
  const mode = MODE[deploymentMode] ?? {
    label: deploymentMode,
    className: 'border-border text-muted-foreground',
  };

  const pathname = usePathname();
  const router = useRouter();

  const activeHref = useMemo(() => activeNavHref(pathname), [pathname]);

  return (
    <AnimatedSidebarProvider>
      <AnimatedSidebar ariaLabel="Operator navigation">
        <AnimatedSidebarHeader>
          <span className="px-2 font-semibold text-sm">Kora operations</span>
        </AnimatedSidebarHeader>
        <AnimatedSidebarContent>
          <AnimatedSidebarGroup>
            <AnimatedSidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => (
                <AnimatedSidebarMenuItem key={href}>
                  <AnimatedSidebarMenuButton
                    icon={<Icon className="size-4" aria-hidden />}
                    isActive={href === activeHref}
                    onSelect={() => router.push(href)}
                  >
                    {label}
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              ))}
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroup>
        </AnimatedSidebarContent>
        <AnimatedSidebarFooter>
          <div className="flex min-w-0 items-center gap-2 px-2">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-strong uppercase"
            >
              {operatorEmail.slice(0, 2)}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground text-xs"
              title={operatorEmail}
            >
              {operatorEmail}
            </span>
          </div>
        </AnimatedSidebarFooter>
      </AnimatedSidebar>
      <AnimatedSidebarInset>
        <header className="flex items-center gap-2 border-b px-4 py-2">
          <div className="md:hidden">
            <AnimatedSidebarTrigger />
          </div>
          <span className="font-medium text-sm md:hidden">Kora operations</span>
          <span
            className="tnum hidden font-mono text-muted-foreground text-xs sm:inline"
            title={tenant}
          >
            {tenant}
          </span>
          <span
            className={cn(
              'ml-auto rounded-md border px-2 py-0.5 text-xs uppercase tracking-[0.06em]',
              mode.className,
            )}
            title={`Deployment mode: ${deploymentMode}`}
          >
            {mode.label}
          </span>
        </header>
        {children}
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  );
}
