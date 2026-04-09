'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from '@tanstack/react-table';
import {
  startTransition,
  useState,
  type FormEvent
} from 'react';
import { handleUnauthorizedClientResponse } from '@/lib/client-auth';
import type { Employee } from '@/lib/employees';
import CreateUserModal from './CreateUserModal';
import DeleteUserModal from './DeleteUserModal';
import TrashIcon from './TrashIcon';
import UserItem from './UserItem';
import {
  buildCreateUserPayload,
  CREATE_USER_GENERIC_ERROR,
  CREATE_USER_NAME_REQUIRED_ERROR,
  DELETE_USER_GENERIC_ERROR,
  isDeleteConfirmationValid,
  resolveCreateUserResponse,
  resolveDeleteUserResponse
} from './user-actions';

interface UserTableProps {
  employees: Employee[];
  error: string | null;
  warning: string | null;
}

const StatusBadge = ({
  error,
  warning
}: Pick<UserTableProps, 'error' | 'warning'>) => {
  if (error) {
    return (
      <div className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-700">
        API unavailable
      </div>
    );
  }

  if (warning) {
    return (
      <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-amber-700">
        Partial data
      </div>
    );
  }

  return (
    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-emerald-700">
      Backend connected
    </div>
  );
};

export default function UserTable({ employees, error, warning }: UserTableProps) {
  const router = useRouter();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const resetCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreateDisplayName('');
    setCreateError(null);
  };

  const resetDeleteModal = () => {
    setEmployeeToDelete(null);
    setDeleteConfirmation('');
    setDeleteError(null);
  };

  const handleOpenCreateModal = () => {
    setCreateError(null);
    setCreateDisplayName('');
    setIsCreateModalOpen(true);
  };

  const handleCloseCreateModal = () => {
    if (isCreating) {
      return;
    }

    resetCreateModal();
  };

  const handleOpenDeleteModal = (employee: Employee) => {
    setEmployeeToDelete(employee);
    setDeleteConfirmation('');
    setDeleteError(null);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) {
      return;
    }

    resetDeleteModal();
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isCreating) {
      return;
    }

    const payload = buildCreateUserPayload(createDisplayName);

    if (!payload) {
      setCreateError(CREATE_USER_NAME_REQUIRED_ERROR);
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (await handleUnauthorizedClientResponse(response, router)) {
        return;
      }

      const result = await resolveCreateUserResponse(response);

      if (result.kind === 'error') {
        setCreateError(result.message);
        return;
      }

      resetCreateModal();
      startTransition(() => {
        router.push(`/employees/${encodeURIComponent(result.employee.code)}`);
      });
    } catch {
      setCreateError(CREATE_USER_GENERIC_ERROR);
    } finally {
      setIsCreating(false);
    }
  };

  const hanDELETEeleteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !employeeToDelete ||
      isDeleting ||
      !isDeleteConfirmationValid(deleteConfirmation)
    ) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(
        `/api/employees/${encodeURIComponent(employeeToDelete.code)}`,
        {
          method: 'DELETE'
        }
      );

      if (await handleUnauthorizedClientResponse(response, router)) {
        return;
      }

      const result = await resolveDeleteUserResponse(response);

      if (result.kind === 'error') {
        setDeleteError(result.message);
        return;
      }

      resetDeleteModal();
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setDeleteError(DELETE_USER_GENERIC_ERROR);
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: ColumnDef<Employee>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => (
        <div className="min-w-[8rem]">
          <Link
            href={`/employees/${encodeURIComponent(row.original.code)}`}
            className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-400 transition-colors duration-200 hover:text-slatewarm-950 hover:underline"
          >
            {row.original.code}
          </Link>
        </div>
      )
    },
    {
      accessorKey: 'displayName',
      header: 'Display name',
      cell: ({ row }) => row.original.displayName ?? 'Not set'
    },
    {
      accessorKey: 'phoneNumber',
      header: 'Phone number',
      cell: ({ row }) => row.original.phoneNumber ?? 'Not set'
    },
    {
      accessorKey: 'createdAtLabel',
      header: 'Created',
      cell: ({ row }) => row.original.createdAtLabel
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <span
          className={`inline-flex rounded-full px-3 py-1 text-[0.65rem] uppercase tracking-[0.22em] ${
            row.original.isActive
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-stone-200 text-stone-600'
          }`}
        >
          {row.original.isActive ? 'active' : 'paused'}
        </span>
      )
    },
    {
      id: 'actions',
      header: () => <span className="block text-right">Actions</span>,
      cell: ({ row }) => {
        const employeeLabel = row.original.displayName ?? row.original.code;

        return (
          <button
            type="button"
            onClick={() => handleOpenDeleteModal(row.original)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 text-slate-500 transition-colors duration-200 hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            aria-label={`Delete user ${employeeLabel}`}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        );
      }
    }
  ];

  const table = useReactTable({
    data: employees,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  const renderCreateUserButton = () => (
    <button
      type="button"
      onClick={handleOpenCreateModal}
      className="inline-flex items-center justify-center rounded-full bg-slatewarm-950 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-slatewarm-900"
    >
      Create user
    </button>
  );

  return (
    <section className="rounded-[2rem] border border-black/5 bg-white/65 p-4 shadow-card backdrop-blur md:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
            All users
          </h2>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            Source: GET /employees
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {renderCreateUserButton()}
          <StatusBadge error={error} warning={warning} />
        </div>
      </div>

      {error ? (
        <div className="rounded-[1.5rem] border border-dashed border-red-300 bg-red-50/80 p-6 text-sm text-red-900">
          <p className="font-semibold">Unable to load employees</p>
          <p className="mt-2 leading-6">
            Check that the backend is running and that
            {' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-[0.85em]">
              EMPLOYEES_API_BASE_URL
            </code>
            {' '}
            points to the correct address.
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.15em] text-red-700">
            {error}
          </p>
        </div>
      ) : employees.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50/90 p-10 text-center text-sm text-stone-600">
          <p className="text-base font-medium text-slatewarm-950">No users yet.</p>
          <p className="mt-3 leading-6">
            Create the first dashboard user to start managing chats from one place.
          </p>
          <div className="mt-6 flex justify-center">{renderCreateUserButton()}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {warning ? (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
              {warning}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-[1.6rem] border border-stone-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead className="bg-stone-50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className={`px-4 py-4 text-left text-[0.65rem] uppercase tracking-[0.24em] text-slate-500 ${
                            header.id === 'actions' ? 'text-right' : ''
                          }`}
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
                  {table.getRowModel().rows.map((row) => (
                    <UserItem key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <CreateUserModal
        displayName={createDisplayName}
        error={createError}
        isOpen={isCreateModalOpen}
        isSubmitting={isCreating}
        onClose={handleCloseCreateModal}
        onDisplayNameChange={setCreateDisplayName}
        onSubmit={handleCreateSubmit}
      />
      <DeleteUserModal
        confirmationValue={deleteConfirmation}
        employee={employeeToDelete}
        error={deleteError}
        isOpen={employeeToDelete !== null}
        isSubmitting={isDeleting}
        onClose={handleCloseDeleteModal}
        onConfirmationChange={setDeleteConfirmation}
        onSubmit={hanDELETEeleteSubmit}
      />
    </section>
  );
}
