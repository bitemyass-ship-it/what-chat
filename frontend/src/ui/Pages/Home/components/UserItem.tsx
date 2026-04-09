'use client';

import { flexRender, type Row } from '@tanstack/react-table';
import type { Employee } from '@/lib/employees';

interface UserItemProps {
  row: Row<Employee>;
}

export default function UserItem({ row }: UserItemProps) {
  return (
    <tr className="border-b border-stone-200/80 transition-colors duration-200 hover:bg-stone-50/80">
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className={`px-4 py-4 align-top text-sm text-slate-700 first:font-medium first:text-slatewarm-950 ${
            cell.column.id === 'actions' ? 'w-16 text-right' : ''
          }`}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}
