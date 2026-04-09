interface HomeHeaderProps {
  activeEmployeesCount: number;
  employeesCount: number;
}

export default function HomeHeader({
  activeEmployeesCount,
  employeesCount
}: HomeHeaderProps) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-slatewarm-950 px-6 py-8 text-stone-100 shadow-card md:px-10 md:py-12">
      <div className="absolute inset-0 bg-grid bg-[size:32px_32px] opacity-20" />
      <div className="absolute right-[-8rem] top-[-8rem] h-56 w-56 rounded-full bg-ember-400/30 blur-3xl" />
      <div className="absolute bottom-[-7rem] left-[-4rem] h-40 w-40 rounded-full bg-orange-200/30 blur-3xl" />
      <div className="relative grid gap-8 md:grid-cols-[1.4fr_0.8fr] md:items-end">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-ember-200/90">
            WhatsApp Monitor
          </p>
          <h1 className="max-w-2xl font-[family-name:var(--font-heading)] text-4xl font-semibold leading-none md:text-6xl">
            Employees dashboard
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-stone-300 md:text-base">
            Main page for your operator list. It reads data directly from the backend
            employee API and renders current account state without client-side polling.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:justify-self-end">
          <article className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 backdrop-blur">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-stone-400">
              total
            </p>
            <p className="mt-3 text-3xl font-semibold text-white">{employeesCount}</p>
          </article>
          <article className="rounded-[1.5rem] border border-white/10 bg-ember-400/15 p-4 backdrop-blur">
            <p className="text-[0.65rem] uppercase tracking-[0.3em] text-ember-100">
              active
            </p>
            <p className="mt-3 text-3xl font-semibold text-white">
              {activeEmployeesCount}
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
