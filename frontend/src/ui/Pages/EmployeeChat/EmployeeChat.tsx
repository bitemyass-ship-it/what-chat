import Link from 'next/link';
import type {
  ChatMessageListItem,
  EmployeeChatListItem
} from '@/lib/chats';
import {
  formatEmployeeChatDateTime,
  resolveEmployeeChatLabel,
  resolveFirstMessageAt,
  resolveLastMessageAt
} from '@/lib/chats';
import ChatMessagesTable from './components/ChatMessagesTable';

interface EmployeeChatProps {
  chat: EmployeeChatListItem;
  code: string;
  chatRecordId: string;
  messages: ChatMessageListItem[];
  messagesPage: number;
  messagesPageSize: number;
  messagesTotal: number;
  messagesTotalPages: number;
  messagesError: string | null;
}

const SummaryStat = ({
  label,
  value
}: {
  label: string;
  value: string | number;
}) => (
  <div className="rounded-[1.3rem] border border-stone-200 bg-white px-4 py-4">
    <p className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">
      {label}
    </p>
    <p className="mt-2 text-base font-medium text-slatewarm-950">
      {value}
    </p>
  </div>
);

export default function EmployeeChat({
  chat,
  code,
  chatRecordId,
  messages,
  messagesPage,
  messagesPageSize,
  messagesTotal,
  messagesTotalPages,
  messagesError
}: EmployeeChatProps) {
  const chatLabel = resolveEmployeeChatLabel(chat);
  const firstMessageAt = resolveFirstMessageAt(chat, messages);
  const lastMessageAt = resolveLastMessageAt(chat, messages);

  return (
    <main className="min-h-screen px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-slatewarm-950 px-6 py-8 text-stone-100 shadow-card md:px-10 md:py-12">
          <div className="absolute inset-0 bg-grid bg-[size:32px_32px] opacity-20" />
          <div className="absolute right-[-8rem] top-[-8rem] h-56 w-56 rounded-full bg-ember-400/30 blur-3xl" />
          <div className="absolute bottom-[-7rem] left-[-4rem] h-40 w-40 rounded-full bg-orange-200/30 blur-3xl" />

          <div className="relative">
            <Link
              href={`/employees/${encodeURIComponent(code)}`}
              className="inline-flex rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:border-white/35 hover:bg-white/10"
            >
              Back to employee
            </Link>
            <p className="mt-4 text-xs uppercase tracking-[0.24em] text-ember-200/90">
              Employee chat
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-heading)] text-3xl font-semibold text-white">
              {chatLabel}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
              Conversation log for employee
              {' '}
              <span className="font-medium text-white">{code}</span>
              .
              {' '}
              This page stays read-focused and uses stored message history only.
            </p>
          </div>
        </section>

        <section className="rounded-[2rem] border border-black/5 bg-white/65 p-6 shadow-card backdrop-blur">
          <div className="mb-5 space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Summary
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
              Chat metrics
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryStat label="Chat" value={chatLabel} />
            <SummaryStat
              label="First Message At"
              value={formatEmployeeChatDateTime(firstMessageAt)}
            />
            <SummaryStat
              label="Last Message At"
              value={formatEmployeeChatDateTime(lastMessageAt)}
            />
            <SummaryStat label="Total Messages" value={chat.totalMessages} />
            <SummaryStat label="Incoming" value={chat.incomingMessages} />
            <SummaryStat label="Outgoing" value={chat.outgoingMessages} />
          </div>
        </section>

        <section className="rounded-[2rem] border border-black/5 bg-white/65 p-6 shadow-card backdrop-blur">
          <div className="mb-5 space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Messages
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
              Message history
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Structured conversation log with newest messages first.
            </p>
          </div>
          <ChatMessagesTable
            chatRecordId={chatRecordId}
            code={code}
            error={messagesError}
            messages={messages}
            page={messagesPage}
            pageSize={messagesPageSize}
            total={messagesTotal}
            totalPages={messagesTotalPages}
          />
        </section>
      </div>
    </main>
  );
}
