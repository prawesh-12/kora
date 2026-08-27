'use client';

import { usePathname, useRouter } from 'next/navigation';
import { NAV, activeNavHref } from '@/components/ops/nav';
import { type ReactNode, useMemo } from 'react';
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

export function OpsShell({
  operatorEmail,
  children,
}: {
  operatorEmail: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Longest matching prefix, not any prefix. `/ops` is a prefix of every operator
  // route, so `startsWith` lights up two items at once; exact matching lights up
  // none on a detail route like /ops/conversations/conv_123.
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
          {/* Flex with a gap and a shrink-0 avatar, so the circle reserves its own
              space instead of sitting on top of the email. */}
          <div className="flex min-w-0 items-center gap-2 px-2">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10px] text-muted-foreground uppercase"
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
        <div className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <AnimatedSidebarTrigger />
          <span className="font-medium text-sm">Kora operations</span>
        </div>
        {children}
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  );
}
