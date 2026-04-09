'use client';

import {
  useState,
  useTransition,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import type { ChatMessageListItem } from '@/lib/chats';
import {
  formatEmployeeChatDateTime,
  getChatMessageDisplayBody,
  getChatMessageDirectionLabel,
  getChatMessagePreview,
  getChatMessageTypeLabel
} from '@/lib/chats';
import FullMessageModal from './FullMessageModal';

interface ChatMessagesTableProps {
  chatRecordId: string;
  code: string;
  error: string | null;
  messages: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const LoadingRows = () => (
  <>
    {Array.from({
      length: 4
    }).map((_, index) => (
      <tr key={index} className="border-b border-stone-200/80">
        <td className="px-4 py-4">
          <div className="h-4 w-36 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4">
          <div className="h-6 w-24 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4">
          <div className="h-4 w-64 animate-pulse rounded-full bg-stone-200" />
          <div className="mt-2 h-4 w-40 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4">
          <div className="h-6 w-20 animate-pulse rounded-full bg-stone-200" />
        </td>
      </tr>
    ))}
  </>
);

export default function ChatMessagesTable({
  chatRecordId,
  code,
  error,
  messages,
  page,
  pageSize,
  total,
  totalPages
}: ChatMessagesTableProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startPageTransition] = useTransition();
  const [expandedMessageBody, setExpandedMessageBody] = useState<string | null>(null);

  const columns: ColumnDef<ChatMessageListItem>[] = [
    {
      id: 'timestamp',
      accessorFn: (row) => row.timestamp,
      header: 'Timestamp',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-slate-700">
          {formatEmployeeChatDateTime(row.original.timestamp)}
        </span>
      )
    },
    {
      id: 'direction',
      accessorKey: 'direction',
      header: 'Direction',
      cell: ({ row }) => {
        const direction = row.original.direction;

        return (
          <span
            className={`inline-flex rounded-full px-3 py-1 text-[0.65rem] uppercase tracking-[0.18em] ${
              direction === 'incoming'
                ? 'bg-emerald-100 text-emerald-700'
                : direction === 'outgoing'
                  ? 'bg-sky-100 text-sky-700'
                  : 'bg-stone-200 text-stone-700'
            }`}
          >
            {getChatMessageDirectionLabel(direction)}
          </span>
        );
      }
    },
    {
      id: 'body',
      accessorKey: 'body',
      header: 'Message',
      cell: ({ row }) => {
        const displayBody = getChatMessageDisplayBody(row.original.body);
        const { isTruncated, preview } = getChatMessagePreview(row.original.body);

        if (!isTruncated) {
          return (
            <div className="max-w-[22rem] whitespace-pre-wrap break-words leading-6 text-slate-700">
              {displayBody}
            </div>
          );
        }

        return (
          <div className="flex max-w-[22rem] items-start gap-3">
            <p className="min-w-0 flex-1 break-words leading-6 text-slate-700">
              {preview}
              <span aria-hidden="true">…</span>
            </p>
            <button
              type="button"
              onClick={() => setExpandedMessageBody(displayBody)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-base font-medium text-slate-700 transition-colors duration-200 hover:border-slatewarm-950 hover:text-slatewarm-950"
              aria-label="View full message"
            >
              …
            </button>
          </div>
        );
      }
    },
    {
      id: 'messageType',
      accessorKey: 'messageType',
      header: 'Type',
      cell: ({ row }) => (
        <span className="inline-flex rounded-full border border-stone-200 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-600">
          {getChatMessageTypeLabel(row.original.messageType)}
        </span>
      )
    }
  ];

  const table = useReactTable({
    data: messages,
    columns,
    getCoreRowModel: getCoreRowModel()
  });
  const emptyStateCopy =
    total > 0 && messages.length === 0
      ? 'No messages on this page'
      : 'No messages available yet';
  const paginationPages = Array.from(
    new Set([
      ...Array.from({ length: totalPages }, (_, index) => index + 1),
      ...(page > totalPages ? [page] : [])
    ])
  ).sort((leftPage, rightPage) => leftPage - rightPage);

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set('page', String(nextPage));

    const nextHref = `${pathname}?${nextSearchParams.toString()}`;

    startPageTransition(() => {
      router.push(nextHref, {
        scroll: false
      });
    });
  };

  return (
    <>
      <div className="overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white">
        {error ? (
          <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0">
            <thead className="bg-stone-50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-4 text-left text-[0.65rem] uppercase tracking-[0.24em] text-slate-500"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {isPending ? (
                <LoadingRows />
              ) : error ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-10 text-center text-sm text-slate-600"
                  >
                    Message history is temporarily unavailable.
                  </td>
                </tr>
              ) : table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-stone-200/80 transition-colors duration-200 hover:bg-stone-50/80"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-4 py-4 align-top text-sm text-slate-700"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-12 text-center text-sm text-stone-600"
                  >
                    <p className="text-base font-medium text-slatewarm-950">
                      {emptyStateCopy}
                    </p>
                    {total === 0 ? (
                      <p className="mt-2">
                        This chat exists, but no stored messages have been ingested yet.
                      </p>
                    ) : null}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 || page > totalPages ? (
          <div className="flex flex-col gap-3 border-t border-stone-200 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
              <span>
                Total:
                {' '}
                <span className="font-medium text-slatewarm-950">{total}</span>
              </span>
              <span>
                Page
                {' '}
                {page}
                {' '}
                of
                {' '}
                {totalPages}
              </span>
              <span>
                {pageSize}
                {' '}
                per page
              </span>
            </div>
            <nav
              aria-label={`Messages pagination for chat ${chatRecordId} (${code})`}
              className="flex flex-wrap items-center justify-end gap-2"
            >
              {paginationPages.map((pageNumber) => {
                const isCurrentPage = pageNumber === page;

                return (
                  <button
                    key={pageNumber}
                    type="button"
                    disabled={isCurrentPage || isPending}
                    onClick={() => handlePageChange(pageNumber)}
                    className={`min-w-10 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
                      isCurrentPage
                        ? 'border-slatewarm-950 bg-slatewarm-950 text-white'
                        : 'border-stone-300 text-slate-700 hover:border-slatewarm-950 hover:text-slatewarm-950 disabled:cursor-not-allowed disabled:opacity-60'
                    }`}
                  >
                    {pageNumber}
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>
      <FullMessageModal
        body={expandedMessageBody ?? ''}
        isOpen={expandedMessageBody !== null}
        onClose={() => setExpandedMessageBody(null)}
      />
    </>
  );
}
