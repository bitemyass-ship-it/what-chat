import type { ReactNode } from 'react';

interface HomeModalShellProps {
  ariaLabel: string;
  canClose?: boolean;
  children: ReactNode;
  description: string;
  eyebrow: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
}

export default function HomeModalShell({
  ariaLabel,
  canClose = true,
  children,
  description,
  eyebrow,
  isOpen,
  onClose,
  title
}: HomeModalShellProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="w-full max-w-xl rounded-[2rem] border border-white/60 bg-[#f7f2eb] p-6 shadow-2xl md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              {eyebrow}
            </p>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl font-semibold text-slatewarm-950">
              {title}
            </h2>
            <p className="max-w-lg text-sm leading-6 text-slate-600">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-lg text-slate-700 transition-colors duration-200 hover:border-slatewarm-950 hover:text-slatewarm-950 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
