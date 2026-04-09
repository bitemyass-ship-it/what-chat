import {
  getWhatsappRuntimeStatusLabel,
  type WhatsappSession
} from '@/lib/whatsapp-session';

interface EmployeeWhatsappSessionModalProps {
  isEmployeeActive: boolean;
  isOpen: boolean;
  isPollingSession: boolean;
  isSessionStarting: boolean;
  onClose: () => void;
  qrImageUrl: string | null;
  session: WhatsappSession | null;
  sessionError: string | null;
}

const getStatusClasses = (runtimeStatus: WhatsappSession['runtimeStatus'] | null): string => {
  switch (runtimeStatus) {
    case 'ready':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'starting':
    case 'waiting_for_qr':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'auth_failed':
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'disconnected':
    case 'stopped':
      return 'border-stone-300 bg-stone-100 text-slate-700';
    case 'not_started':
    default:
      return 'border-stone-300 bg-white text-slate-700';
  }
};

export default function EmployeeWhatsappSessionModal({
  isEmployeeActive,
  isOpen,
  isPollingSession,
  isSessionStarting,
  onClose,
  qrImageUrl,
  session,
  sessionError
}: EmployeeWhatsappSessionModalProps) {
  if (!isOpen) {
    return null;
  }

  const runtimeStatus = session?.runtimeStatus ?? 'not_started';
  const statusLabel = getWhatsappRuntimeStatusLabel(runtimeStatus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/60 bg-[#f7f2eb] p-6 shadow-2xl md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              WhatsApp session
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl font-semibold text-slatewarm-950">
              Connect WhatsApp
            </h2>
            <p className="max-w-lg text-sm leading-6 text-slate-600">
              Open WhatsApp on your phone and scan this QR code.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-lg text-slate-700 transition-colors duration-200 hover:border-slatewarm-950 hover:text-slatewarm-950"
            aria-label="Close WhatsApp session panel"
          >
            ×
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getStatusClasses(runtimeStatus)}`}
          >
            Runtime status: {statusLabel}
          </span>
          {isPollingSession ? (
            <span className="text-sm text-slate-500">
              Refreshing status every 1.5s...
            </span>
          ) : null}
        </div>

        {session?.lastError ? (
          <div className="mt-5 rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {session.lastError}
          </div>
        ) : null}

        {!session?.lastError && sessionError ? (
          <div className="mt-5 rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {sessionError}
          </div>
        ) : null}

        <div className="mt-6 rounded-[1.6rem] border border-stone-200 bg-white/85 p-5">
          {runtimeStatus === 'starting' || isSessionStarting ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <span className="h-12 w-12 animate-spin rounded-full border-4 border-stone-200 border-t-slatewarm-950" />
              <div className="space-y-2">
                <p className="text-base font-medium text-slatewarm-950">
                  Starting WhatsApp session...
                </p>
                <p className="text-sm leading-6 text-slate-500">
                  The backend is creating the runtime session. The QR code will appear
                  here as soon as it is available.
                </p>
              </div>
            </div>
          ) : null}

          {runtimeStatus === 'waiting_for_qr' ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              {qrImageUrl ? (
                <img
                  src={qrImageUrl}
                  alt="WhatsApp QR code"
                  className="h-72 w-72 rounded-[1.2rem] border border-stone-200 bg-white p-3 shadow-sm"
                />
              ) : (
                <div className="flex h-72 w-72 items-center justify-center rounded-[1.2rem] border border-dashed border-stone-300 bg-stone-50 px-6 text-sm leading-6 text-slate-500">
                  Rendering QR code...
                </div>
              )}
              <p className="max-w-md text-sm leading-6 text-slate-500">
                Keep this panel open while the QR code is valid. Once the device is
                paired, the panel closes automatically.
              </p>
            </div>
          ) : null}

          {runtimeStatus !== 'starting' && runtimeStatus !== 'waiting_for_qr' ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <div className="space-y-2">
                <p className="text-base font-medium text-slatewarm-950">
                  {runtimeStatus === 'ready'
                    ? 'WhatsApp is connected.'
                    : 'Runtime session is not connected yet.'}
                </p>
                <p className="max-w-md text-sm leading-6 text-slate-500">
                  {runtimeStatus === 'ready'
                    ? 'The backend reported a ready session. You can switch to the Chats tab when the monitoring endpoint is available.'
                    : isEmployeeActive
                      ? 'Disable employee to stop the current WhatsApp session and clear its stored login data.'
                      : 'Enable employee to start a new WhatsApp runtime session.'}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
