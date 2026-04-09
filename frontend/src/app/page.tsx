import { getEmployees } from '@/lib/employees';
import { getServerAuthPassword } from '@/lib/server-auth';
import LoginScreen from '@/ui/Auth/LoginScreen';
import ProtectedPageShell from '@/ui/Layout/ProtectedPageShell';
import Home from '@/ui/Pages/Home/Home';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const authPassword = await getServerAuthPassword();

  if (!authPassword) {
    return <LoginScreen />;
  }

  const { employees, error, unauthorized, warning } = await getEmployees({
    authPassword
  });

  if (unauthorized) {
    return <LoginScreen />;
  }

  return (
    <ProtectedPageShell>
      <Home employees={employees} error={error} warning={warning} />
    </ProtectedPageShell>
  );
}
