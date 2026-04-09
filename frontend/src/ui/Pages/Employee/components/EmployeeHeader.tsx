import Link from 'next/link';
import type { Employee } from '@/lib/employee-record';

interface EmployeeHeaderProps {
  employee: Employee;
  isActive: boolean;
}

export default function EmployeeHeader({ employee, isActive }: EmployeeHeaderProps) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-slatewarm-950 px-6 py-8 text-stone-100 shadow-card md:px-10 md:py-12">
      <div className="absolute inset-0 bg-grid bg-[size:32px_32px] opacity-20" />
      <div className="absolute right-[-8rem] top-[-8rem] h-56 w-56 rounded-full bg-ember-400/30 blur-3xl" />
      <div className="absolute bottom-[-7rem] left-[-4rem] h-40 w-40 rounded-full bg-orange-200/30 blur-3xl" />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <Link
            href="/"
            className="inline-flex text-xs uppercase tracking-[0.35em] text-ember-200/90 transition-opacity duration-200 hover:opacity-80"
          >
            Back to employees
          </Link>
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-stone-400">
              Employee profile
            </p>
            <h1 className="font-[family-name:var(--font-heading)] text-4xl font-semibold leading-none md:text-5xl">
              {employee.displayName ?? employee.code}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-stone-300 md:text-base">
              Edit operator info and keep the employee state aligned with the backend
              record.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:min-w-[16rem]">
          <article className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-stone-400">
              code
            </p>
            <p className="mt-3 text-xl font-semibold text-white">{employee.code}</p>
          </article>
          <article
            className={`rounded-[1.5rem] border p-4 backdrop-blur ${
              isActive
                ? 'border-emerald-300/30 bg-emerald-400/15'
                : 'border-stone-300/20 bg-white/5'
            }`}
          >
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-stone-300">
              status
            </p>
            <p className="mt-3 text-xl font-semibold text-white">
              {isActive ? 'Active' : 'Paused'}
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
