import type { ReactNode } from 'react';
import LogoutButton from '@/ui/Auth/LogoutButton';

export default function ProtectedPageShell({
  children
}: {
  children: ReactNode;
}) {
  return (
    <>
      <LogoutButton />
      {children}
    </>
  );
}
