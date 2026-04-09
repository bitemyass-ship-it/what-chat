import type { FormEvent } from 'react';
import type { Employee } from '@/lib/employees';
import HomeModalShell from './HomeModalShell';
import {
  DELETE_USER_CONFIRMATION_TOKEN,
  isDeleteConfirmationValid
} from './user-actions';

interface DeleteUserModalProps {
  confirmationValue: string;
  employee: Employee | null;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirmationChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function DeleteUserModal({
  confirmationValue,
  employee,
  error,
  isOpen,
  isSubmitting,
  onClose,
  onConfirmationChange,
  onSubmit
}: DeleteUserModalProps) {
  if (!employee) {
    return null;
  }

  const isConfirmEnabled =
    isDeleteConfirmationValid(confirmationValue) && !isSubmitting;
  const employeeLabel = employee.displayName ?? employee.code;

  return (
    <HomeModalShell
      ariaLabel={`Delete user ${employeeLabel}`}
      canClose={!isSubmitting}
      description="This action is irreversible. It removes the user, related chats, and stored WhatsApp session data."
      eyebrow="Danger zone"
      isOpen={isOpen}
      onClose={onClose}
      title="Delete user"
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="rounded-[1.4rem] border border-red-200 bg-red-50/90 p-4 text-sm text-red-900">
          <p className="font-semibold">Deletion is irreversible.</p>
          <p className="mt-2 leading-6">
            The dashboard will permanently remove the user, related chats, and
            stored WhatsApp session data.
          </p>
        </div>

        <div className="rounded-[1.4rem] border border-stone-200 bg-white/90 p-4 text-sm text-slate-700">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
            User
          </p>
          <p className="mt-2 text-base font-medium text-slatewarm-950">
            {employee.displayName ?? 'Unnamed user'}
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">
            Code
          </p>
          <p className="mt-2 font-mono text-sm text-slatewarm-950">{employee.code}</p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="delete-user-confirmation"
            className="text-xs uppercase tracking-[0.24em] text-slate-500"
          >
            Type {DELETE_USER_CONFIRMATION_TOKEN} to confirm
          </label>
          <input
            id="delete-user-confirmation"
            name="deleteConfirmation"
            type="text"
            autoComplete="off"
            value={confirmationValue}
            disabled={isSubmitting}
            onChange={(event) => onConfirmationChange(event.target.value)}
            className="w-full rounded-[1.25rem] border border-stone-300 bg-white px-4 py-3 text-base text-slatewarm-950 outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-red-500 disabled:cursor-not-allowed disabled:bg-stone-100"
            placeholder={DELETE_USER_CONFIRMATION_TOKEN}
          />
        </div>

        {error ? (
          <div className="rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-slatewarm-950 hover:text-slatewarm-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isConfirmEnabled}
            className="inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {isSubmitting ? 'Deleting…' : 'Delete user'}
          </button>
        </div>
      </form>
    </HomeModalShell>
  );
}
