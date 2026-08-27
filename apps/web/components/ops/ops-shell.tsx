'use client';

import {
  ClipboardCheck,
  GaugeCircle,
  LayoutDashboard,
  ListFilter,
  MessagesSquare,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
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

const NAV = [
  { href: '/ops', label: 'Overview', icon: LayoutDashboard },
  { href: '/ops/evaluations', label: 'Evaluations', icon: GaugeCircle },
  { href: '/ops/conversations', label: 'Conversations', icon: ListFilter },
  { href: '/ops/approvals', label: 'Approvals', icon: ClipboardCheck },
  { href: '/chat', label: 'Customer chat', icon: MessagesSquare },
];

export function OpsShell({
  operatorEmail,
  children,
}: {
  operatorEmail: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

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
                    isActive={pathname === href}
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
          <span className="px-2 text-muted-foreground text-xs">{operatorEmail}</span>
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
