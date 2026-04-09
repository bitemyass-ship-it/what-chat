import { redirect } from 'next/navigation';
import { getServerAuthPassword } from '@/lib/server-auth';
import ProtectedPageShell from '@/ui/Layout/ProtectedPageShell';
import EmployeePage from '@/ui/Pages/Employee/Employee';

export const dynamic = 'force-dynamic';

export default async function Page({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const authPassword = await getServerAuthPassword();

  if (!authPassword) {
    redirect('/');
  }

  return (
    <ProtectedPageShell>
      <EmployeePage authPassword={authPassword} code={code} />
    </ProtectedPageShell>
  );
}
