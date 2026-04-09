import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE,
  getEmployeeChatByRecordId,
  getEmployeeChatMessages,
} from '@/lib/chats';
import { getServerAuthPassword } from '@/lib/server-auth';
import ProtectedPageShell from '@/ui/Layout/ProtectedPageShell';
import EmployeeChatPage from '@/ui/Pages/EmployeeChat/EmployeeChat';

export const dynamic = 'force-dynamic';

const resolveMessagesPage = (
  value: string | string[] | undefined
): number => {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (!rawValue || !/^\d+$/u.test(rawValue)) {
    return 1;
  }

  const parsedPage = Number(rawValue);

  if (!Number.isSafeInteger(parsedPage) || parsedPage <= 0) {
    return 1;
  }

  return parsedPage;
};

export default async function Page({
  params,
  searchParams
}: {
  params: Promise<{ code: string; chatRecordId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { code, chatRecordId } = await params;
  const resolvedSearchParams = await searchParams;
  const authPassword = await getServerAuthPassword();
  const parsedChatRecordId = Number(chatRecordId);
  const currentPage = resolveMessagesPage(resolvedSearchParams.page);

  if (!Number.isSafeInteger(parsedChatRecordId) || parsedChatRecordId <= 0) {
    notFound();
  }

  if (!authPassword) {
    redirect('/');
  }

  const [chatResult, messagesResult] = await Promise.all([
    getEmployeeChatByRecordId(code, parsedChatRecordId, {
      authPassword
    }),
    getEmployeeChatMessages(code, chatRecordId, {
      authPassword,
      page: currentPage,
      pageSize: EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE
    })
  ]);

  if (chatResult.unauthorized || messagesResult.unauthorized) {
    redirect('/');
  }

  if (chatResult.notFound || messagesResult.notFound) {
    notFound();
  }

  const { chat } = chatResult;

  if (!chat && !chatResult.error) {
    notFound();
  }

  if (!chat) {
    return (
      <ProtectedPageShell>
        <main className="min-h-screen px-5 py-8 md:px-10 md:py-10">
          <div className="mx-auto max-w-5xl">
            <section className="rounded-[2rem] border border-red-200 bg-red-50/90 p-8 shadow-card">
              <p className="text-xs uppercase tracking-[0.24em] text-red-700">
                Chat detail
              </p>
              <h1 className="mt-4 font-[family-name:var(--font-heading)] text-3xl font-semibold text-slatewarm-950">
                Unable to load chat
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
                {chatResult.error ?? 'Chat summary is temporarily unavailable.'}
              </p>
              <Link
                href={`/employees/${encodeURIComponent(code)}`}
                className="mt-6 inline-flex rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-900 transition-colors duration-200 hover:border-slate-900"
              >
                Back to employee
              </Link>
            </section>
          </div>
        </main>
      </ProtectedPageShell>
    );
  }

  return (
    <ProtectedPageShell>
      <EmployeeChatPage
        chat={chat}
        code={code}
        chatRecordId={chatRecordId}
        messages={messagesResult.messages}
        messagesPage={messagesResult.page}
        messagesPageSize={messagesResult.pageSize}
        messagesTotal={messagesResult.total}
        messagesTotalPages={messagesResult.totalPages}
        messagesError={messagesResult.error}
      />
    </ProtectedPageShell>
  );
}
