'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleUnauthorizedClientResponse } from '@/lib/client-auth';

interface EmployeeReportExportProps {
  employeeCode: string;
}

const getCurrentPeriod = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
};

const formatPeriodLabel = (period: string): string => {
  const year = period.slice(0, 4);
  const month = Number(period.slice(4, 6));
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${months[month - 1]} ${year}`;
};

export default function EmployeeReportExport({ employeeCode }: EmployeeReportExportProps) {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const period = getCurrentPeriod();

  const handleExport = async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/reports/${encodeURIComponent(employeeCode)}/${encodeURIComponent(period)}`,
        { method: 'POST' }
      );

      if (await handleUnauthorizedClientResponse(response, router)) return;

      if (!response.ok) {
        let message = 'Failed to start report export';
        try {
          const payload = (await response.json()) as { error?: unknown };
          if (typeof payload.error === 'string' && payload.error.trim() !== '') {
            message = payload.error;
          }
        } catch { /* use default */ }
        setError(message);
        return;
      }

      setSuccess('Report export started. The file will be ready shortly.');
    } catch {
      setError('Unable to reach report API');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-black/5 bg-white/65 p-4 shadow-card backdrop-blur md:p-6">
      <div className="mb-6 flex flex-col gap-2">
        <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
          Monthly report
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Export a CSV report of all messages for the current billing period.
        </p>
      </div>

      <div className="rounded-[1.4rem] border border-stone-200 bg-stone-50/80 px-4 py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slatewarm-950">
              {formatPeriodLabel(period)}
            </p>
            <p className="text-sm leading-6 text-slate-600">
              Generate a CSV file with all employee messages for this month.
            </p>
          </div>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="inline-flex rounded-full bg-slatewarm-950 px-5 py-3 text-sm font-medium text-white transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? 'Exporting...' : 'Generate report'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-4 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}
    </section>
  );
}
