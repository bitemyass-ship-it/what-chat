import type { FormEvent } from 'react';
import HomeModalShell from './HomeModalShell';

interface CreateUserModalProps {
  displayName: string;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onDisplayNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function CreateUserModal({
  displayName,
  error,
  isOpen,
  isSubmitting,
  onClose,
  onDisplayNameChange,
  onSubmit
}: CreateUserModalProps) {
  return (
    <HomeModalShell
      ariaLabel="Create user"
      canClose={!isSubmitting}
      description="Create a new dashboard user from a single required name field. The backend will generate the immutable code."
      eyebrow="User creation"
      isOpen={isOpen}
      onClose={onClose}
      title="Create user"
    >
      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="space-y-2">
          <label
            htmlFor="create-user-name"
            className="text-xs uppercase tracking-[0.24em] text-slate-500"
          >
            Name
          </label>
          <input
            id="create-user-name"
            name="displayName"
            type="text"
            autoComplete="off"
            autoFocus
            value={displayName}
            disabled={isSubmitting}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            className="w-full rounded-[1.25rem] border border-stone-300 bg-white px-4 py-3 text-base text-slatewarm-950 outline-none transition-colors duration-200 placeholder:text-slate-400 focus:border-slatewarm-950 disabled:cursor-not-allowed disabled:bg-stone-100"
            placeholder="Anna Petrova"
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
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-full bg-slatewarm-950 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-slatewarm-900 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isSubmitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </HomeModalShell>
  );
}
