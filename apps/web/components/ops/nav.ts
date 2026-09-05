import {
  ClipboardCheck,
  EyeOff,
  GaugeCircle,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  MessagesSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const NAV: NavItem[] = [
  { href: '/ops', label: 'Overview', icon: LayoutDashboard },
  { href: '/ops/evaluations', label: 'Evaluations', icon: GaugeCircle },
  { href: '/ops/conversations', label: 'Conversations', icon: ListFilter },
  { href: '/ops/approvals', label: 'Approvals', icon: ClipboardCheck },
  { href: '/ops/shadow', label: 'Shadow mode', icon: EyeOff },
  { href: '/ops/versions', label: 'Versions', icon: GitBranch },
  { href: '/chat', label: 'Customer chat', icon: MessagesSquare },
];

/**
 * Longest matching prefix, not any prefix: `/ops` prefixes every operator route,
 * so `startsWith` would highlight two items, and exact matching would highlight
 * none on a detail route.
 */
export function activeNavHref(pathname: string): string | null {
  const path = pathname.split('?')[0] ?? pathname;
  const matched = NAV.filter((item) => path === item.href || path.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  );
  return matched[0]?.href ?? null;
}
