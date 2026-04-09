import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getEmployeeByCode } from '@/lib/employees';
import EmployeeEditor from './components/EmployeeEditor';

interface EmployeePageProps {
  authPassword: string;
  code: string;
}

export default async function EmployeePage({
  authPassword,
  code
}: EmployeePageProps) {
  const {
    employee,
    error,
    notFound: employeeNotFound,
    unauthorized
  } = await getEmployeeByCode(code, {
    authPassword
  });

  if (unauthorized) {
    redirect('/');
  }

  if (employeeNotFound) {
    notFound();
  }

  return (
    <main className="min-h-screen px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        {employee && !error ? (
          <EmployeeEditor initialEmployee={employee} />
        ) : (
          <section className="rounded-[2rem] border border-red-200 bg-red-50/90 p-8 shadow-card">
            <p className="text-xs uppercase tracking-[0.28em] text-red-700">
              Employee page
            </p>
            <h1 className="mt-4 font-[family-name:var(--font-heading)] text-3xl font-semibold text-slatewarm-950">
              Unable to load employee
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
              {error ?? 'Employee data is temporarily unavailable.'}
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-900 transition-colors duration-200 hover:border-slate-900"
            >
              Back to dashboard
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
