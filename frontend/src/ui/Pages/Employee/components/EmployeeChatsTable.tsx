'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from '@tanstack/react-table';
import type { EmployeeChatListItem } from '@/lib/chats';
import {
  formatEmployeeChatCompactDateTime,
  resolveEmployeeChatLabel
} from '@/lib/chats';

interface EmployeeChatsTableProps {
  chats: EmployeeChatListItem[];
  employeeCode: string;
  error: string | null;
  isLoading: boolean;
  onPageChange: (page: number) => void;
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
          <div className="h-4 w-32 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4">
          <div className="h-4 w-24 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4">
          <div className="h-4 w-44 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4 text-right">
          <div className="ml-auto h-4 w-10 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4 text-right">
          <div className="ml-auto h-4 w-10 animate-pulse rounded-full bg-stone-200" />
        </td>
        <td className="px-4 py-4 text-right">
          <div className="ml-auto h-4 w-10 animate-pulse rounded-full bg-stone-200" />
        </td>
      </tr>
    ))}
  </>
);

export default function EmployeeChatsTable({
  chats,
  employeeCode,
  error,
  isLoading,
  onPageChange,
  page,
  pageSize,
  total,
  totalPages
}: EmployeeChatsTableProps) {
  const columns: ColumnDef<EmployeeChatListItem>[] = [
    {
      id: 'chat',
      accessorFn: (row) => resolveEmployeeChatLabel(row),
      header: 'Chat',
      cell: ({ row }) => {
        const label = resolveEmployeeChatLabel(row.original);
        const secondaryLabel =
          row.original.displayName !== null
            ? row.original.phoneNumber ?? row.original.rawChatLabel
            : row.original.rawChatLabel;

        return (
          <div className="min-w-0 max-w-[11rem] px-1 py-0.5">
            <p className="truncate font-medium text-slatewarm-950">{label}</p>
            {secondaryLabel !== label ? (
              <p className="mt-1 truncate text-xs text-slate-500">
                {secondaryLabel}
              </p>
            ) : null}
          </div>
        );
      }
    },
    {
      id: 'lastMessageAt',
      accessorFn: (row) => row.lastMessageAt,
      header: 'Last Message At',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-slate-700">
          {formatEmployeeChatCompactDateTime(row.original.lastMessageAt)}
        </span>
      )
    },
    {
      accessorKey: 'lastMessagePreview',
      header: 'Last Message Preview',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-[14rem] truncate text-slate-600">
          {row.original.lastMessagePreview ?? 'No messages yet'}
        </span>
      )
    },
    {
      accessorKey: 'totalMessages',
      header: 'Total Messages',
      cell: ({ row }) => (
        <span className="font-medium tabular-nums text-slatewarm-950">
          {row.original.totalMessages}
        </span>
      )
    },
    {
      accessorKey: 'incomingMessages',
      header: 'Incoming',
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700">
          {row.original.incomingMessages}
        </span>
      )
    },
    {
      accessorKey: 'outgoingMessages',
      header: 'Outgoing',
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700">
          {row.original.outgoingMessages}
        </span>
      )
    }
  ];

  const table = useReactTable({
    data: chats,
    columns,
    getCoreRowModel: getCoreRowModel()
  });
  const emptyStateCopy =
    total > 0 && chats.length === 0 ? 'No chats on this page' : 'No chats available yet';
  const paginationPages = Array.from(
    new Set([
      ...Array.from({ length: totalPages }, (_, index) => index + 1),
      ...(page > totalPages ? [page] : [])
    ])
  ).sort((leftPage, rightPage) => leftPage - rightPage);
  const resolveChatHref = (chatRecordId: number): string =>
    `/employees/${encodeURIComponent(employeeCode)}/chats/${encodeURIComponent(
      String(chatRecordId)
    )}`;
  const openChatInNewTab = (chatRecordId: number): void => {
    window.open(resolveChatHref(chatRecordId), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white">
      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0">
          <thead className="bg-stone-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isNumericColumn = [
                    'totalMessages',
                    'incomingMessages',
                    'outgoingMessages'
                  ].includes(header.id);

                  return (
                    <th
                      key={header.id}
                      className={`px-3 py-3 text-left text-[0.65rem] uppercase tracking-[0.24em] text-slate-500 ${
                        isNumericColumn ? 'text-right' : ''
                      }`}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <LoadingRows />
            ) : error ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-10 text-center text-sm text-slate-600"
                >
                  Chat metrics are temporarily unavailable.
                </td>
              </tr>
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openChatInNewTab(row.original.chatRecordId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openChatInNewTab(row.original.chatRecordId);
                    }
                  }}
                  className="cursor-pointer border-b border-stone-200/80 transition-colors duration-200 hover:bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-slatewarm-950/20"
                >
                  {row.getVisibleCells().map((cell) => {
                    const isNumericColumn = [
                      'totalMessages',
                      'incomingMessages',
                      'outgoingMessages'
                    ].includes(cell.column.id);

                    return (
                      <td
                        key={cell.id}
                        className={`px-3 py-3 align-top text-sm text-slate-700 ${
                          isNumericColumn ? 'text-right' : ''
                        }`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
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
                      Chats will appear here after the stored message history is ingested.
                    </p>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
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
            aria-label="Chats pagination"
            className="flex flex-wrap items-center justify-end gap-2"
          >
            {paginationPages.map((pageNumber) => {
              const isCurrentPage = pageNumber === page;

              return (
                <button
                  key={pageNumber}
                  type="button"
                  disabled={isCurrentPage || isLoading}
                  onClick={() => onPageChange(pageNumber)}
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
  );
}
