import type { FormEvent } from 'react';
import type { Employee } from '@/lib/employee-record';

interface EmployeeInfoFormProps {
  displayName: string;
  employee: Employee;
  error: string | null;
  hasPersistedPhoneNumber: boolean;
  hasChanges: boolean;
  isSaving: boolean;
  isSessionStarting: boolean;
  isStatusUpdating: boolean;
  onDisplayNameChange: (value: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onStatusToggle: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  phoneNumber: string;
  sessionControlMode: 'enable' | 'disable';
  statusError: string | null;
  success: string | null;
}

export default function EmployeeInfoForm({
  displayName,
  employee,
  error,
  hasPersistedPhoneNumber,
  hasChanges,
  isSaving,
  isSessionStarting,
  isStatusUpdating,
  onDisplayNameChange,
  onPhoneNumberChange,
  onStatusToggle,
  onSubmit,
  phoneNumber,
  sessionControlMode,
  statusError,
  success
}: EmployeeInfoFormProps) {
  const isEnableMode = sessionControlMode === 'enable';
  const isStatusToggleDisabled =
    isSaving ||
    isStatusUpdating ||
    isSessionStarting ||
    (isEnableMode && !hasPersistedPhoneNumber);
  const statusButtonLabel = isStatusUpdating || isSessionStarting
    ? isEnableMode
      ? 'Enabling...'
      : 'Disabling...'
    : isEnableMode
      ? 'Enable employee'
      : 'Disable employee';

  return (
    <section className="rounded-[2rem] border border-black/5 bg-white/65 p-4 shadow-card backdrop-blur md:p-6">
      <div className="mb-6 flex flex-col gap-2">
        <h2 className="font-[family-name:var(--font-heading)] text-2xl font-semibold text-slatewarm-950">
          Employee info
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Update the visible employee profile fields. The employee code stays fixed,
          while the WhatsApp runtime session is bound to the saved phone number.
        </p>
      </div>

      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Code
            </span>
            <input
              value={employee.code}
              readOnly
              className="w-full rounded-[1.2rem] border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-slate-600 outline-none"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Created
            </span>
            <input
              value={employee.createdAtLabel}
              readOnly
              className="w-full rounded-[1.2rem] border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-slate-600 outline-none"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Display name
            </span>
            <input
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Anna"
              className="w-full rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-slatewarm-950"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
              Phone number
            </span>
            <input
              value={phoneNumber}
              onChange={(event) => onPhoneNumberChange(event.target.value)}
              placeholder="+380991112233"
              className="w-full rounded-[1.2rem] border border-stone-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors duration-200 focus:border-slatewarm-950"
            />
          </label>
        </div>

        <div className="rounded-[1.4rem] border border-stone-200 bg-stone-50/80 px-4 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slatewarm-950">
                Employee availability
              </p>
              <p className="text-sm leading-6 text-slate-600">
                {sessionControlMode === 'disable'
                  ? 'Disable this employee to stop the runtime WhatsApp session and remove its stored login data.'
                  : 'Enable this employee to start the runtime WhatsApp session manually.'}
              </p>
            </div>

            <button
              type="button"
              disabled={isStatusToggleDisabled}
              onClick={onStatusToggle}
              className={`inline-flex rounded-full px-5 py-3 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                isEnableMode
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-stone-900 text-white hover:bg-stone-800'
              }`}
            >
              {statusButtonLabel}
            </button>
          </div>

          {isEnableMode && isStatusToggleDisabled && !hasPersistedPhoneNumber ? (
            <p className="mt-3 text-sm text-amber-700">
              Enable this employee only after the backend saves and returns the phone
              number in the profile payload.
            </p>
          ) : null}

          {statusError ? (
            <p className="mt-3 text-sm text-red-700">{statusError}</p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {success}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isSaving || isStatusUpdating || isSessionStarting || !hasChanges}
            className="inline-flex rounded-full bg-slatewarm-950 px-5 py-3 text-sm font-medium text-white transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
          <p className="text-sm text-slate-500">
            {hasChanges
              ? 'Unsaved changes detected.'
              : 'Everything is in sync with the backend.'}
          </p>
        </div>
      </form>
    </section>
  );
}
