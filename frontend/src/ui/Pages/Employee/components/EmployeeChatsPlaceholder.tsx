'use client';

import { startTransition, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { redirectToLogin } from '@/lib/client-auth';
import {
  EMPLOYEE_CHATS_PAGE_SIZE,
  getEmployeeChats,
  type EmployeeChatListItem
} from '@/lib/chats';
import EmployeeChatsTable from './EmployeeChatsTable';

interface EmployeeChatsPlaceholderProps {
  employeeCode: string;
  isWhatsappConnected: boolean;
}

interface EmployeeChatsState {
  chats: EmployeeChatListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error: string | null;
  isLoading: boolean;
}

const resolveChatsPage = (value: string | null): number => {
  if (!value || !/^\d+$/u.test(value)) {
    return 1;
  }

  const parsedPage = Number(value);

  if (!Number.isSafeInteger(parsedPage) || parsedPage <= 0) {
    return 1;
  }

  return parsedPage;
};

export default function EmployeeChatsPanel({
  employeeCode,
  isWhatsappConnected
}: EmployeeChatsPlaceholderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPage = resolveChatsPage(searchParams.get('page'));
  const [state, setState] = useState<EmployeeChatsState>({
    chats: [],
    page: currentPage,
    pageSize: EMPLOYEE_CHATS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    error: null,
    isLoading: true
  });

  useEffect(() => {
    let isCancelled = false;

    setState((currentState) => ({
      ...currentState,
      page: currentPage,
      pageSize: EMPLOYEE_CHATS_PAGE_SIZE,
      error: null,
      isLoading: true
    }));

    void getEmployeeChats(employeeCode, {
      page: currentPage,
      pageSize: EMPLOYEE_CHATS_PAGE_SIZE
    }).then((result) => {
      if (isCancelled) {
        return;
      }

      if (result.unauthorized) {
        void redirectToLogin(router);
        return;
      }

      setState({
        chats: result.chats,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        error: result.notFound ? 'Employee not found' : result.error,
        isLoading: false
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [currentPage, employeeCode, router]);

  const handlePageChange = (page: number) => {
    if (page === currentPage) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set('tab', 'chats');
    nextSearchParams.set('page', String(page));

    startTransition(() => {
      router.push(`${pathname}?${nextSearchParams.toString()}`, {
        scroll: false
      });
    });
  };

  return (
    <section className="rounded-[2rem] border border-black/5 bg-white/65 p-6 shadow-card backdrop-blur">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
          Chats
        </p>
        <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
          User chats
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-600">
          {isWhatsappConnected
            ? 'Analytics-only list of stored chats. Open a row to inspect the full conversation in a separate tab.'
            : 'WhatsApp is not connected yet. Chats appear here after connection and message ingestion.'}
        </p>
      </div>

      <div className="mt-6">
        <EmployeeChatsTable
          chats={state.chats}
          employeeCode={employeeCode}
          error={state.error}
          isLoading={state.isLoading}
          onPageChange={handlePageChange}
          page={state.page}
          pageSize={state.pageSize}
          total={state.total}
          totalPages={state.totalPages}
        />
      </div>
    </section>
  );
}
