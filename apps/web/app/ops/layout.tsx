import { serverEnv } from '@kora/core';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OpsShell } from '@/components/ops/ops-shell';
import { currentOperator } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const operator = await currentOperator();
  if (!operator) redirect('/login?next=/ops');

  return (
    <OpsShell deploymentMode={serverEnv().KORA_DEPLOYMENT_MODE} operatorEmail={operator.email}>
      {children}
    </OpsShell>
  );
}
