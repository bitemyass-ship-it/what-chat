'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleUnauthorizedClientResponse } from '@/lib/client-auth';

interface AvailableReport {
  downloadUrl: string;
  employeeCode: string;
  fileName: string;
  period: string;
}

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

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function EmployeeReportExport({ employeeCode }: EmployeeReportExportProps) {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [reports, setReports] = useState<AvailableReport[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [downloadingPeriods, setDownloadingPeriods] = useState<Set<string>>(
    () => new Set()
  );
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const period = getCurrentPeriod();

  const fetchReports = useCallback(async () => {
    setIsLoadingReports(true);
    setReportsError(null);

    try {
      const response = await fetch('/api/reports');

      if (await handleUnauthorizedClientResponse(response, router)) return;

      if (!response.ok) {
        let message = 'Unable to load available reports';
        try {
          const payload = (await response.json()) as { error?: unknown };
          if (typeof payload.error === 'string' && payload.error.trim() !== '') {
            message = payload.error;
          }
        } catch { /* use default */ }
        setReportsError(message);
        return;
      }

      const data: unknown = await response.json();

      if (!Array.isArray(data)) {
        setReports([]);
        return;
      }

      const filtered = (data as AvailableReport[]).filter(
        (report) => report.employeeCode === employeeCode
      );

      setReports(filtered);
    } catch {
      setReportsError('Unable to load available reports');
    } finally {
      setIsLoadingReports(false);
    }
  }, [employeeCode, router]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports, listRefreshKey]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [employeeCode]);

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

      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        setListRefreshKey((key) => key + 1);
      }, 5_000);
    } catch {
      setError('Unable to reach report API');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownload = async (report: AvailableReport) => {
    if (downloadingPeriods.has(report.period)) return;

    setDownloadingPeriods((prev) => new Set(prev).add(report.period));
    setReportsError(null);

    try {
      const response = await fetch(
        `/api/reports/${encodeURIComponent(report.employeeCode)}/${encodeURIComponent(report.period)}`
      );

      if (await handleUnauthorizedClientResponse(response, router)) return;

      if (!response.ok) {
        let message = 'Failed to download report';
        try {
          const payload = (await response.json()) as { error?: unknown };
          if (typeof payload.error === 'string' && payload.error.trim() !== '') {
            message = payload.error;
          }
        } catch { /* use default */ }
        setReportsError(message);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = report.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setReportsError('Failed to download report');
    } finally {
      setDownloadingPeriods((prev) => {
        const next = new Set(prev);
        next.delete(report.period);
        return next;
      });
    }
  };

  const showReportList = isLoadingReports || reports.length > 0;

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

      {showReportList ? (
        <div className="mt-6 flex flex-col gap-3">
          <h3 className="text-sm font-medium text-slatewarm-950">
            Available reports
          </h3>

          {isLoadingReports ? (
            <p className="text-sm text-slate-500">Loading reports...</p>
          ) : (
            <div className="rounded-[1.4rem] border border-stone-200 bg-stone-50/80">
              {reports.map((report, index) => {
                const isDownloading = downloadingPeriods.has(report.period);

                return (
                  <div
                    key={`${report.employeeCode}-${report.period}`}
                    className={`flex items-center justify-between gap-3 px-4 py-3${
                      index > 0 ? ' border-t border-stone-200' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileIcon />
                      <span className="truncate text-sm font-medium text-slatewarm-950">
                        {report.fileName}
                      </span>
                      <span className="shrink-0 text-sm text-slate-500">
                        &middot;
                      </span>
                      <span className="shrink-0 text-sm text-slate-500">
                        {formatPeriodLabel(report.period)}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={() => handleDownload(report)}
                      className="shrink-0 text-sm font-medium text-slatewarm-950 underline underline-offset-2 transition-colors duration-200 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDownloading ? 'Downloading...' : 'Download'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {reportsError ? (
        <div className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {reportsError}
        </div>
      ) : null}
    </section>
  );
}
