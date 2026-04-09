import type { Employee } from '@/lib/employees';
import HomeHeader from './components/HomeHeader';
import UserTable from './components/UserTable';

interface HomeProps {
  employees: Employee[];
  error: string | null;
  warning: string | null;
}

export default function Home({ employees, error, warning }: HomeProps) {
  const activeEmployeesCount = employees.filter((employee) => employee.isActive).length;

  return (
    <main className="min-h-screen px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <HomeHeader
          activeEmployeesCount={activeEmployeesCount}
          employeesCount={employees.length}
        />
        <UserTable employees={employees} error={error} warning={warning} />
      </div>
    </main>
  );
}
